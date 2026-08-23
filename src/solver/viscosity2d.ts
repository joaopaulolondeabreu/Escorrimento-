/**
 * Termo viscoso (§3.2.4) e modelo de submalha LES Smagorinsky (§3.2.5).
 *
 * Viscosidade molecular: difusão implícita (Backward Euler),
 *   (I − Δt·ν·∇²) uⁿ⁺¹ = u*,
 * resolvida por Gradiente Conjugado, componente a componente, nas faces
 * adjacentes a células FLUID. Incondicionalmente estável — necessário para o
 * teste de Poiseuille com viscosidade elevada (§7.1).
 *
 * Condições de contorno viscosas (§4.3). Para cada componente de velocidade,
 * a direção do vizinho decide o tipo de condição:
 *  - vizinho na direção DA PRÓPRIA componente (ex.: vizinho em x de uma face
 *    u): é a componente NORMAL à parede, que é conhecida (u·n = u_solid·n)
 *    tanto em no-slip quanto em free-slip → Dirichlet na face vizinha;
 *  - vizinho na direção TANGENCIAL (ex.: vizinho em y de uma face u):
 *      no-slip  → parede a meia célula, fantasma refletido
 *                 u_ghost = 2·u_parede − u_face  (diagonal +2c);
 *      free-slip→ ∂u_t/∂n = 0 → vizinho omitido (Neumann homogêneo);
 *  - superfície livre / ar: tensão nula ≈ ∂u/∂n = 0 (vizinho omitido).
 *
 * LES Smagorinsky (§3.2.5): ν_t = (C_s·Δ)²·|S̄| com |S̄| = √(2 S̄:S̄),
 * aplicado como difusão EXPLÍCITA com limitador de estabilidade
 * ν_t ≤ 0.2·Δx²/Δt. Documentado no README: isto é LES, não DNS.
 */

import { FLUID, Grid2D } from './grid2d';

export interface ViscosityParams {
  nu: number;            // viscosidade cinemática molecular × multiplicador
  noSlip: boolean;       // true = no-slip, false = free-slip nas paredes
  smagorinskyCs: number; // 0 desliga o LES
  bedU: number;          // velocidade tangencial do leito (parede móvel)
}

export class ViscositySolver2D {
  private g: Grid2D;
  private rhsU: Float64Array; private rhsV: Float64Array;
  private rU: Float64Array; private rV: Float64Array;
  private pU: Float64Array; private pV: Float64Array;
  private qU: Float64Array; private qV: Float64Array;
  private activeU: Uint8Array; private activeV: Uint8Array;
  private nuT: Float64Array;

  constructor(g: Grid2D) {
    this.g = g;
    const nu = (g.nx + 1) * g.ny;
    const nv = g.nx * (g.ny + 1);
    this.rhsU = new Float64Array(nu); this.rhsV = new Float64Array(nv);
    this.rU = new Float64Array(nu); this.rV = new Float64Array(nv);
    this.pU = new Float64Array(nu); this.pV = new Float64Array(nv);
    this.qU = new Float64Array(nu); this.qV = new Float64Array(nv);
    this.activeU = new Uint8Array(nu); this.activeV = new Uint8Array(nv);
    this.nuT = new Float64Array(g.nx * g.ny);
  }

  /** Marca faces ativas: fração livre > 0 e adjacentes a célula FLUID. */
  private markActive(): void {
    const g = this.g;
    const { nx, ny } = g;
    this.activeU.fill(0);
    this.activeV.fill(0);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const k = g.iu(i, j);
        if (g.uW[k] <= 0) continue;
        const fl = i > 0 && g.cellType[g.ic(i - 1, j)] === FLUID;
        const fr = i < nx && g.cellType[g.ic(i, j)] === FLUID;
        if (fl || fr) this.activeU[k] = 1;
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = g.iv(i, j);
        if (g.vW[k] <= 0) continue;
        const fb = j > 0 && g.cellType[g.ic(i, j - 1)] === FLUID;
        const ft = j < ny && g.cellType[g.ic(i, j)] === FLUID;
        if (fb || ft) this.activeV[k] = 1;
      }
    }
  }

  /**
   * Operador (I + c·L̂) da componente u, onde L̂ é o negativo do Laplaciano
   * discreto com as BCs acima (somente a parte homogênea; os valores
   * Dirichlet conhecidos entram no RHS via buildRhs). `withRhs` acumula
   * também as contribuições Dirichlet em rhs (mesma varredura, um só lugar
   * para a lógica de contorno — evita divergência entre operador e RHS).
   */
  private sweepU(
    dst: Float64Array | null, src: Float64Array, c: number,
    noSlip: boolean, periodicX: boolean, bedU: number,
    rhs: Float64Array | null,
  ): void {
    const g = this.g;
    const { nx, ny } = g;
    const stride = nx + 1;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const k = i + j * stride;
        if (!this.activeU[k]) { if (dst) dst[k] = src[k]; continue; }
        let diag = 1;
        let off = 0;
        // ---- x− (direção normal: Dirichlet sempre que houver parede)
        {
          let kn = -1;
          if (i > 0) kn = k - 1;
          else if (periodicX) kn = (nx - 1) + j * stride;
          if (kn >= 0) {
            if (this.activeU[kn]) { diag += c; off -= c * src[kn]; }
            else if (g.uW[kn] <= 0) { diag += c; if (rhs) rhs[k] += c * g.uSolid[kn]; }
            // face de ar: Neumann (nada)
          }
        }
        // ---- x+
        {
          let kn = -1;
          if (i < nx) kn = k + 1;
          else if (periodicX) kn = 1 + j * stride;
          if (kn >= 0) {
            if (this.activeU[kn]) { diag += c; off -= c * src[kn]; }
            else if (g.uW[kn] <= 0) { diag += c; if (rhs) rhs[k] += c * g.uSolid[kn]; }
          }
        }
        // ---- y− (tangencial)
        {
          if (j > 0) {
            const kn = k - stride;
            if (this.activeU[kn]) { diag += c; off -= c * src[kn]; }
            else if (g.uW[kn] <= 0 && noSlip) {
              diag += 2 * c;
              if (rhs) rhs[k] += 2 * c * g.uSolid[kn];
            }
          } else if (g.bc.bottom.kind !== 'open' && noSlip) {
            // leito do canal: parede móvel a bedU (§4.3)
            diag += 2 * c;
            if (rhs) rhs[k] += 2 * c * bedU;
          }
        }
        // ---- y+ (tangencial)
        {
          if (j < ny - 1) {
            const kn = k + stride;
            if (this.activeU[kn]) { diag += c; off -= c * src[kn]; }
            else if (g.uW[kn] <= 0 && noSlip) {
              diag += 2 * c;
              if (rhs) rhs[k] += 2 * c * g.uSolid[kn];
            }
          } else if (g.bc.top.kind === 'wall' && noSlip) {
            diag += 2 * c;
          }
        }
        if (dst) dst[k] = diag * src[k] + off;
      }
    }
  }

  private sweepV(
    dst: Float64Array | null, src: Float64Array, c: number,
    noSlip: boolean, periodicX: boolean,
    rhs: Float64Array | null,
  ): void {
    const g = this.g;
    const { nx, ny } = g;
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = i + j * nx;
        if (!this.activeV[k]) { if (dst) dst[k] = src[k]; continue; }
        let diag = 1;
        let off = 0;
        // ---- x− (tangencial)
        {
          if (i > 0) {
            const kn = k - 1;
            if (this.activeV[kn]) { diag += c; off -= c * src[kn]; }
            else if (g.vW[kn] <= 0 && noSlip) {
              diag += 2 * c;
              if (rhs) rhs[k] += 2 * c * g.vSolid[kn];
            }
          } else if (periodicX) {
            const kn = (nx - 1) + j * nx;
            if (this.activeV[kn]) { diag += c; off -= c * src[kn]; }
          } else if ((g.bc.left.kind === 'wall' || g.bc.left.kind === 'inflow') && noSlip) {
            diag += 2 * c; // v tangencial da parede lateral = 0
          }
        }
        // ---- x+
        {
          if (i < nx - 1) {
            const kn = k + 1;
            if (this.activeV[kn]) { diag += c; off -= c * src[kn]; }
            else if (g.vW[kn] <= 0 && noSlip) {
              diag += 2 * c;
              if (rhs) rhs[k] += 2 * c * g.vSolid[kn];
            }
          } else if (periodicX) {
            const kn = 0 + j * nx;
            if (this.activeV[kn]) { diag += c; off -= c * src[kn]; }
          } else if ((g.bc.right.kind === 'wall' || g.bc.right.kind === 'inflow') && noSlip) {
            diag += 2 * c;
          }
        }
        // ---- y− (direção normal: Dirichlet sempre)
        {
          if (j > 0) {
            const kn = k - nx;
            if (this.activeV[kn]) { diag += c; off -= c * src[kn]; }
            else if (g.vW[kn] <= 0) { diag += c; if (rhs) rhs[k] += c * g.vSolid[kn]; }
          }
        }
        // ---- y+
        {
          if (j < ny) {
            const kn = k + nx;
            if (this.activeV[kn]) { diag += c; off -= c * src[kn]; }
            else if (g.vW[kn] <= 0) { diag += c; if (rhs) rhs[k] += c * g.vSolid[kn]; }
          }
        }
        if (dst) dst[k] = diag * src[k] + off;
      }
    }
  }

  /** CG genérico (matriz SPD, diagonal dominante — converge rápido). */
  private cg(
    x: Float64Array, rhs: Float64Array, active: Uint8Array,
    applyOp: (dst: Float64Array, src: Float64Array) => void,
    r: Float64Array, p: Float64Array, q: Float64Array,
  ): number {
    applyOp(q, x);
    let rr = 0;
    for (let k = 0; k < x.length; k++) {
      r[k] = active[k] ? rhs[k] - q[k] : 0;
      rr += r[k] * r[k];
    }
    const rr0 = rr;
    if (rr0 < 1e-24) return 0;
    p.set(r);
    let it = 0;
    for (it = 0; it < 400; it++) {
      applyOp(q, p);
      let pq = 0;
      for (let k = 0; k < x.length; k++) if (active[k]) pq += p[k] * q[k];
      if (pq <= 0) break;
      const alpha = rr / pq;
      let rrNew = 0;
      for (let k = 0; k < x.length; k++) {
        if (!active[k]) continue;
        x[k] += alpha * p[k];
        r[k] -= alpha * q[k];
        rrNew += r[k] * r[k];
      }
      if (rrNew < 1e-16 * rr0 || rrNew < 1e-28) { it++; break; }
      const beta = rrNew / rr;
      for (let k = 0; k < x.length; k++) p[k] = active[k] ? r[k] + beta * p[k] : 0;
      rr = rrNew;
    }
    return it;
  }

  /**
   * Passo viscoso completo. `periodicX` emula canal infinito em x — usado
   * apenas nos testes canônicos (Poiseuille).
   */
  step(dt: number, params: ViscosityParams, periodicX = false): void {
    const g = this.g;
    this.markActive();

    if (params.smagorinskyCs > 0) {
      this.applySmagorinsky(dt, params.smagorinskyCs);
    }
    if (params.nu <= 0) return;

    const c = (dt * params.nu) / (g.dx * g.dx);
    // Monta RHS = u* + contribuições Dirichlet (mesma varredura do operador)
    this.rhsU.set(g.u);
    this.rhsV.set(g.v);
    this.sweepU(null, g.u, c, params.noSlip, periodicX, params.bedU, this.rhsU);
    this.sweepV(null, g.v, c, params.noSlip, periodicX, this.rhsV);

    if (c < 0.05) {
      // Difusão fraca: Euler explícito é preciso e barato.
      // uⁿ⁺¹ = u + c·L(u) + Dirichlet = u − (Op(u) − u) + (rhs − u)
      this.sweepU(this.qU, g.u, c, params.noSlip, periodicX, params.bedU, null);
      for (let k = 0; k < g.u.length; k++) {
        if (this.activeU[k]) g.u[k] = g.u[k] - (this.qU[k] - g.u[k]) + (this.rhsU[k] - g.u[k]);
      }
      this.sweepV(this.qV, g.v, c, params.noSlip, periodicX, null);
      for (let k = 0; k < g.v.length; k++) {
        if (this.activeV[k]) g.v[k] = g.v[k] - (this.qV[k] - g.v[k]) + (this.rhsV[k] - g.v[k]);
      }
      return;
    }

    const opU = (dst: Float64Array, src: Float64Array) =>
      this.sweepU(dst, src, c, params.noSlip, periodicX, params.bedU, null);
    const opV = (dst: Float64Array, src: Float64Array) =>
      this.sweepV(dst, src, c, params.noSlip, periodicX, null);
    this.cg(g.u, this.rhsU, this.activeU, opU, this.rU, this.pU, this.qU);
    this.cg(g.v, this.rhsV, this.activeV, opV, this.rV, this.pV, this.qV);
  }

  /**
   * ν_t = (C_s·Δ)²·|S̄|, |S̄| = √(2·S̄:S̄), aplicado como difusão explícita:
   * u += Δt·∇·(ν_t ∇u), com ν_t limitado a 0.2·Δx²/Δt (estabilidade).
   */
  private applySmagorinsky(dt: number, cs: number): void {
    const g = this.g;
    const { nx, ny, dx } = g;
    const coef = (cs * dx) * (cs * dx);
    const cap = 0.2 * dx * dx / dt;

    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = g.ic(i, j);
        if (g.cellType[k] !== FLUID) { this.nuT[k] = 0; continue; }
        // S11 = ∂u/∂x, S22 = ∂v/∂y (naturais nos centros da grade MAC)
        const dudx = (g.u[g.iu(i + 1, j)] - g.u[g.iu(i, j)]) / dx;
        const dvdy = (g.v[g.iv(i, j + 1)] - g.v[g.iv(i, j)]) / dx;
        // S12 por diferenças centradas
        const jT = Math.min(j + 1, ny - 1), jB = Math.max(j - 1, 0);
        const iR = Math.min(i + 1, nx - 1), iL = Math.max(i - 1, 0);
        const uT = 0.5 * (g.u[g.iu(i, jT)] + g.u[g.iu(i + 1, jT)]);
        const uB = 0.5 * (g.u[g.iu(i, jB)] + g.u[g.iu(i + 1, jB)]);
        const vR = 0.5 * (g.v[g.iv(iR, j)] + g.v[g.iv(iR, j + 1)]);
        const vL = 0.5 * (g.v[g.iv(iL, j)] + g.v[g.iv(iL, j + 1)]);
        const dudy = (uT - uB) / ((jT - jB) * dx || dx);
        const dvdx = (vR - vL) / ((iR - iL) * dx || dx);
        const s12 = 0.5 * (dudy + dvdx);
        const smag = Math.sqrt(2 * (dudx * dudx + dvdy * dvdy + 2 * s12 * s12));
        this.nuT[k] = Math.min(coef * smag, cap);
      }
    }

    const du = this.qU;
    const dv = this.qV;
    du.fill(0); dv.fill(0);
    const inv2 = dt / (dx * dx);
    const stride = nx + 1;
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const k = i + j * stride;
        if (!this.activeU[k]) continue;
        const nuF = 0.5 * (this.nuT[g.ic(i - 1, j)] + this.nuT[g.ic(i, j)]);
        if (nuF <= 0) continue;
        let lap = 0;
        if (this.activeU[k - 1]) lap += g.u[k - 1] - g.u[k];
        if (this.activeU[k + 1]) lap += g.u[k + 1] - g.u[k];
        if (j > 0 && this.activeU[k - stride]) lap += g.u[k - stride] - g.u[k];
        if (j < ny - 1 && this.activeU[k + stride]) lap += g.u[k + stride] - g.u[k];
        du[k] = inv2 * nuF * lap;
      }
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = i + j * nx;
        if (!this.activeV[k]) continue;
        const nuF = 0.5 * (this.nuT[g.ic(i, j - 1)] + this.nuT[g.ic(i, j)]);
        if (nuF <= 0) continue;
        let lap = 0;
        if (i > 0 && this.activeV[k - 1]) lap += g.v[k - 1] - g.v[k];
        if (i < nx - 1 && this.activeV[k + 1]) lap += g.v[k + 1] - g.v[k];
        if (this.activeV[k - nx]) lap += g.v[k - nx] - g.v[k];
        if (j < ny && this.activeV[k + nx]) lap += g.v[k + nx] - g.v[k];
        dv[k] = inv2 * nuF * lap;
      }
    }
    for (let k = 0; k < g.u.length; k++) g.u[k] += du[k];
    for (let k = 0; k < g.v.length; k++) g.v[k] += dv[k];
  }

  /** ν_t médio nas células fluidas (diagnóstico HUD). */
  meanNuT(): number {
    let s = 0;
    let n = 0;
    for (let k = 0; k < this.nuT.length; k++) {
      if (this.g.cellType[k] === FLUID) { s += this.nuT[k]; n++; }
    }
    return n > 0 ? s / n : 0;
  }
}
