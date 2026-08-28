/**
 * Cena do problema-alvo em 3D (§4.1–4.3): geometria cilíndrica real do
 * tubo em L, canal com largura finita — aqui a água excedente PODE
 * contornar o tubo lateralmente, o que o 2D não permite. É nesta cena que
 * a validação quantitativa contra a teoria (§7.2) é feita.
 */

import { Solver3D, Scene3D, Sdf3, SolverParams3D, FLUID, SOLID } from './solver3d';

export interface Intake3DParams {
  V: number;
  H: number;
  D: number;
  wallT: number;
  elbowR: number;
  horizLen: number;
  waterDepth: number;
  mouthDepth: number;
  domainL: number;   // comprimento (x)
  domainH: number;   // altura (y)
  domainW: number;   // largura (z)
  tubeX: number;
  resW: number;      // largura do reservatório (x e z)
  drain: boolean;
}

export function defaultIntake3DParams(): Intake3DParams {
  return {
    V: 8.0,
    H: 1.0,
    // GEOMETRIA DE VALIDAÇÃO (difere dos padrões da UI 2D; decisões
    // documentadas em VALIDACAO.md):
    //
    // D = 0.40 m (UI: 0.25): com o orçamento de CPU a grade dá Δx ≈ 4 cm;
    // um duto de 0.25 m teria ~5 células no diâmetro e a perda de carga
    // NUMÉRICA domina (medimos K ≈ 2–4: v ~40% abaixo e P_C acima de ρgH,
    // a assinatura clássica de duto sub-resolvido). As grandezas testadas
    // não dependem de D (v, P_C, V_min) ou escalam com A = πD²/4 (φ, F,
    // A_c/A) — aumentar D melhora a resolução do duto sem tocar a teoria.
    //
    // elbowR = 0.30 (> D/2, cotovelo geometricamente válido e suave — o
    // limite ideal da teoria pede perda de cotovelo mínima).
    //
    // Canal mais fundo (0.55 m): a parede efetiva engorda para 1.6·Δx e o
    // clamp de consistência empurraria a boca para fora da água (lábio
    // emerso → ingestão de ar). A teoria não depende da profundidade do
    // canal — só exige a boca inteira submersa e captura limpa.
    D: 0.40,
    wallT: 0.012,
    elbowR: 0.30,
    horizLen: 0.5,
    waterDepth: 0.55,
    mouthDepth: 0.265,  // centro da boca; lábio superior ~0.065 m submerso
    domainL: 3.8,
    domainH: 2.9,
    domainW: 1.2,       // bloqueio frontal ~19% — a água contorna dos lados
    tubeX: 1.9,
    resW: 1.0,
    drain: true,        // validação roda longa em regime permanente
  };
}

export interface Intake3DGeometry {
  xC: number; yC: number; yA: number; xTube: number; zC: number;
  tEff: number;
  resFloorY: number;
  A: number;          // área do bocal πD²/4
}

export function intake3dGeometry(p: Intake3DParams, dx: number): Intake3DGeometry {
  const tEff = Math.max(p.wallT, 1.6 * dx);
  const yC = Math.max(
    p.D / 2 + tEff + 0.01,
    Math.min(p.waterDepth - p.mouthDepth, p.waterDepth - 0.01),
  );
  return {
    xC: p.tubeX + p.horizLen,
    yC,
    yA: p.waterDepth + p.H,
    xTube: p.tubeX,
    zC: p.domainW / 2,
    tEff,
    resFloorY: p.waterDepth + p.H - 0.06,
    A: Math.PI * p.D * p.D / 4,
  };
}

/** Distância 2D (no plano xy) à linha média em L — igual ao intake2d. */
function distToLPath2(
  x: number, y: number, xC: number, yC: number, xTube: number, yA: number, Rc: number,
): number {
  const hx0 = xTube + Rc;
  let d = Infinity;
  {
    const t = Math.min(Math.max(x, hx0), xC);
    d = Math.min(d, Math.hypot(x - t, y - yC));
  }
  {
    const t = Math.min(Math.max(y, yC + Rc), yA);
    d = Math.min(d, Math.hypot(x - xTube, y - t));
  }
  {
    const cx = xTube + Rc, cy = yC + Rc;
    const px = x - cx, py = y - cy;
    if (px <= 0 && py <= 0) d = Math.min(d, Math.abs(Math.hypot(px, py) - Rc));
  }
  return d;
}

export function buildIntake3dSdf(p: Intake3DParams, dx: number): Sdf3 {
  const g = intake3dGeometry(p, dx);
  const rIn = p.D / 2;
  const rOut = rIn + g.tEff;
  const wallW = 0.04;
  const resX0 = g.xTube - p.resW / 2, resX1 = g.xTube + p.resW / 2;
  const resZ0 = g.zC - p.resW / 2, resZ1 = g.zC + p.resW / 2;
  const resTop = g.resFloorY + 0.8;

  return (x, y, z) => {
    // Tubo: a linha média vive no plano z = zC; a distância 3D ao caminho é
    // hipot(distância 2D no plano xy, z − zC) — cilindro de seção circular.
    const d2 = distToLPath2(x, y, g.xC, g.yC, g.xTube, g.yA, p.elbowR);
    const dPath = Math.hypot(d2, z - g.zC);
    let phi = Math.max(dPath - rOut, rIn - dPath, x - g.xC, y - g.yA);

    // Reservatório: piso com furo circular para o tubo + 4 paredes
    const inResXZ = x > resX0 - wallW && x < resX1 + wallW && z > resZ0 - wallW && z < resZ1 + wallW;
    if (inResXZ && y > g.resFloorY - 0.35 && y < resTop + 0.1) {
      // piso (furo onde passa o tubo)
      const rAxis = Math.hypot(x - g.xTube, z - g.zC);
      const dFloor = Math.max(
        Math.abs(y - g.resFloorY) - 0.02,   // laje
        rOut - rAxis,                        // furo
        Math.max(resX0 - x, x - resX1, resZ0 - z, z - resZ1), // extensão
      );
      phi = Math.min(phi, dFloor);
      // paredes (casca lateral)
      const inner = Math.max(resX0 - x, x - resX1, resZ0 - z, z - resZ1); // <0 dentro
      const shell = Math.max(-inner - wallW, inner, g.resFloorY - y, y - resTop);
      phi = Math.min(phi, shell);
    }
    return phi;
  };
}

export function buildIntake3dScene(p: Intake3DParams, dx: number): Scene3D {
  const sdf = buildIntake3dSdf(p, dx);
  const geo = intake3dGeometry(p, dx);
  return {
    sdf,
    bc: {
      xHi: { kind: 'inflow', u: -p.V, belowY: p.waterDepth },
      xLo: { kind: 'outflow', hydroLevel: p.waterDepth },
      yLo: { kind: 'wall' },
      yHi: { kind: 'open' },
      zLo: { kind: 'wall' },   // paredes laterais free-slip
      zHi: { kind: 'wall' },
    },
    postAdvect: (s, _dt) => {
      maintainInflow3d(s, p);
      if (p.drain) drainReservoir3d(s, p, geo);
    },
  };
}

function maintainInflow3d(s: Solver3D, p: Intake3DParams): void {
  const dx = s.dx;
  const bandCells = 2;
  const x0 = s.width - bandCells * dx;
  const nAxis = Math.max(2, Math.round(Math.cbrt(s.params.particlesPerCell)));
  const target = nAxis * nAxis * nAxis;
  const counts = new Map<number, number>();
  for (let k = 0; k < s.count; k++) {
    if (s.px[k] < x0 || s.py[k] > p.waterDepth) continue;
    s.pu[k] = -p.V; s.pv[k] = 0; s.pw[k] = 0;
    for (let d = 0; d < 3; d++) { s.cu[3 * k + d] = 0; s.cv[3 * k + d] = 0; s.cw[3 * k + d] = 0; }
    const ci = Math.min(Math.floor(s.px[k] / dx), s.nx - 1);
    const cj = Math.floor(s.py[k] / dx);
    const ck = Math.min(Math.floor(s.pz[k] / dx), s.nz - 1);
    const c = s.ic(ci, cj, ck);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const jMax = Math.floor(p.waterDepth / dx);
  for (let kz = 0; kz < s.nz; kz++) {
    for (let j = 0; j < jMax; j++) {
      for (let i = s.nx - bandCells; i < s.nx; i++) {
        const c = s.ic(i, j, kz);
        const have = counts.get(c) ?? 0;
        for (let a = have; a < target; a++) {
          const x = (i + s.rng.next()) * dx;
          const y = Math.min((j + s.rng.next()) * dx, p.waterDepth - 1e-6);
          const z = (kz + s.rng.next()) * dx;
          s.addParticle(x, y, z, -p.V, 0, 0);
          s.emitted++;
        }
      }
    }
  }
}

function drainReservoir3d(s: Solver3D, p: Intake3DParams, geo: Intake3DGeometry): void {
  const y0 = geo.resFloorY + 0.03;
  const y1 = y0 + 0.06;
  const rHole = p.D / 2 + geo.tEff;
  for (let k = s.count - 1; k >= 0; k--) {
    const y = s.py[k];
    if (y < y0 || y > y1) continue;
    const x = s.px[k], z = s.pz[k];
    const rAxis = Math.hypot(x - geo.xTube, z - geo.zC);
    if (rAxis < rHole + 0.05) continue; // não drena a coluna do jato
    if (x > geo.xTube - p.resW / 2 && x < geo.xTube + p.resW / 2 &&
        z > geo.zC - p.resW / 2 && z < geo.zC + p.resW / 2) {
      s.removeParticle(k);
      s.drained++;
    }
  }
}

export function makeIntake3dSolver(
  nx: number, p: Intake3DParams, overrides?: Partial<SolverParams3D>,
): Solver3D {
  const dx = p.domainL / nx;
  const ny = Math.round(p.domainH / dx);
  const nz = Math.round(p.domainW / dx);
  const scene = buildIntake3dScene(p, dx);
  const s = new Solver3D(nx, ny, nz, dx, scene, overrides);
  s.seedBlock(0, 0, 0, s.width, p.waterDepth, s.depth, 0.3, () => [-p.V, 0, 0]);
  s.markInitialMass();
  return s;
}

// ------------------------------------------------------------------ sondas

export interface Intake3DMeasurement {
  vNozzle: number;
  flux: number;         // φ [m³/s]
  overpressureC: number;
  dragForce: number;    // [N]
  captureFraction: number; // A_c/A
  tubeFilled: number;
  minPressureAbs: number;
}

export function measureIntake3d(s: Solver3D, p: Intake3DParams): Intake3DMeasurement {
  const dx = s.dx;
  const geo = intake3dGeometry(p, dx);

  // v e φ no plano do bocal (uma linha de faces abaixo de yA)
  const j = Math.min(Math.round(geo.yA / dx) - 1, s.ny - 1);
  let flux = 0, area = 0;
  for (let k = 0; k < s.nz; k++) {
    for (let i = 0; i < s.nx; i++) {
      const x = (i + 0.5) * dx, z = (k + 0.5) * dx;
      if (Math.hypot(x - geo.xTube, z - geo.zC) > p.D / 2) continue;
      const f = s.iv(i, j, k);
      if (s.vW[f] <= 0) continue;
      const cBelow = s.ic(i, Math.max(0, j - 1), k);
      if (s.cellType[cBelow] !== FLUID) { area += dx * dx; continue; }
      flux += s.v[f] * dx * dx;
      area += dx * dx;
    }
  }
  const vNozzle = area > 0 ? flux / area : 0;

  // P_C − P₀ na entrada do duto (0.05–0.15 m para dentro da boca)
  let pSum = 0, pN = 0;
  const i0 = Math.max(0, Math.floor((geo.xC - 0.15) / dx));
  const i1 = Math.max(0, Math.floor((geo.xC - 0.05) / dx));
  for (let k = 0; k < s.nz; k++) {
    for (let jj = 0; jj < s.ny; jj++) {
      const y = (jj + 0.5) * dx, z = (k + 0.5) * dx;
      if (Math.hypot(y - geo.yC, z - geo.zC) > 0.8 * p.D / 2) continue;
      for (let i = i0; i <= i1; i++) {
        const c = s.ic(i, jj, k);
        if (s.cellType[c] !== FLUID) continue;
        pSum += s.p[c];
        pN++;
      }
    }
  }
  const overpressureC = pN > 0 ? pSum / pN : 0;

  // Força de arrasto: integral de pressão de 1ª ordem nas faces x
  let fx = 0;
  for (let k = 0; k < s.nz; k++) {
    for (let jj = 0; jj < s.ny; jj++) {
      for (let i = 0; i < s.nx; i++) {
        const c = s.ic(i, jj, k);
        if (s.cellType[c] !== FLUID) continue;
        if (i + 1 < s.nx && s.cellType[c + 1] === SOLID) {
          fx += s.p[c] * (1 - s.uW[s.iu(i + 1, jj, k)]) * dx * dx;
        }
        if (i - 1 >= 0 && s.cellType[c - 1] === SOLID) {
          fx -= s.p[c] * (1 - s.uW[s.iu(i, jj, k)]) * dx * dx;
        }
      }
    }
  }

  // Fração capturada por retro-integração de traçadores no campo congelado
  const nT = 24; // grade de traçadores (nT×nT) na seção de entrada
  const x0 = Math.min(geo.xC + 1.2, s.width - 3 * dx);
  const dtT = 0.4 * dx / Math.max(p.V, 0.5);
  const maxSteps = Math.ceil((s.width + 8) / (Math.max(p.V, 0.5) * dtT));
  let captured = 0;
  for (let a = 0; a < nT; a++) {
    for (let b = 0; b < nT; b++) {
      let x = x0;
      let y = (a + 0.5) / nT * p.waterDepth;
      let z = (b + 0.5) / nT * s.depth;
      let isCap = false;
      for (let n = 0; n < maxSteps; n++) {
        const [u1, v1, w1] = s.sampleVel(x, y, z);
        const [u2, v2, w2] = s.sampleVel(x + 0.5 * dtT * u1, y + 0.5 * dtT * v1, z + 0.5 * dtT * w1);
        x += dtT * u2; y += dtT * v2; z += dtT * w2;
        // capturado: DENTRO do trecho vertical interno, acima do cotovelo.
        // Raio completo D/2: exigir o núcleo 0.9·D/2 descartava ~19% do
        // tubo de corrente (as linhas rentes à parede) — achado da revisão.
        if (y > geo.yC + p.D / 2 + p.elbowR &&
            Math.hypot(x - geo.xTube, z - geo.zC) < p.D / 2) {
          isCap = true;
          break;
        }
        if (x < geo.xTube - p.D || x <= 2 * dx || x >= s.width - dx) break;
        if (y <= 0 || y >= geo.yA) break;
      }
      if (isCap) captured++;
    }
  }
  const capturedArea = (captured / (nT * nT)) * p.waterDepth * s.depth;
  const captureFraction = capturedArea / geo.A;

  // Fração do tubo vertical cheia
  let tf = 0, tn = 0;
  const jT0 = Math.floor((geo.yC + p.D / 2 + 0.05) / dx);
  const jT1 = Math.floor((geo.yA - 0.05) / dx);
  for (let k = 0; k < s.nz; k++) {
    for (let jj = jT0; jj <= jT1 && jj < s.ny; jj++) {
      for (let i = 0; i < s.nx; i++) {
        const x = (i + 0.5) * dx, z = (k + 0.5) * dx;
        if (Math.hypot(x - geo.xTube, z - geo.zC) > p.D / 2 - dx / 2) continue;
        const c = s.ic(i, jj, k);
        if (s.cellType[c] === SOLID) continue;
        tn++;
        if (s.cellType[c] === FLUID) tf++;
      }
    }
  }

  // pressão mínima (cavitação, §7.3)
  let minP = Infinity;
  for (let c = 0; c < s.p.length; c++) {
    if (s.cellType[c] === FLUID && s.p[c] < minP) minP = s.p[c];
  }

  return {
    vNozzle,
    flux,
    overpressureC,
    dragForce: fx,
    captureFraction,
    tubeFilled: tn > 0 ? tf / tn : 0,
    minPressureAbs: (minP === Infinity ? 0 : minP) + 101325,
  };
}
