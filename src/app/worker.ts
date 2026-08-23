/**
 * Worker da simulação: o solver roda inteiro aqui para a interface nunca
 * congelar (§8). A thread principal pede quadros (requestFrame) e recebe
 * snapshots; parâmetros chegam por mensagem; o modo varredura (§6.3)
 * também roda aqui, em fatias, para continuar cancelável.
 */

import { Solver2D } from '../solver/solver2d';
import {
  IntakeParams, defaultIntakeParams, makeIntakeSolver, intakeGeometry,
} from '../solver/intake2d';
import { FLUID } from '../solver/grid2d';
import {
  measureIntake, traceCaptureFraction,
} from '../physics/probes2d';
import type {
  MainToWorker, WorkerToMain, FrameMsg, GeometryInfo, FieldKind, SweepPoint,
} from './protocol';

let solver: Solver2D | null = null;
let intake: IntakeParams = defaultIntakeParams();
let running = false;
let timeScale = 1.0;
let simRate = 0; // s simulados por s de parede (média móvel)
let lastPumpWall = 0;
let sweepState: {
  vValues: number[]; idx: number; phase: 'settle' | 'measure';
  phaseStart: number; settleTime: number; measureTime: number;
  acc: SweepPoint; accN: number; points: SweepPoint[]; savedV: number;
} | null = null;

const post = (msg: WorkerToMain, transfer?: Transferable[]) => {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
};

function buildGeometryInfo(s: Solver2D): GeometryInfo {
  const g = s.grid;
  const geo = intakeGeometry(intake, g.dx);
  const solidMask = new Uint8Array(g.nx * g.ny);
  for (let k = 0; k < solidMask.length; k++) {
    solidMask[k] = g.solidPhiCenter[k] < 0 ? 1 : 0;
  }
  return {
    nx: g.nx, ny: g.ny, dx: g.dx,
    domainW: g.width, domainH: g.height,
    solidMask,
    xC: geo.xC, yC: geo.yC, yA: geo.yA, xTube: geo.xTube,
    mouthY0: geo.mouthY0, mouthY1: geo.mouthY1,
    resX0: geo.resX0, resX1: geo.resX1, resFloorY: geo.resFloorY,
    waterDepth: intake.waterDepth,
  };
}

function rebuild(nx: number, solverOverrides: Record<string, unknown>): void {
  solver = makeIntakeSolver(nx, intake, solverOverrides as never);
  post({ type: 'ready', geometry: buildGeometryInfo(solver) });
}

/** Atualiza V sem reconstruir a geometria (a cena muda só as BCs). */
function applyVelocity(): void {
  if (!solver) return;
  const g = solver.grid;
  const bc = g.bc;
  if (bc.right.kind === 'inflow') {
    bc.right.u = -intake.V;
    bc.right.belowY = intake.waterDepth;
  }
  solver.params.bedU = -intake.V;
  // Reaplica os pesos/velocidades das bordas
  g.setSolids(solver.scene.sdf, solver.scene.solidVel);
}

// ------------------------------------------------------------------ campos

function computeField(s: Solver2D, kind: FieldKind): { f: Float32Array; min: number; max: number } {
  const g = s.grid;
  const n = g.nx * g.ny;
  const f = new Float32Array(n);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = g.ic(i, j);
      let val = 0;
      if (g.cellType[k] === FLUID) {
        switch (kind) {
          case 'speed': {
            const u = 0.5 * (g.u[g.iu(i, j)] + g.u[g.iu(i + 1, j)]);
            const v = 0.5 * (g.v[g.iv(i, j)] + g.v[g.iv(i, j + 1)]);
            val = Math.hypot(u, v);
            break;
          }
          case 'pressure':
            val = g.p[k];
            break;
          case 'vorticity': {
            // ω = ∂v/∂x − ∂u/∂y nos centros (diferenças centradas)
            const iR = Math.min(i + 1, g.nx - 1), iL = Math.max(i - 1, 0);
            const jT = Math.min(j + 1, g.ny - 1), jB = Math.max(j - 1, 0);
            const vR = 0.5 * (g.v[g.iv(iR, j)] + g.v[g.iv(iR, j + 1)]);
            const vL = 0.5 * (g.v[g.iv(iL, j)] + g.v[g.iv(iL, j + 1)]);
            const uT = 0.5 * (g.u[g.iu(i, jT)] + g.u[g.iu(i + 1, jT)]);
            const uB = 0.5 * (g.u[g.iu(i, jB)] + g.u[g.iu(i + 1, jB)]);
            val = (vR - vL) / ((iR - iL) * g.dx || g.dx)
                - (uT - uB) / ((jT - jB) * g.dx || g.dx);
            break;
          }
          case 'divergence':
            val = g.divergence(i, j);
            break;
        }
        if (val < min) min = val;
        if (val > max) max = val;
      } else {
        val = NaN; // fora do fluido: transparente no render
      }
      f[k] = val;
    }
  }
  if (min > max) { min = 0; max = 1; }
  return { f, min, max };
}

function tubePressureProfile(s: Solver2D): Float32Array {
  const g = s.grid;
  const geo = intakeGeometry(intake, g.dx);
  const i = Math.round(geo.xTube / g.dx);
  const out: number[] = [];
  const j0 = Math.floor((geo.mouthY1) / g.dx);
  const j1 = Math.floor(geo.yA / g.dx);
  for (let j = j0; j <= j1 && j < g.ny; j++) {
    const k = g.ic(i, j);
    if (g.cellType[k] !== FLUID) continue;
    const z = (j + 0.5) * g.dx - intake.waterDepth; // altura acima do nível do canal
    out.push(z, g.p[k]);
  }
  return new Float32Array(out);
}

// ------------------------------------------------------------------- pump

function pump(): void {
  const now = performance.now();
  const wallDt = lastPumpWall > 0 ? (now - lastPumpWall) / 1000 : 0.016;
  lastPumpWall = now;

  if (solver && sweepState) {
    pumpSweep();
  } else if (solver && running) {
    // Avança em direção ao tempo-alvo, com orçamento de parede de ~30 ms
    const target = Math.min(wallDt, 0.1) * timeScale;
    const budgetEnd = now + 30;
    let advanced = 0;
    while (advanced < target && performance.now() < budgetEnd) {
      const dt = Math.min(solver.computeDt(), target - advanced);
      solver.step(dt);
      advanced += dt;
    }
    simRate = 0.9 * simRate + 0.1 * (advanced / Math.max(wallDt, 1e-3));
  }
  setTimeout(pump, running || sweepState ? 0 : 50);
}

function pumpSweep(): void {
  const s = solver!;
  const st = sweepState!;
  const budgetEnd = performance.now() + 30;
  while (performance.now() < budgetEnd) {
    const dt = s.computeDt();
    s.step(dt);
    const elapsed = s.time - st.phaseStart;
    if (st.phase === 'settle' && elapsed >= st.settleTime) {
      st.phase = 'measure';
      st.phaseStart = s.time;
      st.acc = { V: intake.V, vNozzle: 0, flux: 0, overpressureC: 0, captureFraction: 0, dragForce: 0, power: 0 };
      st.accN = 0;
    } else if (st.phase === 'measure') {
      if (s.stepCount % 10 === 0) {
        const m = measureIntake(s, intake);
        st.acc.vNozzle += m.vNozzle;
        st.acc.flux += m.flux;
        st.acc.overpressureC += m.overpressureC;
        st.acc.captureFraction += m.captureFraction;
        st.acc.dragForce += m.dragForce;
        st.acc.power += m.power;
        st.accN++;
      }
      if (elapsed >= st.measureTime) {
        const n = Math.max(1, st.accN);
        st.points.push({
          V: intake.V,
          vNozzle: st.acc.vNozzle / n,
          flux: st.acc.flux / n,
          overpressureC: st.acc.overpressureC / n,
          captureFraction: st.acc.captureFraction / n,
          dragForce: st.acc.dragForce / n,
          power: st.acc.power / n,
        });
        st.idx++;
        if (st.idx >= st.vValues.length) {
          intake.V = st.savedV;
          applyVelocity();
          post({
            type: 'sweepProgress',
            done: st.vValues.length, total: st.vValues.length,
            currentV: st.savedV, points: st.points, finished: true,
          });
          sweepState = null;
          return;
        }
        intake.V = st.vValues[st.idx];
        applyVelocity();
        st.phase = 'settle';
        st.phaseStart = s.time;
        post({
          type: 'sweepProgress',
          done: st.idx, total: st.vValues.length,
          currentV: intake.V, points: st.points, finished: false,
        });
      }
    }
  }
}

// --------------------------------------------------------------- mensagens

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      intake = { ...msg.intake };
      rebuild(msg.nx, msg.solver as Record<string, unknown>);
      lastPumpWall = 0;
      pump();
      break;
    }
    case 'setParams': {
      if (msg.intake) Object.assign(intake, msg.intake);
      if (!solver) break;
      if (msg.solver) Object.assign(solver.params, msg.solver);
      if (msg.rebuild) {
        const nx = msg.nx ?? solver.grid.nx;
        rebuild(nx, { ...solver.params });
      } else {
        applyVelocity();
      }
      break;
    }
    case 'run':
      running = msg.running;
      break;
    case 'singleStep':
      if (solver && !running) solver.step(solver.computeDt());
      break;
    case 'reset':
      if (solver) rebuild(solver.grid.nx, { ...solver.params });
      break;
    case 'speed':
      timeScale = msg.timeScale;
      break;
    case 'sweep': {
      if (!solver) break;
      sweepState = {
        vValues: msg.vValues, idx: 0, phase: 'settle',
        phaseStart: solver.time, settleTime: msg.settleTime,
        measureTime: msg.measureTime,
        acc: { V: 0, vNozzle: 0, flux: 0, overpressureC: 0, captureFraction: 0, dragForce: 0, power: 0 },
        accN: 0, points: [], savedV: intake.V,
      };
      intake.V = msg.vValues[0];
      applyVelocity();
      post({
        type: 'sweepProgress', done: 0, total: msg.vValues.length,
        currentV: intake.V, points: [], finished: false,
      });
      break;
    }
    case 'sweepCancel':
      if (sweepState) {
        intake.V = sweepState.savedV;
        applyVelocity();
        sweepState = null;
      }
      break;
    case 'requestFrame': {
      if (!solver) break;
      const s = solver;
      const n = s.parts.count;
      const positions = new Float32Array(n * 2);
      const speeds = new Float32Array(n);
      // Velocidade RELATIVA à corrente de entrada (−V, 0): no referencial
      // do trem tudo se move a V, então |u| absoluto não distingue o canal
      // calmo de um respingo — a perturbação relativa distingue (espuma,
      // coloração de partículas).
      for (let k = 0; k < n; k++) {
        positions[2 * k] = s.parts.x[k];
        positions[2 * k + 1] = s.parts.y[k];
        speeds[k] = Math.hypot(s.parts.u[k] + intake.V, s.parts.v[k]);
      }
      let field: Float32Array | null = null;
      let fieldMin = 0, fieldMax = 1;
      let cellType: Uint8Array | null = null;
      let tubeProfile: Float32Array | null = null;
      let vectors: Float32Array | null = null;
      if (msg.wantFields) {
        const r = computeField(s, msg.field);
        field = r.f; fieldMin = r.min; fieldMax = r.max;
        cellType = new Uint8Array(s.grid.cellType);
        tubeProfile = tubePressureProfile(s);
        // Vetores esparsos (~48 colunas)
        const g = s.grid;
        const stride = Math.max(2, Math.floor(g.nx / 48));
        const vecs: number[] = [];
        for (let j = Math.floor(stride / 2); j < g.ny; j += stride) {
          for (let i = Math.floor(stride / 2); i < g.nx; i += stride) {
            const k = g.ic(i, j);
            if (g.cellType[k] !== FLUID) continue;
            const u = 0.5 * (g.u[g.iu(i, j)] + g.u[g.iu(i + 1, j)]);
            const v = 0.5 * (g.v[g.iv(i, j)] + g.v[g.iv(i, j + 1)]);
            vecs.push((i + 0.5) * g.dx, (j + 0.5) * g.dx, u, v);
          }
        }
        vectors = new Float32Array(vecs);
      }
      let tracers: FrameMsg['tracers'] = null;
      if (msg.wantTracers) {
        const geo = intakeGeometry(intake, s.grid.dx);
        tracers = traceCaptureFraction(s.grid, geo, intake, 40, true).paths;
      }
      const frame: FrameMsg = {
        type: 'frame',
        time: s.time,
        positions, speeds, count: n,
        diag: { ...s.diag, timings: { ...s.diag.timings } },
        measurement: measureIntake(s, intake),
        field, fieldMin, fieldMax, cellType, tubeProfile,
        vectors,
        tracers,
        simRate,
      };
      const transfer: Transferable[] = [positions.buffer, speeds.buffer];
      if (field) transfer.push(field.buffer);
      if (cellType) transfer.push(cellType.buffer);
      if (tubeProfile) transfer.push(tubeProfile.buffer);
      if (vectors) transfer.push(vectors.buffer);
      post(frame, transfer);
      break;
    }
  }
};
