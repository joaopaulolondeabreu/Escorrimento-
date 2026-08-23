/**
 * Projeção de pressão (§3.2.6): resolve a equação de Poisson
 *
 *   ∇·( (Δt/ρ) ∇p ) = ∇·u*
 *
 * e subtrai (Δt/ρ)∇p de u*, tornando o campo (discretamente) livre de
 * divergência — é este passo que impõe a incompressibilidade ∇·u = 0.
 *
 * Discretização: 5 pontos na grade MAC com
 *  - frações de face (cut-cell) para paredes que cortam células (§4.3);
 *  - ghost-fluid na superfície livre: p = 0 (= P₀ relativo) aplicado na
 *    POSIÇÃO da interface via θ = φ_F/(φ_F − φ_A), não na célula inteira;
 *  - Dirichlet nas bordas 'open' (p'=0) e 'outflow' (p' hidrostático).
 *
 * Solver: Gradiente Conjugado com pré-condicionador MIC(0) (Cholesky
 * incompleto modificado, receita de Bridson), tolerância relativa 1e-6 ou
 * 200 iterações (§3.2.6). A matriz é simétrica positiva-definida.
 */

import { AIR, FLUID, Grid2D, SOLID } from './grid2d';

export interface PressureSolveResult {
  iterations: number;
  relResidual: number;
}

const THETA_MIN = 0.02; // evita coeficientes 1/θ explosivos em células rasas

export class PressureSolver2D {
  private readonly g: Grid2D;
  private Adiag: Float64Array;
  private Aplusi: Float64Array;
  private Aplusj: Float64Array;
  private rhs: Float64Array;
  private precon: Float64Array;
  private r: Float64Array;
  private z: Float64Array;
  private s: Float64Array;
  private q: Float64Array;

  maxIterations = 200;
  tolerance = 1e-6;

  constructor(g: Grid2D) {
    this.g = g;
    const nc = g.nx * g.ny;
    this.Adiag = new Float64Array(nc);
    this.Aplusi = new Float64Array(nc);
    this.Aplusj = new Float64Array(nc);
    this.rhs = new Float64Array(nc);
    this.precon = new Float64Array(nc);
    this.r = new Float64Array(nc);
    this.z = new Float64Array(nc);
    this.s = new Float64Array(nc);
    this.q = new Float64Array(nc);
  }

  /** θ (fração molhada) entre célula fluida kF e célula de ar kA. */
  private theta(kF: number, kA: number): number {
    const phiF = this.g.liquidPhi[kF];
    const phiA = this.g.liquidPhi[kA];
    if (phiF < 0 && phiA >= 0) {
      return Math.max(THETA_MIN, phiF / (phiF - phiA));
    }
    return 0.5; // fallback (ex.: respingo isolado marcado FLUID com φ ≥ 0)
  }

  /** Pressão de Dirichlet p' na borda 'outflow' (perfil hidrostático). */
  private outflowP(y: number, level: number, rho: number, gmag: number): number {
    return rho * gmag * Math.max(0, level - y);
  }

  /**
   * Monta e resolve o sistema; aplica o gradiente em g.u/g.v.
   * `dt` em segundos, `rho` em kg/m³, `gmag` = |g| (para a borda outflow).
   */
  solve(dt: number, rho: number, gmag: number): PressureSolveResult {
    const g = this.g;
    const { nx, ny, dx } = g;
    const { Adiag, Aplusi, Aplusj, rhs } = this;
    Adiag.fill(0); Aplusi.fill(0); Aplusj.fill(0); rhs.fill(0);
    g.p.fill(0);

    // Fator da equação: cada termo w·(p_k − p_n)·Δt/(ρ·Δx²) = −div.
    // Fatoramos Δt/(ρ·Δx²): a matriz fica adimensional e
    // b = −div·ρ·Δx²/Δt  (unidades de pressão).
    const bScale = (rho * dx * dx) / dt;
    let hasDirichlet = false;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = g.ic(i, j);
        if (g.cellType[k] !== FLUID) continue;

        rhs[k] = -g.divergence(i, j) * bScale;

        // --- vizinho à direita (i+1,j), face u(i+1,j)
        {
          const w = g.uW[g.iu(i + 1, j)];
          if (w > 0) {
            if (i + 1 < nx) {
              const kn = k + 1;
              const t = g.cellType[kn];
              if (t === FLUID) { Adiag[k] += w; Aplusi[k] -= w; }
              else if (t === AIR) { Adiag[k] += w / this.theta(k, kn); hasDirichlet = true; }
              // SOLID: sem termo (∂p/∂n = 0)
            } else if (g.bc.right.kind === 'open') {
              Adiag[k] += w; hasDirichlet = true; // p ghost = 0
            } else if (g.bc.right.kind === 'outflow') {
              Adiag[k] += w; hasDirichlet = true;
              rhs[k] += w * this.outflowP((j + 0.5) * dx, g.bc.right.hydroLevel, rho, gmag);
            }
          }
        }
        // --- vizinho à esquerda (i-1,j), face u(i,j)
        {
          const w = g.uW[g.iu(i, j)];
          if (w > 0) {
            if (i - 1 >= 0) {
              const kn = k - 1;
              const t = g.cellType[kn];
              if (t === FLUID) Adiag[k] += w; // off-diag guardado em Aplusi[kn]
              else if (t === AIR) { Adiag[k] += w / this.theta(k, kn); hasDirichlet = true; }
            } else if (g.bc.left.kind === 'open') {
              Adiag[k] += w; hasDirichlet = true;
            } else if (g.bc.left.kind === 'outflow') {
              Adiag[k] += w; hasDirichlet = true;
              rhs[k] += w * this.outflowP((j + 0.5) * dx, g.bc.left.hydroLevel, rho, gmag);
            }
          }
        }
        // --- vizinho acima (i,j+1), face v(i,j+1)
        {
          const w = g.vW[g.iv(i, j + 1)];
          if (w > 0) {
            if (j + 1 < ny) {
              const kn = k + nx;
              const t = g.cellType[kn];
              if (t === FLUID) { Adiag[k] += w; Aplusj[k] -= w; }
              else if (t === AIR) { Adiag[k] += w / this.theta(k, kn); hasDirichlet = true; }
            } else if (g.bc.top.kind === 'open') {
              Adiag[k] += w; hasDirichlet = true;
            }
          }
        }
        // --- vizinho abaixo (i,j-1), face v(i,j)
        {
          const w = g.vW[g.iv(i, j)];
          if (w > 0) {
            if (j - 1 >= 0) {
              const kn = k - nx;
              const t = g.cellType[kn];
              if (t === FLUID) Adiag[k] += w;
              else if (t === AIR) { Adiag[k] += w / this.theta(k, kn); hasDirichlet = true; }
            } else if (g.bc.bottom.kind === 'open') {
              Adiag[k] += w; hasDirichlet = true;
            }
          }
        }

        // Célula fluida totalmente cercada por sólido: sem equação útil
        if (Adiag[k] === 0) rhs[k] = 0;
      }
    }

    // Sistema fechado (sem superfície livre nem borda aberta — ex.: teste de
    // Taylor–Green): a matriz de Neumann pura é singular; a pressão só é
    // definida a menos de constante. Tornamos o RHS compatível (média zero
    // sobre as células com equação) e regularizamos a diagonal de leve —
    // isso não altera o gradiente de pressão.
    if (!hasDirichlet) {
      let sum = 0;
      let n = 0;
      for (let k = 0; k < rhs.length; k++) {
        if (g.cellType[k] === FLUID && Adiag[k] > 0) { sum += rhs[k]; n++; }
      }
      if (n > 0) {
        const mean = sum / n;
        for (let k = 0; k < rhs.length; k++) {
          if (g.cellType[k] === FLUID && Adiag[k] > 0) {
            rhs[k] -= mean;
            Adiag[k] += 1e-8;
          }
        }
      }
    }

    const res = this.pcg();
    this.applyGradient(dt, rho, gmag);
    return res;
  }

  // -------------------------------------------------------------- PCG MIC(0)

  private buildPrecon(): void {
    const g = this.g;
    const { nx, ny } = g;
    const { Adiag, Aplusi, Aplusj, precon } = this;
    const tau = 0.97;   // fator "modificado" do MIC
    const sigma = 0.25; // salvaguarda de diagonal
    precon.fill(0);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = g.ic(i, j);
        if (g.cellType[k] !== FLUID || Adiag[k] === 0) continue;
        const kL = i > 0 ? k - 1 : -1;
        const kB = j > 0 ? k - nx : -1;
        let e = Adiag[k];
        if (kL >= 0 && g.cellType[kL] === FLUID) {
          const t = Aplusi[kL] * precon[kL];
          e -= t * t + tau * (Aplusi[kL] * Aplusj[kL] * precon[kL] * precon[kL]);
        }
        if (kB >= 0 && g.cellType[kB] === FLUID) {
          const t = Aplusj[kB] * precon[kB];
          e -= t * t + tau * (Aplusj[kB] * Aplusi[kB] * precon[kB] * precon[kB]);
        }
        if (e < sigma * Adiag[k]) e = Adiag[k];
        precon[k] = 1 / Math.sqrt(e + 1e-30);
      }
    }
  }

  private applyPrecon(dst: Float64Array, src: Float64Array): void {
    const g = this.g;
    const { nx, ny } = g;
    const { Aplusi, Aplusj, precon, q } = this;
    // L q = src (substituição direta)
    q.fill(0);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = g.ic(i, j);
        if (g.cellType[k] !== FLUID || precon[k] === 0) continue;
        let t = src[k];
        if (i > 0 && g.cellType[k - 1] === FLUID) t -= Aplusi[k - 1] * precon[k - 1] * q[k - 1];
        if (j > 0 && g.cellType[k - nx] === FLUID) t -= Aplusj[k - nx] * precon[k - nx] * q[k - nx];
        q[k] = t * precon[k];
      }
    }
    // Lᵀ dst = q (substituição reversa)
    dst.fill(0);
    for (let j = ny - 1; j >= 0; j--) {
      for (let i = nx - 1; i >= 0; i--) {
        const k = g.ic(i, j);
        if (g.cellType[k] !== FLUID || precon[k] === 0) continue;
        let t = q[k];
        if (i + 1 < nx && g.cellType[k + 1] === FLUID) t -= Aplusi[k] * precon[k] * dst[k + 1];
        if (j + 1 < ny && g.cellType[k + nx] === FLUID) t -= Aplusj[k] * precon[k] * dst[k + nx];
        dst[k] = t * precon[k];
      }
    }
  }

  private applyA(dst: Float64Array, src: Float64Array): void {
    const g = this.g;
    const { nx, ny } = g;
    const { Adiag, Aplusi, Aplusj } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = g.ic(i, j);
        if (g.cellType[k] !== FLUID) { dst[k] = 0; continue; }
        let t = Adiag[k] * src[k];
        if (i + 1 < nx) t += Aplusi[k] * src[k + 1];
        if (i > 0) t += Aplusi[k - 1] * src[k - 1];
        if (j + 1 < ny) t += Aplusj[k] * src[k + nx];
        if (j > 0) t += Aplusj[k - nx] * src[k - nx];
        dst[k] = t;
      }
    }
  }

  private dot(a: Float64Array, b: Float64Array): number {
    // Ordem de redução fixa (determinismo, §3.3)
    let s = 0;
    for (let k = 0; k < a.length; k++) s += a[k] * b[k];
    return s;
  }

  private maxAbs(a: Float64Array): number {
    let m = 0;
    for (let k = 0; k < a.length; k++) {
      const v = Math.abs(a[k]);
      if (v > m) m = v;
    }
    return m;
  }

  private pcg(): PressureSolveResult {
    const g = this.g;
    const { r, z, s, rhs } = this;
    const p = g.p;

    r.set(rhs);
    const r0 = this.maxAbs(r);
    if (r0 < 1e-14) return { iterations: 0, relResidual: 0 };

    this.buildPrecon();
    this.applyPrecon(z, r);
    s.set(z);
    let sigma = this.dot(z, r);
    let it = 0;
    let rel = 1;

    for (it = 0; it < this.maxIterations; it++) {
      this.applyA(z, s);
      const sz = this.dot(s, z);
      if (sz <= 0) break;
      const alpha = sigma / sz;
      for (let k = 0; k < p.length; k++) {
        p[k] += alpha * s[k];
        r[k] -= alpha * z[k];
      }
      rel = this.maxAbs(r) / r0;
      if (rel < this.tolerance) { it++; break; }
      this.applyPrecon(z, r);
      const sigmaNew = this.dot(z, r);
      const beta = sigmaNew / sigma;
      for (let k = 0; k < s.length; k++) s[k] = z[k] + beta * s[k];
      sigma = sigmaNew;
    }
    return { iterations: it, relResidual: rel };
  }

  // ------------------------------------------------- gradiente de pressão

  /**
   * u ← u − (Δt/ρ)·∇p, com ghost-fluid na superfície e Dirichlet nas bordas
   * abertas. Faces adjacentes a células SOLID (com fração > 0) não são
   * projetadas (∂p/∂n = 0) — o valor vem da transferência/extrapolação.
   */
  private applyGradient(dt: number, rho: number, gmag: number): void {
    const g = this.g;
    const { nx, ny, dx } = g;
    const scale = dt / (rho * dx);
    const p = g.p;

    // Faces u
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const kf = g.iu(i, j);
        if (g.uW[kf] <= 0) continue; // parede: já imposto em enforceSolidFaces
        const kL = i > 0 ? g.ic(i - 1, j) : -1;
        const kR = i < nx ? g.ic(i, j) : -1;
        const tL = kL >= 0 ? g.cellType[kL] : -1;
        const tR = kR >= 0 ? g.cellType[kR] : -1;

        if (tL === FLUID && tR === FLUID) {
          g.u[kf] -= scale * (p[kR] - p[kL]);
          g.uValid[kf] = 1;
        } else if (tL === FLUID && tR === AIR) {
          const th = this.theta(kL, kR);
          const pGhost = p[kL] * (1 - 1 / th);
          g.u[kf] -= scale * (pGhost - p[kL]);
          g.uValid[kf] = 1;
        } else if (tR === FLUID && tL === AIR) {
          const th = this.theta(kR, kL);
          const pGhost = p[kR] * (1 - 1 / th);
          g.u[kf] -= scale * (p[kR] - pGhost);
          g.uValid[kf] = 1;
        } else if (tR === FLUID && kL < 0) {
          // Borda esquerda aberta/saída
          const side = g.bc.left;
          const pb = side.kind === 'outflow'
            ? rho * gmag * Math.max(0, side.hydroLevel - (j + 0.5) * dx)
            : 0;
          g.u[kf] -= scale * (p[kR] - pb);
          g.uValid[kf] = 1;
        } else if (tL === FLUID && kR < 0) {
          const side = g.bc.right;
          const pb = side.kind === 'outflow'
            ? rho * gmag * Math.max(0, side.hydroLevel - (j + 0.5) * dx)
            : 0;
          g.u[kf] -= scale * (pb - p[kL]);
          g.uValid[kf] = 1;
        }
        // FLUID|SOLID ou AIR|AIR: sem projeção nesta face
      }
    }
    // Faces v
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const kf = g.iv(i, j);
        if (g.vW[kf] <= 0) continue;
        const kB = j > 0 ? g.ic(i, j - 1) : -1;
        const kT = j < ny ? g.ic(i, j) : -1;
        const tB = kB >= 0 ? g.cellType[kB] : -1;
        const tT = kT >= 0 ? g.cellType[kT] : -1;

        if (tB === FLUID && tT === FLUID) {
          g.v[kf] -= scale * (p[kT] - p[kB]);
          g.vValid[kf] = 1;
        } else if (tB === FLUID && tT === AIR) {
          const th = this.theta(kB, kT);
          const pGhost = p[kB] * (1 - 1 / th);
          g.v[kf] -= scale * (pGhost - p[kB]);
          g.vValid[kf] = 1;
        } else if (tT === FLUID && tB === AIR) {
          const th = this.theta(kT, kB);
          const pGhost = p[kT] * (1 - 1 / th);
          g.v[kf] -= scale * (p[kT] - pGhost);
          g.vValid[kf] = 1;
        } else if (tT === FLUID && kB < 0 && g.bc.bottom.kind === 'open') {
          g.v[kf] -= scale * p[kT];
          g.vValid[kf] = 1;
        } else if (tB === FLUID && kT < 0 && g.bc.top.kind === 'open') {
          g.v[kf] -= scale * (0 - p[kB]);
          g.vValid[kf] = 1;
        }
      }
    }
  }

  /**
   * Diagnóstico pós-projeção (§7.1): máx |∇·u|·Δx/|u|_max sobre células
   * fluidas — deve ficar abaixo de 1e-4.
   */
  maxDivergenceNormalized(): number {
    const g = this.g;
    let maxDiv = 0;
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = g.ic(i, j);
        if (g.cellType[k] !== FLUID) continue;
        const d = Math.abs(g.divergence(i, j));
        if (d > maxDiv) maxDiv = d;
      }
    }
    const umax = g.maxSpeed();
    return umax > 1e-12 ? (maxDiv * g.dx) / umax : maxDiv * g.dx;
  }
}
