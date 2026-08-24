/**
 * Orquestrador do passo de tempo FLIP/APIC 2D (§3.2).
 *
 * Sequência por subpasso (splitting de operadores):
 *   1. Binning das partículas e classificação de células (§3.2.2)
 *   2. Level set do líquido (para ghost-fluid e reamostragem)
 *   3. P2G — transferência APIC partícula→grade (§3.2.1)
 *   4. Forças de corpo: u += g·Δt (§3.2.3)
 *   5. Viscosidade (implícita) + LES Smagorinsky (§3.2.4–5)
 *   6. Projeção de pressão — impõe ∇·u = 0 (§3.2.6)
 *   7. Extrapolação de velocidade para o ar (§3.2.7)
 *   8. G2P — blend FLIP/PIC + matriz afim (§3.2.8)
 *   9. Advecção RK3 (Ralston) + correção contra sólidos (§3.2.9)
 *  10. Reamostragem de partículas (§3.2.10)
 *
 * Passo de tempo adaptativo por CFL (§3.3): Δt = C_cfl·Δx/max|u|,
 * limitado a Δt_max. Tudo determinístico (semente fixa, ordem fixa).
 */

import { Grid2D, DomainBC, FLUID, AIR } from './grid2d';
import { Particles2D } from './particles2d';
import { particlesToGrid, gridToParticles } from './transfer2d';
import { computeLiquidPhi } from './levelset2d';
import { PressureSolver2D } from './pressure2d';
import { ViscositySolver2D } from './viscosity2d';
import { extrapolateField } from './extrapolate2d';
import { projectOut2, type Sdf2 } from './sdf';
import { Rng } from './rng';

export interface SolverParams2D {
  rho: number;            // densidade [kg/m³]
  gy: number;             // gravidade (negativa para baixo) [m/s²]
  flipAlpha: number;      // blend FLIP/PIC α (§3.2.8)
  nu: number;             // viscosidade cinemática molecular [m²/s]
  nuMultiplier: number;   // multiplicador da UI (experimentação)
  noSlip: boolean;        // paredes no-slip (true) ou free-slip (false)
  smagorinskyCs: number;  // C_s do LES (0 desliga)
  bedU: number;           // velocidade tangencial do leito móvel [m/s]
  particlesPerCell: number; // alvo de partículas por célula (2D)
  cflNumber: number;      // C_cfl
  dtMax: number;          // Δt máximo [s]
  pcgTol: number;
  pcgMaxIter: number;
  reseed: boolean;
  seed: number;
}

export function defaultParams2D(): SolverParams2D {
  return {
    rho: 998,
    gy: -9.81,
    flipAlpha: 0.95,
    nu: 1.0e-6,
    nuMultiplier: 1,
    noSlip: false,
    smagorinskyCs: 0.12,
    bedU: 0,
    particlesPerCell: 6,
    cflNumber: 0.9,
    dtMax: 1 / 120,
    pcgTol: 1e-6,
    pcgMaxIter: 200,
    reseed: true,
    seed: 20260823,
  };
}

export interface Scene2D {
  name: string;
  sdf: Sdf2; // sólidos internos (colisão de partículas + cut-cells)
  solidVel: (x: number, y: number) => [number, number];
  bc: DomainBC;
  /** Emissores e sumidouros (inflow/outflow/dreno), rodam após a advecção. */
  postAdvect?: (s: Solver2D, dt: number) => void;
}

export interface StepDiagnostics {
  dt: number;
  pressureIterations: number;
  pressureResidual: number;
  maxDivergence: number;   // máx |∇·u|·Δx/|u|max pós-projeção
  particleCount: number;
  massDriftPct: number;    // deriva de massa (reamostragem) em %
  lostTop: number;         // partículas perdidas pelo topo do domínio
  timings: Record<string, number>; // ms por etapa
}

const EXTRAPOLATE_LAYERS = 8;

export class Solver2D {
  readonly grid: Grid2D;
  readonly parts: Particles2D;
  readonly pressure: PressureSolver2D;
  readonly viscosity: ViscositySolver2D;
  readonly params: SolverParams2D;
  readonly rng: Rng;
  scene: Scene2D;

  time = 0;
  stepCount = 0;

  // Contabilidade de massa (em nº de partículas; massa ∝ contagem)
  initialCount = 0;
  emitted = 0;       // adicionadas por emissores (intencional)
  drained = 0;       // removidas por sumidouros/saída (intencional)
  lostTop = 0;       // perdidas pelo topo aberto (relatado no HUD)
  reseedAdded = 0;   // deriva numérica (reamostragem)
  reseedRemoved = 0;

  diag: StepDiagnostics = {
    dt: 0, pressureIterations: 0, pressureResidual: 0,
    maxDivergence: 0, particleCount: 0, massDriftPct: 0, lostTop: 0,
    timings: {},
  };

  // Binning por célula
  private cellCount: Int32Array;
  private cellHead: Int32Array;
  private partNext: Int32Array;
  private hasParticles: Uint8Array;

  constructor(nx: number, ny: number, dx: number, scene: Scene2D, params?: Partial<SolverParams2D>) {
    this.grid = new Grid2D(nx, ny, dx);
    this.parts = new Particles2D();
    this.params = { ...defaultParams2D(), ...params };
    this.rng = new Rng(this.params.seed);
    this.scene = scene;
    this.grid.bc = scene.bc;
    this.grid.setSolids(scene.sdf, scene.solidVel);
    this.pressure = new PressureSolver2D(this.grid);
    this.pressure.tolerance = this.params.pcgTol;
    this.pressure.maxIterations = this.params.pcgMaxIter;
    this.viscosity = new ViscositySolver2D(this.grid);
    const nc = nx * ny;
    this.cellCount = new Int32Array(nc);
    this.cellHead = new Int32Array(nc);
    this.partNext = new Int32Array(this.parts.capacity);
    this.hasParticles = new Uint8Array(nc);
  }

  /** Raio efetivo da partícula para o level set (função do nº por célula). */
  get particleRadius(): number {
    return 0.9 * this.grid.dx / Math.sqrt(this.params.particlesPerCell);
  }

  /** Marca o estado atual como referência de massa. */
  markInitialMass(): void {
    this.initialCount = this.parts.count;
    this.emitted = 0;
    this.drained = 0;
    this.lostTop = 0;
    this.reseedAdded = 0;
    this.reseedRemoved = 0;
  }

  /** Δt adaptativo pelo CFL (§3.3). */
  computeDt(): number {
    const vmax = Math.max(this.grid.maxSpeed(), 1e-6);
    const dtCfl = this.params.cflNumber * this.grid.dx / vmax;
    return Math.min(this.params.dtMax, dtCfl);
  }

  /** Avança exatamente `duration` segundos em subpassos CFL. */
  advance(duration: number): void {
    let remaining = duration;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 10000) {
      const dt = Math.min(this.computeDt(), remaining);
      this.step(dt);
      remaining -= dt;
    }
  }

  step(dt: number): void {
    const t0 = now();
    const g = this.grid;
    const parts = this.parts;
    const p = this.params;

    // 1. Binning + classificação
    this.binParticles();
    g.classifyCells(this.hasParticles);
    // 2. Level set do líquido
    computeLiquidPhi(parts, g, this.particleRadius);
    const t1 = now();

    // 3. P2G (APIC)
    particlesToGrid(parts, g);
    g.enforceSolidFaces();
    // Campo de referência do blend FLIP: estado pós-transferência
    g.uOld.set(g.u);
    g.vOld.set(g.v);
    const t2 = now();

    // 4. Gravidade: ∂v/∂t = g (aplicada nas faces livres)
    for (let k = 0; k < g.v.length; k++) {
      if (g.vW[k] > 0) g.v[k] += p.gy * dt;
    }

    // 5. Viscosidade + LES
    const nuEff = p.nu * p.nuMultiplier;
    if (nuEff > 0 || p.smagorinskyCs > 0) {
      this.viscosity.step(dt, {
        nu: nuEff,
        noSlip: p.noSlip,
        smagorinskyCs: p.smagorinskyCs,
        bedU: p.bedU,
      });
    }
    g.enforceSolidFaces();
    const t3 = now();

    // 6. Projeção de pressão.
    // Antes dela, TODAS as faces são invalidadas: só as faces efetivamente
    // projetadas (adjacentes a células FLUID) e as de parede voltam a ser
    // válidas. As demais (ar) serão reconstruídas por extrapolação — sem
    // isso, faces de ar guardariam o incremento de gravidade sem o
    // contrapeso da pressão e o erro acumularia a cada passo (instável).
    g.uValid.fill(0);
    g.vValid.fill(0);
    g.enforceSolidFaces();
    const pr = this.pressure.solve(dt, p.rho, Math.abs(p.gy));
    g.enforceSolidFaces();
    const t4 = now();

    // Diagnóstico de divergência (§7.1) — o teste de honestidade do solver
    this.diag.maxDivergence = this.pressure.maxDivergenceNormalized();

    // 7. Extrapolação para o ar
    extrapolateField(g.u, g.uValid, g.nx + 1, g.ny, EXTRAPOLATE_LAYERS);
    extrapolateField(g.v, g.vValid, g.nx, g.ny + 1, EXTRAPOLATE_LAYERS);
    const t5 = now();

    // 8. G2P (blend FLIP/PIC + APIC)
    gridToParticles(parts, g, p.flipAlpha);
    const t6 = now();

    // 9. Advecção RK3 (Ralston): x' = u(x)
    this.advectParticles(dt);
    if (this.scene.postAdvect) this.scene.postAdvect(this, dt);
    const t7 = now();

    // 10. Reamostragem
    if (p.reseed) this.reseedParticles();
    const t8 = now();

    this.time += dt;
    this.stepCount++;

    this.diag.dt = dt;
    this.diag.pressureIterations = pr.iterations;
    this.diag.pressureResidual = pr.relResidual;
    this.diag.particleCount = parts.count;
    this.diag.lostTop = this.lostTop;
    const expected = this.initialCount + this.emitted - this.drained - this.lostTop;
    this.diag.massDriftPct = this.initialCount > 0
      ? (100 * (parts.count - expected)) / this.initialCount
      : 0;
    this.diag.timings = {
      classify: t1 - t0, p2g: t2 - t1, forces: t3 - t2,
      pressure: t4 - t3, extrapolate: t5 - t4, g2p: t6 - t5,
      advect: t7 - t6, reseed: t8 - t7,
    };
  }

  // ------------------------------------------------------------- advecção

  private advectParticles(dt: number): void {
    const g = this.grid;
    const parts = this.parts;
    const sdf = this.scene.sdf;
    const eps = 0.01 * g.dx;
    const W = g.width;
    const H = g.height;
    const bc = g.bc;

    for (let k = parts.count - 1; k >= 0; k--) {
      const x0 = parts.x[k];
      const y0 = parts.y[k];
      // RK3 de Ralston: x1 = x + Δt·(2k1 + 3k2 + 4k3)/9
      const [u1, v1] = g.sampleVel(x0, y0);
      const [u2, v2] = g.sampleVel(x0 + 0.5 * dt * u1, y0 + 0.5 * dt * v1);
      const [u3, v3] = g.sampleVel(x0 + 0.75 * dt * u2, y0 + 0.75 * dt * v2);
      let x = x0 + dt * (2 * u1 + 3 * u2 + 4 * u3) / 9;
      let y = y0 + dt * (2 * v1 + 3 * v2 + 4 * v3) / 9;

      // Correção contra sólidos: projeção para fora ao longo da normal do SDF
      if (sdf(x, y) < eps) {
        [x, y] = projectOut2(sdf, x, y, eps);
      }

      // Bordas do domínio
      let dead = false;
      if (x < 0) {
        if (bc.left.kind === 'wall' || bc.left.kind === 'inflow') x = eps;
        else { dead = true; this.drained++; }
      } else if (x > W) {
        if (bc.right.kind === 'wall' || bc.right.kind === 'inflow') x = W - eps;
        else { dead = true; this.drained++; }
      }
      if (!dead) {
        if (y < 0) {
          if (bc.bottom.kind === 'wall' || bc.bottom.kind === 'inflow') y = eps;
          else { dead = true; this.drained++; }
        } else if (y > H) {
          if (bc.top.kind === 'open') { dead = true; this.lostTop++; }
          else y = H - eps;
        }
      }

      if (dead) {
        parts.remove(k);
      } else {
        parts.x[k] = x;
        parts.y[k] = y;
      }
    }
  }

  // ------------------------------------------------------------ binning

  private binParticles(): void {
    const g = this.grid;
    const parts = this.parts;
    const nc = g.nx * g.ny;
    if (this.partNext.length < parts.capacity) {
      this.partNext = new Int32Array(parts.capacity);
    }
    this.cellCount.fill(0);
    this.cellHead.fill(-1);
    this.hasParticles.fill(0);
    const inv = 1 / g.dx;
    for (let k = 0; k < parts.count; k++) {
      let i = Math.floor(parts.x[k] * inv);
      let j = Math.floor(parts.y[k] * inv);
      i = Math.min(Math.max(i, 0), g.nx - 1);
      j = Math.min(Math.max(j, 0), g.ny - 1);
      const c = g.ic(i, j);
      this.cellCount[c]++;
      this.partNext[k] = this.cellHead[c];
      this.cellHead[c] = k;
      this.hasParticles[c] = 1;
    }
  }

  // --------------------------------------------------------- reamostragem

  /**
   * Mantém a densidade de partículas por célula (§3.2.10): insere em células
   * profundas com déficit; remove excedentes. Alterações aqui são DERIVA DE
   * MASSA e são contabilizadas (reseedAdded/reseedRemoved).
   *
   * Duas lições da revisão adversarial estão codificadas aqui:
   * 1. O binning é REFEITO após a advecção — as listas do início do passo
   *    apontariam para índices trocados pelos swap-remove da advecção e dos
   *    emissores (partícula errada removida).
   * 2. "Profundo" é definido por ocupação (célula e 4 vizinhas com
   *    partículas, longe de sólidos) — o gate anterior φ < −Δx era
   *    inatingível (o level set de união de bolas nunca desce de −r) e a
   *    reamostragem era código morto.
   */
  private reseedParticles(): void {
    const g = this.grid;
    const parts = this.parts;
    const target = this.params.particlesPerCell;
    const minCount = Math.max(2, Math.floor(target / 2));
    // Limite de remoção folgado (3×): aglomerações transitórias em
    // respingos representam volume real — remover cedo perde massa.
    const maxCount = target * 12; // poda APENAS como salvaguarda de memória: qualquer limiar regulador (3x, 6x) removia 20-27% de massa real nas zonas de estagnação onde o FLIP empacota; o P2G normaliza por massa, então a densidade de particulas nao distorce a fisica
    const dx = g.dx;

    // Binning fresco (pós-advecção)
    this.binParticles();
    const count = this.cellCount;
    const kill: number[] = [];
    const { nx, ny } = g;

    // "Profundo" = nenhuma OUTRA célula de AR num raio de 2 células. Com o
    // clustering natural do FLIP, "completar células rarefeitas" adiciona
    // sistematicamente mais do que remove (+119% de massa medidos num
    // sloshing de 30 s). A política honesta compatível com deriva < 1%:
    //  - INSERIR apenas em VAZIOS reais (célula interior com 0 partículas,
    //    que viraria AR no meio do fluido e quebraria a classificação);
    //  - REMOVER apenas aglomerações extremas (> 3× o alvo) profundas.
    // A equalização estrita de 4–8/célula do §3.2.10 é incompatível com a
    // conservação de massa exigida — documentado em NUMERICA.md.
    const deep = (i: number, j: number, c: number): boolean => {
      if (i < 2 || i >= nx - 2 || j < 2 || j >= ny - 2) return false;
      if (g.solidPhiCenter[c] <= 0.75 * dx) return false;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          if (di === 0 && dj === 0) continue; // o próprio vazio não conta
          if (g.cellType[c + di + dj * nx] === AIR) return false;
        }
      }
      return true;
    };
    // Trava anti-runaway: no máximo 0.5% de partículas novas por passo
    let addBudget = Math.max(16, Math.floor(0.005 * parts.count));

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = g.ic(i, j);
        if (g.solidPhiCenter[c] < 0) continue;
        const n = count[c];
        if (n > maxCount && deep(i, j, c)) {
          let p = this.cellHead[c];
          let seen = 0;
          while (p >= 0) {
            seen++;
            if (seen > maxCount) kill.push(p);
            p = this.partNext[p];
          }
        } else if (n === 0 && addBudget > 0 && deep(i, j, c)) {
          // Vazio interior: REALOCA uma partícula da célula vizinha mais
          // aglomerada (neutro em massa — criar partícula aqui adicionaria
          // volume que a projeção empurra para cima: +21% medidos).
          let best = -1;
          let bestN = target; // só rouba de célula acima do alvo
          for (const cn of [c - 1, c + 1, c - nx, c + nx]) {
            if (count[cn] > bestN) { bestN = count[cn]; best = cn; }
          }
          if (best >= 0) {
            const p = this.cellHead[best];
            if (p >= 0) {
              this.cellHead[best] = this.partNext[p];
              count[best]--;
              count[c]++;
              const px = (i + this.rng.next()) * dx;
              const py = (j + this.rng.next()) * dx;
              if (this.scene.sdf(px, py) > 0) {
                parts.x[p] = px;
                parts.y[p] = py;
                const [u, v] = g.sampleVel(px, py);
                parts.u[p] = u; parts.v[p] = v;
                parts.cux[p] = 0; parts.cuy[p] = 0;
                parts.cvx[p] = 0; parts.cvy[p] = 0;
                this.reseedAdded++; // contabilizado como realocação
                addBudget--;
              }
            }
          }
        }
      }
    }
    // Remove em ordem decrescente de índice (swap-remove seguro)
    kill.sort((a, b) => b - a);
    for (const k of kill) {
      parts.remove(k);
      this.reseedRemoved++;
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
