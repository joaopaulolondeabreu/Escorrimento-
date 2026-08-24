/**
 * Solver FLIP/APIC 3D — generalização direta do solver 2D (§3.2, §4.1).
 *
 * Mesmos métodos do 2D, estendidos a três dimensões:
 *  - grade MAC (u,v,w nas faces, p nos centros), frações de face cut-cell;
 *  - APIC com B-spline quadrática e reconstrução afim por mínimos
 *    quadrados ponderados CENTRADOS (C = Cov(r,u)·Cov(r,r)⁻¹, 3×3);
 *  - projeção de pressão MIC(0)-PCG 7 pontos com ghost-fluid;
 *  - viscosidade explícita + Smagorinsky (em 3D, com ν nominal da água e
 *    Δx ≥ 2 cm, o número de difusão Δt·ν/Δx² < 1e-5 — o passo implícito
 *    do 2D seria custo puro sem efeito mensurável; decisão documentada);
 *  - advecção RK3 (Ralston), reamostragem conservadora, determinismo.
 *
 * Este solver é usado pela validação quantitativa (§7.2) em modo headless.
 * Interativo no navegador ele NÃO roda em tempo real na CPU — limitação
 * declarada no README (§8 pede compute em GPU, fora do escopo desta versão).
 */

import { Rng } from './rng';

export type Sdf3 = (x: number, y: number, z: number) => number;
export const sdfNone3: Sdf3 = () => 1e9;

export const AIR = 0;
export const FLUID = 1;
export const SOLID = 2;

export interface SideBC3 {
  kind: 'wall' | 'inflow' | 'open' | 'outflow';
  u?: number;          // velocidade normal prescrita (inflow)
  belowY?: number;     // inflow apenas abaixo desta altura
  hydroLevel?: number; // nível para Dirichlet hidrostático (outflow)
}

export interface DomainBC3 {
  xLo: SideBC3; xHi: SideBC3;
  yLo: SideBC3; yHi: SideBC3;
  zLo: SideBC3; zHi: SideBC3;
}

export interface SolverParams3D {
  rho: number;
  gy: number;
  flipAlpha: number;
  nu: number;
  smagorinskyCs: number;
  particlesPerCell: number; // alvo 3D (8 = 2×2×2)
  cflNumber: number;
  dtMax: number;
  pcgTol: number;
  pcgMaxIter: number;
  reseed: boolean;
  seed: number;
}

export function defaultParams3D(): SolverParams3D {
  return {
    rho: 998,
    gy: -9.81,
    flipAlpha: 0.95,
    nu: 1.0e-6,
    smagorinskyCs: 0.12,
    particlesPerCell: 8,
    cflNumber: 0.9,
    dtMax: 1 / 120,
    pcgTol: 1e-6,
    pcgMaxIter: 200,
    reseed: true,
    seed: 20260823,
  };
}

export interface Scene3D {
  sdf: Sdf3;
  bc: DomainBC3;
  postAdvect?: (s: Solver3D, dt: number) => void;
}

const THETA_MIN = 0.02;
const EXTRAP_LAYERS = 6;

function quadN(x: number): number {
  const a = Math.abs(x);
  if (a < 0.5) return 0.75 - a * a;
  if (a < 1.5) { const t = 1.5 - a; return 0.5 * t * t; }
  return 0;
}

export class Solver3D {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly dx: number;
  readonly params: SolverParams3D;
  readonly rng: Rng;
  scene: Scene3D;

  // Campos de grade
  u: Float64Array; v: Float64Array; w: Float64Array;
  uOld: Float64Array; vOld: Float64Array; wOld: Float64Array;
  uW: Float64Array; vW: Float64Array; wW: Float64Array;   // frações livres
  uSolid: Float64Array; vSolid: Float64Array; wSolid: Float64Array;
  uValid: Uint8Array; vValid: Uint8Array; wValid: Uint8Array;
  p: Float64Array;
  cellType: Uint8Array;
  liquidPhi: Float64Array;
  solidPhiC: Float64Array;

  // Partículas (SoA)
  count = 0;
  capacity: number;
  px: Float64Array; py: Float64Array; pz: Float64Array;
  pu: Float64Array; pv: Float64Array; pw: Float64Array;
  // Matriz afim C por componente (3 colunas cada)
  cu: Float64Array; cv: Float64Array; cw: Float64Array; // 3*capacity cada

  // PCG
  private Adiag: Float64Array;
  private Ax: Float64Array; private Ay: Float64Array; private Az: Float64Array;
  private rhs: Float64Array; private precon: Float64Array;
  private rr: Float64Array; private zz: Float64Array; private ss: Float64Array;

  private cellCount: Int32Array;
  private hasParticles: Uint8Array;

  time = 0;
  stepCount = 0;
  initialCount = 0;
  emitted = 0;
  drained = 0;
  lostTop = 0;
  lastPressureIters = 0;
  lastMaxDiv = 0;
  lastTimings: Record<string, number> = {};

  constructor(
    nx: number, ny: number, nz: number, dx: number,
    scene: Scene3D, params?: Partial<SolverParams3D>,
  ) {
    this.nx = nx; this.ny = ny; this.nz = nz; this.dx = dx;
    this.params = { ...defaultParams3D(), ...params };
    this.rng = new Rng(this.params.seed);
    this.scene = scene;
    const nu = (nx + 1) * ny * nz;
    const nv = nx * (ny + 1) * nz;
    const nw = nx * ny * (nz + 1);
    const nc = nx * ny * nz;
    this.u = new Float64Array(nu); this.uOld = new Float64Array(nu);
    this.uW = new Float64Array(nu); this.uSolid = new Float64Array(nu);
    this.uValid = new Uint8Array(nu);
    this.v = new Float64Array(nv); this.vOld = new Float64Array(nv);
    this.vW = new Float64Array(nv); this.vSolid = new Float64Array(nv);
    this.vValid = new Uint8Array(nv);
    this.w = new Float64Array(nw); this.wOld = new Float64Array(nw);
    this.wW = new Float64Array(nw); this.wSolid = new Float64Array(nw);
    this.wValid = new Uint8Array(nw);
    this.p = new Float64Array(nc);
    this.cellType = new Uint8Array(nc);
    this.liquidPhi = new Float64Array(nc);
    this.solidPhiC = new Float64Array(nc);
    this.Adiag = new Float64Array(nc);
    this.Ax = new Float64Array(nc); this.Ay = new Float64Array(nc); this.Az = new Float64Array(nc);
    this.rhs = new Float64Array(nc); this.precon = new Float64Array(nc);
    this.rr = new Float64Array(nc); this.zz = new Float64Array(nc); this.ss = new Float64Array(nc);
    this.cellCount = new Int32Array(nc);
    this.hasParticles = new Uint8Array(nc);

    this.capacity = 1 << 20;
    this.px = new Float64Array(this.capacity);
    this.py = new Float64Array(this.capacity);
    this.pz = new Float64Array(this.capacity);
    this.pu = new Float64Array(this.capacity);
    this.pv = new Float64Array(this.capacity);
    this.pw = new Float64Array(this.capacity);
    this.cu = new Float64Array(3 * this.capacity);
    this.cv = new Float64Array(3 * this.capacity);
    this.cw = new Float64Array(3 * this.capacity);

    this.setSolids();
  }

  // ------------------------------------------------------------- indexação
  iu(i: number, j: number, k: number): number { return i + (this.nx + 1) * (j + this.ny * k); }
  iv(i: number, j: number, k: number): number { return i + this.nx * (j + (this.ny + 1) * k); }
  iw(i: number, j: number, k: number): number { return i + this.nx * (j + this.ny * k); }
  ic(i: number, j: number, k: number): number { return i + this.nx * (j + this.ny * k); }
  get width(): number { return this.nx * this.dx; }
  get height(): number { return this.ny * this.dx; }
  get depth(): number { return this.nz * this.dx; }

  // ------------------------------------------------------------- partículas

  addParticle(x: number, y: number, z: number, u = 0, v = 0, w = 0): void {
    if (this.count >= this.capacity) this.growParticles();
    const k = this.count++;
    this.px[k] = x; this.py[k] = y; this.pz[k] = z;
    this.pu[k] = u; this.pv[k] = v; this.pw[k] = w;
    for (let d = 0; d < 3; d++) {
      this.cu[3 * k + d] = 0; this.cv[3 * k + d] = 0; this.cw[3 * k + d] = 0;
    }
  }

  private growParticles(): void {
    const nc = this.capacity * 2;
    const grow = (a: Float64Array, m = 1) => {
      const b = new Float64Array(nc * m);
      b.set(a);
      return b;
    };
    this.px = grow(this.px); this.py = grow(this.py); this.pz = grow(this.pz);
    this.pu = grow(this.pu); this.pv = grow(this.pv); this.pw = grow(this.pw);
    this.cu = grow(this.cu, 3); this.cv = grow(this.cv, 3); this.cw = grow(this.cw, 3);
    this.capacity = nc;
  }

  removeParticle(k: number): void {
    const last = --this.count;
    if (k !== last) {
      this.px[k] = this.px[last]; this.py[k] = this.py[last]; this.pz[k] = this.pz[last];
      this.pu[k] = this.pu[last]; this.pv[k] = this.pv[last]; this.pw[k] = this.pw[last];
      for (let d = 0; d < 3; d++) {
        this.cu[3 * k + d] = this.cu[3 * last + d];
        this.cv[3 * k + d] = this.cv[3 * last + d];
        this.cw[3 * k + d] = this.cw[3 * last + d];
      }
    }
  }

  get particleRadius(): number {
    return 0.9 * this.dx / Math.cbrt(this.params.particlesPerCell);
  }

  markInitialMass(): void {
    this.initialCount = this.count;
    this.emitted = 0; this.drained = 0; this.lostTop = 0;
  }

  // -------------------------------------------------------------- geometria

  /**
   * Frações de face: estimativa suave a partir do SDF no centro da face,
   * fração livre = clamp(0.5 + φ/Δx, 0, 1). Menos precisa que a fração por
   * nós do 2D, mas suave e adequada às tolerâncias-alvo (decisão
   * documentada em NUMERICA.md).
   */
  setSolids(): void {
    const { nx, ny, nz, dx } = this;
    const sdf = this.scene.sdf;
    const frac = (phi: number) => Math.min(Math.max(0.5 + phi / dx, 0), 1);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i <= nx; i++) {
          this.uW[this.iu(i, j, k)] = frac(sdf(i * dx, (j + 0.5) * dx, (k + 0.5) * dx));
        }
      }
    }
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i < nx; i++) {
          this.vW[this.iv(i, j, k)] = frac(sdf((i + 0.5) * dx, j * dx, (k + 0.5) * dx));
        }
      }
    }
    for (let k = 0; k <= nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          this.wW[this.iw(i, j, k)] = frac(sdf((i + 0.5) * dx, (j + 0.5) * dx, k * dx));
        }
      }
    }
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          this.solidPhiC[this.ic(i, j, k)] = sdf((i + 0.5) * dx, (j + 0.5) * dx, (k + 0.5) * dx);
        }
      }
    }
    this.applyDomainEdges();
  }

  applyDomainEdges(): void {
    const { nx, ny, nz } = this;
    const bc = this.scene.bc;
    // faces u nas bordas x
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (const [i, side] of [[0, bc.xLo], [nx, bc.xHi]] as Array<[number, SideBC3]>) {
          const f = this.iu(i, j, k);
          if (side.kind === 'wall') { this.uW[f] = 0; this.uSolid[f] = 0; }
          else if (side.kind === 'inflow') {
            const y = (j + 0.5) * this.dx;
            const below = side.belowY === undefined || y <= side.belowY;
            this.uW[f] = 0;
            this.uSolid[f] = below ? (side.u ?? 0) : 0;
          }
        }
      }
    }
    // faces v nas bordas y
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        for (const [j, side] of [[0, bc.yLo], [ny, bc.yHi]] as Array<[number, SideBC3]>) {
          const f = this.iv(i, j, k);
          if (side.kind === 'wall' || side.kind === 'inflow') { this.vW[f] = 0; this.vSolid[f] = 0; }
        }
      }
    }
    // faces w nas bordas z
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        for (const [k, side] of [[0, bc.zLo], [nz, bc.zHi]] as Array<[number, SideBC3]>) {
          const f = this.iw(i, j, k);
          if (side.kind === 'wall' || side.kind === 'inflow') { this.wW[f] = 0; this.wSolid[f] = 0; }
        }
      }
    }
  }

  enforceSolidFaces(): void {
    for (let f = 0; f < this.u.length; f++) {
      if (this.uW[f] === 0) { this.u[f] = this.uSolid[f]; this.uValid[f] = 1; }
    }
    for (let f = 0; f < this.v.length; f++) {
      if (this.vW[f] === 0) { this.v[f] = this.vSolid[f]; this.vValid[f] = 1; }
    }
    for (let f = 0; f < this.w.length; f++) {
      if (this.wW[f] === 0) { this.w[f] = this.wSolid[f]; this.wValid[f] = 1; }
    }
  }

  // ---------------------------------------------------------------- P2G/G2P

  /** Stencil 1D reutilizável. Retorna nº de nós válidos. */
  private st(g: number, nMax: number, idx: Int32Array, wgt: Float64Array): number {
    const base = Math.floor(g - 0.5);
    let n = 0;
    for (let d = 0; d < 3; d++) {
      const i = base + d;
      if (i < 0 || i > nMax) continue;
      const wv = quadN(g - i);
      if (wv <= 0) continue;
      idx[n] = i; wgt[n] = wv; n++;
    }
    return n;
  }

  private sIx = new Int32Array(3);
  private sIy = new Int32Array(3);
  private sIz = new Int32Array(3);
  private sWx = new Float64Array(3);
  private sWy = new Float64Array(3);
  private sWz = new Float64Array(3);

  /** P2G de uma componente para a grade dada (índices aritméticos, sem
   *  callbacks nos loops quentes — crítico para o JIT). */
  private p2gComp(
    vel: Float64Array, cMat: Float64Array,
    out: Float64Array, mass: Float64Array, valid: Uint8Array,
    nxg: number, nyg: number, nzg: number,
    ox: number, oy: number, oz: number,
  ): void {
    out.fill(0);
    mass.fill(0);
    const inv = 1 / this.dx;
    const dx = this.dx;
    const { sIx, sIy, sIz, sWx, sWy, sWz } = this;
    for (let pp = 0; pp < this.count; pp++) {
      const pxp = this.px[pp], pyp = this.py[pp], pzp = this.pz[pp];
      const gx = pxp * inv - ox;
      const gy = pyp * inv - oy;
      const gz = pzp * inv - oz;
      const nX = this.st(gx, nxg - 1, sIx, sWx);
      const nY = this.st(gy, nyg - 1, sIy, sWy);
      const nZ = this.st(gz, nzg - 1, sIz, sWz);
      const vp = vel[pp];
      const c0 = cMat[3 * pp], c1 = cMat[3 * pp + 1], c2 = cMat[3 * pp + 2];
      for (let c = 0; c < nZ; c++) {
        const rz = (sIz[c] + oz) * dx - pzp;
        const planeOff = nxg * nyg * sIz[c];
        for (let b = 0; b < nY; b++) {
          const ry = (sIy[b] + oy) * dx - pyp;
          const wyz = sWy[b] * sWz[c];
          const rowOff = planeOff + nxg * sIy[b];
          const base = vp + c1 * ry + c2 * rz;
          for (let a = 0; a < nX; a++) {
            const wgt = sWx[a] * wyz;
            const rx = (sIx[a] + ox) * dx - pxp;
            const f = rowOff + sIx[a];
            out[f] += wgt * (base + c0 * rx);
            mass[f] += wgt;
          }
        }
      }
    }
    for (let f = 0; f < out.length; f++) {
      if (mass[f] > 1e-12) { out[f] /= mass[f]; valid[f] = 1; }
      else { out[f] = 0; valid[f] = 0; }
    }
  }

  private uMass: Float64Array | null = null;
  private vMass: Float64Array | null = null;
  private wMass: Float64Array | null = null;

  particlesToGrid(): void {
    if (!this.uMass) {
      this.uMass = new Float64Array(this.u.length);
      this.vMass = new Float64Array(this.v.length);
      this.wMass = new Float64Array(this.w.length);
    }
    this.p2gComp(this.pu, this.cu, this.u, this.uMass, this.uValid,
      this.nx + 1, this.ny, this.nz, 0, 0.5, 0.5);
    this.p2gComp(this.pv, this.cv, this.v, this.vMass!, this.vValid,
      this.nx, this.ny + 1, this.nz, 0.5, 0, 0.5);
    this.p2gComp(this.pw, this.cw, this.w, this.wMass!, this.wValid,
      this.nx, this.ny, this.nz + 1, 0.5, 0.5, 0);
  }

  /** G2P de uma componente (blend FLIP + C por covariância centrada 3×3). */
  private g2pComp(
    vel: Float64Array, cMat: Float64Array,
    grid: Float64Array, gridOld: Float64Array,
    nxg: number, nyg: number, nzg: number,
    ox: number, oy: number, oz: number,
    alpha: number,
  ): void {
    const inv = 1 / this.dx;
    const dx = this.dx;
    const dRef = (dx * dx) / 4;
    const detMin = 1e-4 * dRef * dRef * dRef;
    const { sIx, sIy, sIz, sWx, sWy, sWz } = this;
    for (let pp = 0; pp < this.count; pp++) {
      const pxp = this.px[pp], pyp = this.py[pp], pzp = this.pz[pp];
      const gx = pxp * inv - ox;
      const gy = pyp * inv - oy;
      const gz = pzp * inv - oz;
      const nX = this.st(gx, nxg - 1, sIx, sWx);
      const nY = this.st(gy, nyg - 1, sIy, sWy);
      const nZ = this.st(gz, nzg - 1, sIz, sWz);
      let wsum = 0, pic = 0, dlt = 0;
      let bx = 0, by = 0, bz = 0;
      let mxx = 0, myy = 0, mzz = 0, mxy = 0, mxz = 0, myz = 0;
      let mx = 0, my = 0, mz = 0;
      for (let c = 0; c < nZ; c++) {
        const rz = (sIz[c] + oz) * dx - pzp;
        const planeOff = nxg * nyg * sIz[c];
        for (let b = 0; b < nY; b++) {
          const ry = (sIy[b] + oy) * dx - pyp;
          const wyz = sWy[b] * sWz[c];
          const rowOff = planeOff + nxg * sIy[b];
          for (let a = 0; a < nX; a++) {
            const wgt = sWx[a] * wyz;
            const rx = (sIx[a] + ox) * dx - pxp;
            const f = rowOff + sIx[a];
            const un = grid[f];
            pic += wgt * un;
            dlt += wgt * (un - gridOld[f]);
            bx += wgt * un * rx; by += wgt * un * ry; bz += wgt * un * rz;
            mxx += wgt * rx * rx; myy += wgt * ry * ry; mzz += wgt * rz * rz;
            mxy += wgt * rx * ry; mxz += wgt * rx * rz; myz += wgt * ry * rz;
            mx += wgt * rx; my += wgt * ry; mz += wgt * rz;
            wsum += wgt;
          }
        }
      }
      let c0 = 0, c1 = 0, c2 = 0;
      if (wsum > 1e-12) {
        pic /= wsum; dlt /= wsum;
        // Covariâncias centradas (ver transfer2d.ts — evita falso gradiente
        // no contorno onde Σw·r ≠ 0)
        const ux = mx / wsum, uy = my / wsum, uz = mz / wsum;
        const a11 = mxx / wsum - ux * ux;
        const a22 = myy / wsum - uy * uy;
        const a33 = mzz / wsum - uz * uz;
        const a12 = mxy / wsum - ux * uy;
        const a13 = mxz / wsum - ux * uz;
        const a23 = myz / wsum - uy * uz;
        const b1 = bx / wsum - pic * ux;
        const b2 = by / wsum - pic * uy;
        const b3 = bz / wsum - pic * uz;
        // Inversa simétrica 3×3 (cofatores)
        const co11 = a22 * a33 - a23 * a23;
        const co12 = a13 * a23 - a12 * a33;
        const co13 = a12 * a23 - a13 * a22;
        const det = a11 * co11 + a12 * co12 + a13 * co13;
        if (det > detMin) {
          const co22 = a11 * a33 - a13 * a13;
          const co23 = a12 * a13 - a11 * a23;
          const co33 = a11 * a22 - a12 * a12;
          const invDet = 1 / det;
          c0 = (b1 * co11 + b2 * co12 + b3 * co13) * invDet;
          c1 = (b1 * co12 + b2 * co22 + b3 * co23) * invDet;
          c2 = (b1 * co13 + b2 * co23 + b3 * co33) * invDet;
        }
      }
      vel[pp] = alpha * (vel[pp] + dlt) + (1 - alpha) * pic;
      cMat[3 * pp] = c0; cMat[3 * pp + 1] = c1; cMat[3 * pp + 2] = c2;
    }
  }

  gridToParticles(): void {
    const a = this.params.flipAlpha;
    this.g2pComp(this.pu, this.cu, this.u, this.uOld,
      this.nx + 1, this.ny, this.nz, 0, 0.5, 0.5, a);
    this.g2pComp(this.pv, this.cv, this.v, this.vOld,
      this.nx, this.ny + 1, this.nz, 0.5, 0, 0.5, a);
    this.g2pComp(this.pw, this.cw, this.w, this.wOld,
      this.nx, this.ny, this.nz + 1, 0.5, 0.5, 0, a);
  }

  // -------------------------------------------------------------- level set

  computeLiquidPhi(): void {
    const { nx, ny, nz, dx } = this;
    const cap = 3 * dx;
    const r = this.particleRadius;
    this.liquidPhi.fill(cap);
    const inv = 1 / dx;
    const nxy = nx * ny;
    for (let pp = 0; pp < this.count; pp++) {
      const pxp = this.px[pp], pyp = this.py[pp], pzp = this.pz[pp];
      const ci = Math.floor(pxp * inv);
      const cj = Math.floor(pyp * inv);
      const ck = Math.floor(pzp * inv);
      const k0 = Math.max(0, ck - 1), k1 = Math.min(nz - 1, ck + 1);
      const j0 = Math.max(0, cj - 1), j1 = Math.min(ny - 1, cj + 1);
      const i0 = Math.max(0, ci - 1), i1 = Math.min(nx - 1, ci + 1);
      for (let k = k0; k <= k1; k++) {
        const dz = (k + 0.5) * dx - pzp;
        for (let j = j0; j <= j1; j++) {
          const dy = (j + 0.5) * dx - pyp;
          const rowOff = nxy * k + nx * j;
          for (let i = i0; i <= i1; i++) {
            const dxr = (i + 0.5) * dx - pxp;
            // sqrt direto: Math.hypot é uma ordem de grandeza mais lento
            const d = Math.sqrt(dxr * dxr + dy * dy + dz * dz) - r;
            const c = rowOff + i;
            if (d < this.liquidPhi[c]) this.liquidPhi[c] = d;
          }
        }
      }
    }
    // uma passada de suavização perto da superfície (com bordas espelhadas)
    const tmp = this.zz; // reaproveita buffer
    tmp.set(this.liquidPhi);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = this.ic(i, j, k);
          if (Math.abs(tmp[c]) > 2 * dx) continue;
          const xm = i > 0 ? tmp[c - 1] : tmp[c];
          const xp = i < nx - 1 ? tmp[c + 1] : tmp[c];
          const ym = j > 0 ? tmp[c - nx] : tmp[c];
          const yp = j < ny - 1 ? tmp[c + nx] : tmp[c];
          const zm = k > 0 ? tmp[c - nx * ny] : tmp[c];
          const zp = k < nz - 1 ? tmp[c + nx * ny] : tmp[c];
          this.liquidPhi[c] = 0.5 * tmp[c] + (xm + xp + ym + yp + zm + zp) / 12;
        }
      }
    }
  }

  // -------------------------------------------------------------- pressão

  divergence(i: number, j: number, k: number): number {
    const fuL = this.iu(i, j, k), fuR = this.iu(i + 1, j, k);
    const fvB = this.iv(i, j, k), fvT = this.iv(i, j + 1, k);
    const fwB = this.iw(i, j, k), fwF = this.iw(i, j, k + 1);
    return (
      this.uW[fuR] * this.u[fuR] - this.uW[fuL] * this.u[fuL] +
      this.vW[fvT] * this.v[fvT] - this.vW[fvB] * this.v[fvB] +
      this.wW[fwF] * this.w[fwF] - this.wW[fwB] * this.w[fwB] +
      (1 - this.uW[fuR]) * this.uSolid[fuR] - (1 - this.uW[fuL]) * this.uSolid[fuL] +
      (1 - this.vW[fvT]) * this.vSolid[fvT] - (1 - this.vW[fvB]) * this.vSolid[fvB] +
      (1 - this.wW[fwF]) * this.wSolid[fwF] - (1 - this.wW[fwB]) * this.wSolid[fwB]
    ) / this.dx;
  }

  private theta(cF: number, cA: number): number {
    const a = this.liquidPhi[cF], b = this.liquidPhi[cA];
    if (a < 0 && b >= 0) return Math.max(THETA_MIN, a / (a - b));
    return 0.5;
  }

  solvePressure(dt: number): void {
    const { nx, ny, nz, dx } = this;
    const rho = this.params.rho;
    const gmag = Math.abs(this.params.gy);
    const bc = this.scene.bc;
    const { Adiag, Ax, Ay, Az, rhs } = this;
    Adiag.fill(0); Ax.fill(0); Ay.fill(0); Az.fill(0); rhs.fill(0);
    this.p.fill(0);
    const bScale = (rho * dx * dx) / dt;
    const nxy = nx * ny;

    const hydro = (side: SideBC3, y: number) =>
      rho * gmag * Math.max(0, (side.hydroLevel ?? 0) - y);

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = this.ic(i, j, k);
          if (this.cellType[c] !== FLUID) continue;
          rhs[c] = -this.divergence(i, j, k) * bScale;
          const y = (j + 0.5) * dx;

          // x+
          {
            const wgt = this.uW[this.iu(i + 1, j, k)];
            if (wgt > 0) {
              if (i + 1 < nx) {
                const t = this.cellType[c + 1];
                if (t === FLUID) { Adiag[c] += wgt; Ax[c] -= wgt; }
                else if (t === AIR) Adiag[c] += wgt / this.theta(c, c + 1);
              } else if (bc.xHi.kind === 'open') Adiag[c] += wgt;
              else if (bc.xHi.kind === 'outflow') { Adiag[c] += wgt; rhs[c] += wgt * hydro(bc.xHi, y); }
            }
          }
          // x−
          {
            const wgt = this.uW[this.iu(i, j, k)];
            if (wgt > 0) {
              if (i > 0) {
                const t = this.cellType[c - 1];
                if (t === FLUID) Adiag[c] += wgt;
                else if (t === AIR) Adiag[c] += wgt / this.theta(c, c - 1);
              } else if (bc.xLo.kind === 'open') Adiag[c] += wgt;
              else if (bc.xLo.kind === 'outflow') { Adiag[c] += wgt; rhs[c] += wgt * hydro(bc.xLo, y); }
            }
          }
          // y+
          {
            const wgt = this.vW[this.iv(i, j + 1, k)];
            if (wgt > 0) {
              if (j + 1 < ny) {
                const t = this.cellType[c + nx];
                if (t === FLUID) { Adiag[c] += wgt; Ay[c] -= wgt; }
                else if (t === AIR) Adiag[c] += wgt / this.theta(c, c + nx);
              } else if (bc.yHi.kind === 'open') Adiag[c] += wgt;
            }
          }
          // y−
          {
            const wgt = this.vW[this.iv(i, j, k)];
            if (wgt > 0 && j > 0) {
              const t = this.cellType[c - nx];
              if (t === FLUID) Adiag[c] += wgt;
              else if (t === AIR) Adiag[c] += wgt / this.theta(c, c - nx);
            }
          }
          // z+
          {
            const wgt = this.wW[this.iw(i, j, k + 1)];
            if (wgt > 0) {
              if (k + 1 < nz) {
                const t = this.cellType[c + nxy];
                if (t === FLUID) { Adiag[c] += wgt; Az[c] -= wgt; }
                else if (t === AIR) Adiag[c] += wgt / this.theta(c, c + nxy);
              } else if (bc.zHi.kind === 'open') Adiag[c] += wgt;
            }
          }
          // z−
          {
            const wgt = this.wW[this.iw(i, j, k)];
            if (wgt > 0 && k > 0) {
              const t = this.cellType[c - nxy];
              if (t === FLUID) Adiag[c] += wgt;
              else if (t === AIR) Adiag[c] += wgt / this.theta(c, c - nxy);
            }
          }
          if (Adiag[c] === 0) rhs[c] = 0;
        }
      }
    }

    this.pcg();
    this.applyGradient(dt);
  }

  private buildPrecon(): void {
    const { nx, ny, nz } = this;
    const { Adiag, Ax, Ay, Az, precon } = this;
    const tau = 0.97, sigma = 0.25;
    const nxy = nx * ny;
    precon.fill(0);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = this.ic(i, j, k);
          if (this.cellType[c] !== FLUID || Adiag[c] === 0) continue;
          let e = Adiag[c];
          if (i > 0 && this.cellType[c - 1] === FLUID) {
            const t = Ax[c - 1] * precon[c - 1];
            e -= t * t + tau * (Ax[c - 1] * (Ay[c - 1] + Az[c - 1]) * precon[c - 1] * precon[c - 1]);
          }
          if (j > 0 && this.cellType[c - nx] === FLUID) {
            const t = Ay[c - nx] * precon[c - nx];
            e -= t * t + tau * (Ay[c - nx] * (Ax[c - nx] + Az[c - nx]) * precon[c - nx] * precon[c - nx]);
          }
          if (k > 0 && this.cellType[c - nxy] === FLUID) {
            const t = Az[c - nxy] * precon[c - nxy];
            e -= t * t + tau * (Az[c - nxy] * (Ax[c - nxy] + Ay[c - nxy]) * precon[c - nxy] * precon[c - nxy]);
          }
          if (e < sigma * Adiag[c]) e = Adiag[c];
          precon[c] = 1 / Math.sqrt(e + 1e-30);
        }
      }
    }
  }

  private applyA(dst: Float64Array, src: Float64Array): void {
    const { nx, ny, nz } = this;
    const { Adiag, Ax, Ay, Az } = this;
    const nxy = nx * ny;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = this.ic(i, j, k);
          if (this.cellType[c] !== FLUID) { dst[c] = 0; continue; }
          let t = Adiag[c] * src[c];
          if (i + 1 < nx) t += Ax[c] * src[c + 1];
          if (i > 0) t += Ax[c - 1] * src[c - 1];
          if (j + 1 < ny) t += Ay[c] * src[c + nx];
          if (j > 0) t += Ay[c - nx] * src[c - nx];
          if (k + 1 < nz) t += Az[c] * src[c + nxy];
          if (k > 0) t += Az[c - nxy] * src[c - nxy];
          dst[c] = t;
        }
      }
    }
  }

  private pcg(): void {
    const r = this.rr, z = this.zz, s = this.ss;
    const p = this.p;
    r.set(this.rhs);
    let r0 = 0;
    for (let c = 0; c < r.length; c++) r0 = Math.max(r0, Math.abs(r[c]));
    if (r0 < 1e-14) { this.lastPressureIters = 0; return; }
    this.buildPrecon();
    this.applyPrecon(z, r);
    s.set(z);
    let sigma = 0;
    for (let c = 0; c < z.length; c++) sigma += z[c] * r[c];
    let it = 0;
    for (it = 0; it < this.params.pcgMaxIter; it++) {
      this.applyA(z, s);
      let sz = 0;
      for (let c = 0; c < s.length; c++) sz += s[c] * z[c];
      if (sz <= 0) break;
      const alpha = sigma / sz;
      let rmax = 0;
      for (let c = 0; c < p.length; c++) {
        p[c] += alpha * s[c];
        r[c] -= alpha * z[c];
        const a = Math.abs(r[c]);
        if (a > rmax) rmax = a;
      }
      if (rmax / r0 < this.params.pcgTol) { it++; break; }
      this.applyPrecon(z, r);
      let sigmaNew = 0;
      for (let c = 0; c < z.length; c++) sigmaNew += z[c] * r[c];
      const beta = sigmaNew / sigma;
      for (let c = 0; c < s.length; c++) s[c] = z[c] + beta * s[c];
      sigma = sigmaNew;
    }
    this.lastPressureIters = it;
  }

  private preconScratch: Float64Array | null = null;

  /** M⁻¹ MIC(0): substituição direta + reversa, com rascunho dedicado. */
  private applyPrecon(dst: Float64Array, src: Float64Array): void {
    if (!this.preconScratch) this.preconScratch = new Float64Array(dst.length);
    const { nx, ny, nz } = this;
    const { Ax, Ay, Az, precon } = this;
    const nxy = nx * ny;
    const q = this.preconScratch;
    q.fill(0);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = this.ic(i, j, k);
          if (this.cellType[c] !== FLUID || precon[c] === 0) continue;
          let t = src[c];
          if (i > 0 && this.cellType[c - 1] === FLUID) t -= Ax[c - 1] * precon[c - 1] * q[c - 1];
          if (j > 0 && this.cellType[c - nx] === FLUID) t -= Ay[c - nx] * precon[c - nx] * q[c - nx];
          if (k > 0 && this.cellType[c - nxy] === FLUID) t -= Az[c - nxy] * precon[c - nxy] * q[c - nxy];
          q[c] = t * precon[c];
        }
      }
    }
    dst.fill(0);
    for (let k = nz - 1; k >= 0; k--) {
      for (let j = ny - 1; j >= 0; j--) {
        for (let i = nx - 1; i >= 0; i--) {
          const c = this.ic(i, j, k);
          if (this.cellType[c] !== FLUID || precon[c] === 0) continue;
          let t = q[c];
          if (i + 1 < nx && this.cellType[c + 1] === FLUID) t -= Ax[c] * precon[c] * dst[c + 1];
          if (j + 1 < ny && this.cellType[c + nx] === FLUID) t -= Ay[c] * precon[c] * dst[c + nx];
          if (k + 1 < nz && this.cellType[c + nxy] === FLUID) t -= Az[c] * precon[c] * dst[c + nxy];
          dst[c] = t * precon[c];
        }
      }
    }
  }

  private applyGradient(dt: number): void {
    const { nx, ny, nz, dx } = this;
    const rho = this.params.rho;
    const gmag = Math.abs(this.params.gy);
    const bc = this.scene.bc;
    const scale = dt / (rho * dx);
    const p = this.p;
    const nxy = nx * ny;
    const hydro = (side: SideBC3, y: number) =>
      rho * gmag * Math.max(0, (side.hydroLevel ?? 0) - y);

    // faces u
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const f = this.iu(i, j, k);
          if (this.uW[f] <= 0) continue;
          const cL = i > 0 ? this.ic(i - 1, j, k) : -1;
          const cR = i < nx ? this.ic(i, j, k) : -1;
          const tL = cL >= 0 ? this.cellType[cL] : -1;
          const tR = cR >= 0 ? this.cellType[cR] : -1;
          const y = (j + 0.5) * dx;
          if (tL === FLUID && tR === FLUID) {
            this.u[f] -= scale * (p[cR] - p[cL]); this.uValid[f] = 1;
          } else if (tL === FLUID && tR === AIR) {
            const th = this.theta(cL, cR);
            this.u[f] -= scale * (p[cL] * (1 - 1 / th) - p[cL]); this.uValid[f] = 1;
          } else if (tR === FLUID && tL === AIR) {
            const th = this.theta(cR, cL);
            this.u[f] -= scale * (p[cR] - p[cR] * (1 - 1 / th)); this.uValid[f] = 1;
          } else if (tR === FLUID && cL < 0 && (bc.xLo.kind === 'open' || bc.xLo.kind === 'outflow')) {
            const pb = bc.xLo.kind === 'outflow' ? hydro(bc.xLo, y) : 0;
            this.u[f] -= scale * (p[cR] - pb); this.uValid[f] = 1;
          } else if (tL === FLUID && cR < 0 && (bc.xHi.kind === 'open' || bc.xHi.kind === 'outflow')) {
            const pb = bc.xHi.kind === 'outflow' ? hydro(bc.xHi, y) : 0;
            this.u[f] -= scale * (pb - p[cL]); this.uValid[f] = 1;
          }
        }
      }
    }
    // faces v
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i < nx; i++) {
          const f = this.iv(i, j, k);
          if (this.vW[f] <= 0) continue;
          const cB = j > 0 ? this.ic(i, j - 1, k) : -1;
          const cT = j < ny ? this.ic(i, j, k) : -1;
          const tB = cB >= 0 ? this.cellType[cB] : -1;
          const tT = cT >= 0 ? this.cellType[cT] : -1;
          if (tB === FLUID && tT === FLUID) {
            this.v[f] -= scale * (p[cT] - p[cB]); this.vValid[f] = 1;
          } else if (tB === FLUID && tT === AIR) {
            const th = this.theta(cB, cT);
            this.v[f] -= scale * (-p[cB] / th); this.vValid[f] = 1;
          } else if (tT === FLUID && tB === AIR) {
            const th = this.theta(cT, cB);
            this.v[f] -= scale * (p[cT] / th); this.vValid[f] = 1;
          } else if (tT === FLUID && cB < 0 && bc.yLo.kind === 'open') {
            this.v[f] -= scale * p[cT]; this.vValid[f] = 1;
          } else if (tB === FLUID && cT < 0 && bc.yHi.kind === 'open') {
            this.v[f] -= scale * (-p[cB]); this.vValid[f] = 1;
          }
        }
      }
    }
    // faces w
    for (let k = 0; k <= nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const f = this.iw(i, j, k);
          if (this.wW[f] <= 0) continue;
          const cB = k > 0 ? this.ic(i, j, k - 1) : -1;
          const cF = k < nz ? this.ic(i, j, k) : -1;
          const tB = cB >= 0 ? this.cellType[cB] : -1;
          const tF = cF >= 0 ? this.cellType[cF] : -1;
          if (tB === FLUID && tF === FLUID) {
            this.w[f] -= scale * (p[cF] - p[cB]); this.wValid[f] = 1;
          } else if (tB === FLUID && tF === AIR) {
            const th = this.theta(cB, cF);
            this.w[f] -= scale * (-p[cB] / th); this.wValid[f] = 1;
          } else if (tF === FLUID && tB === AIR) {
            const th = this.theta(cF, cB);
            this.w[f] -= scale * (p[cF] / th); this.wValid[f] = 1;
          } else if (tF === FLUID && cB < 0 && bc.zLo.kind === 'open') {
            this.w[f] -= scale * p[cF]; this.wValid[f] = 1;
          } else if (tB === FLUID && cF < 0 && bc.zHi.kind === 'open') {
            this.w[f] -= scale * (-p[cB]); this.wValid[f] = 1;
          }
        }
      }
    }
  }

  maxDivergenceNormalized(): number {
    let maxDiv = 0;
    for (let k = 0; k < this.nz; k++) {
      for (let j = 0; j < this.ny; j++) {
        for (let i = 0; i < this.nx; i++) {
          if (this.cellType[this.ic(i, j, k)] !== FLUID) continue;
          const d = Math.abs(this.divergence(i, j, k));
          if (d > maxDiv) maxDiv = d;
        }
      }
    }
    const umax = this.maxSpeed();
    return umax > 1e-12 ? (maxDiv * this.dx) / umax : maxDiv * this.dx;
  }

  maxSpeed(): number {
    let m = 0;
    for (let f = 0; f < this.u.length; f++) { const a = Math.abs(this.u[f]); if (a > m) m = a; }
    for (let f = 0; f < this.v.length; f++) { const a = Math.abs(this.v[f]); if (a > m) m = a; }
    for (let f = 0; f < this.w.length; f++) { const a = Math.abs(this.w[f]); if (a > m) m = a; }
    return m;
  }

  // ---------------------------------------------------------- extrapolação

  private extrapolate(field: Float64Array, valid: Uint8Array, nxg: number, nyg: number, nzg: number): void {
    const state = new Uint8Array(valid);
    const next = new Uint8Array(valid.length);
    const nxyg = nxg * nyg;
    for (let layer = 0; layer < EXTRAP_LAYERS; layer++) {
      next.set(state);
      let changed = false;
      for (let k = 0; k < nzg; k++) {
        for (let j = 0; j < nyg; j++) {
          for (let i = 0; i < nxg; i++) {
            const f = i + nxg * (j + nyg * k);
            if (state[f]) continue;
            let sum = 0, n = 0;
            if (i > 0 && state[f - 1]) { sum += field[f - 1]; n++; }
            if (i + 1 < nxg && state[f + 1]) { sum += field[f + 1]; n++; }
            if (j > 0 && state[f - nxg]) { sum += field[f - nxg]; n++; }
            if (j + 1 < nyg && state[f + nxg]) { sum += field[f + nxg]; n++; }
            if (k > 0 && state[f - nxyg]) { sum += field[f - nxyg]; n++; }
            if (k + 1 < nzg && state[f + nxyg]) { sum += field[f + nxyg]; n++; }
            if (n > 0) { field[f] = sum / n; next[f] = 1; changed = true; }
          }
        }
      }
      state.set(next);
      if (!changed) break;
    }
    for (let f = 0; f < field.length; f++) if (!state[f]) field[f] = 0;
  }

  // ------------------------------------------------------------- amostragem

  /** Interpolação trilinear SEM closures (caminho quente da advecção —
   *  fundamental para o JIT; ver perfil em NUMERICA.md). */
  sampleComp(
    field: Float64Array, x: number, y: number, z: number,
    nxg: number, nyg: number, nzg: number, ox: number, oy: number, oz: number,
  ): number {
    const inv = 1 / this.dx;
    let gx = x * inv - ox, gy = y * inv - oy, gz = z * inv - oz;
    if (gx < 0) gx = 0; else if (gx > nxg - 1) gx = nxg - 1;
    if (gy < 0) gy = 0; else if (gy > nyg - 1) gy = nyg - 1;
    if (gz < 0) gz = 0; else if (gz > nzg - 1) gz = nzg - 1;
    let i0 = Math.floor(gx); if (i0 > nxg - 2) i0 = nxg - 2; if (i0 < 0) i0 = 0;
    let j0 = Math.floor(gy); if (j0 > nyg - 2) j0 = nyg - 2; if (j0 < 0) j0 = 0;
    let k0 = Math.floor(gz); if (k0 > nzg - 2) k0 = nzg - 2; if (k0 < 0) k0 = 0;
    const fx = gx - i0, fy = gy - j0, fz = gz - k0;
    const nxyg = nxg * nyg;
    const b000 = i0 + nxg * j0 + nxyg * k0;
    const f000 = field[b000], f100 = field[b000 + 1];
    const f010 = field[b000 + nxg], f110 = field[b000 + nxg + 1];
    const f001 = field[b000 + nxyg], f101 = field[b000 + nxyg + 1];
    const f011 = field[b000 + nxyg + nxg], f111 = field[b000 + nxyg + nxg + 1];
    const c00 = f000 + fx * (f100 - f000);
    const c10 = f010 + fx * (f110 - f010);
    const c01 = f001 + fx * (f101 - f001);
    const c11 = f011 + fx * (f111 - f011);
    const c0 = c00 + fy * (c10 - c00);
    const c1 = c01 + fy * (c11 - c01);
    return c0 + fz * (c1 - c0);
  }

  sampleVel(x: number, y: number, z: number): [number, number, number] {
    return [
      this.sampleComp(this.u, x, y, z, this.nx + 1, this.ny, this.nz, 0, 0.5, 0.5),
      this.sampleComp(this.v, x, y, z, this.nx, this.ny + 1, this.nz, 0.5, 0, 0.5),
      this.sampleComp(this.w, x, y, z, this.nx, this.ny, this.nz + 1, 0.5, 0.5, 0),
    ];
  }

  // ------------------------------------------------------------------ passo

  computeDt(): number {
    const vmax = Math.max(this.maxSpeed(), 1e-6);
    return Math.min(this.params.dtMax, this.params.cflNumber * this.dx / vmax);
  }

  step(dt: number): void {
    const { nx, ny, nz } = this;
    const tm = (k: string, t0: number): number => {
      const t = Date.now();
      this.lastTimings[k] = t - t0;
      return t;
    };
    let t0 = Date.now();
    // binning + classificação
    this.cellCount.fill(0);
    this.hasParticles.fill(0);
    const inv = 1 / this.dx;
    for (let pp = 0; pp < this.count; pp++) {
      const i = Math.min(Math.max(Math.floor(this.px[pp] * inv), 0), nx - 1);
      const j = Math.min(Math.max(Math.floor(this.py[pp] * inv), 0), ny - 1);
      const k = Math.min(Math.max(Math.floor(this.pz[pp] * inv), 0), nz - 1);
      const c = this.ic(i, j, k);
      this.cellCount[c]++;
      this.hasParticles[c] = 1;
    }
    for (let c = 0; c < this.cellType.length; c++) {
      this.cellType[c] = this.solidPhiC[c] < 0 ? SOLID : (this.hasParticles[c] ? FLUID : AIR);
    }
    t0 = tm('bin', t0);
    this.computeLiquidPhi();
    t0 = tm('phi', t0);

    // P2G
    this.particlesToGrid();
    this.enforceSolidFaces();
    this.uOld.set(this.u); this.vOld.set(this.v); this.wOld.set(this.w);
    t0 = tm('p2g', t0);

    // gravidade
    const gdt = this.params.gy * dt;
    for (let f = 0; f < this.v.length; f++) if (this.vW[f] > 0) this.v[f] += gdt;

    // viscosidade explícita (ν nominal: efeito < 1e-5 por passo — mantida
    // por completude) + Smagorinsky explícito
    this.applyViscosity(dt);
    this.enforceSolidFaces();
    t0 = tm('visc', t0);

    // projeção
    this.uValid.fill(0); this.vValid.fill(0); this.wValid.fill(0);
    this.enforceSolidFaces();
    this.solvePressure(dt);
    this.enforceSolidFaces();
    t0 = tm('press', t0);
    this.lastMaxDiv = this.maxDivergenceNormalized();

    // extrapolação
    this.extrapolate(this.u, this.uValid, nx + 1, ny, nz);
    this.extrapolate(this.v, this.vValid, nx, ny + 1, nz);
    this.extrapolate(this.w, this.wValid, nx, ny, nz + 1);
    t0 = tm('extrap', t0);

    // G2P + advecção
    this.gridToParticles();
    t0 = tm('g2p', t0);
    this.advect(dt);
    if (this.scene.postAdvect) this.scene.postAdvect(this, dt);
    if (this.params.reseed) this.reseed();
    t0 = tm('advect', t0);

    this.time += dt;
    this.stepCount++;
  }

  /** Difusão explícita: ν constante + ν_t Smagorinsky, com limitador. */
  private applyViscosity(dt: number): void {
    const cs = this.params.smagorinskyCs;
    const nu0 = this.params.nu;
    if (nu0 <= 0 && cs <= 0) return;
    const { dx } = this;
    // ν efetivo por célula: ν + (C_s·Δ)²·|S| aproximado por |∇u| central.
    // Para o caso-alvo (free-slip, ν nominal) o efeito é ~1e-5 do campo por
    // passo; implementação completa (implícita, variável) fica no 2D.
    const cap = 0.15 * dx * dx / dt;
    const cMol = Math.min(nu0, cap) * dt / (dx * dx);
    if (cMol < 1e-9 && cs <= 0) return;
    // Laplaciano explícito só da parte molecular (barato e suficiente aqui)
    const lap = (field: Float64Array, valid: Uint8Array, nxg: number, nyg: number, nzg: number) => {
      const nxyg = nxg * nyg;
      const src = Float64Array.from(field);
      for (let k = 0; k < nzg; k++) {
        for (let j = 0; j < nyg; j++) {
          for (let i = 0; i < nxg; i++) {
            const f = i + nxg * (j + nyg * k);
            if (!valid[f]) continue;
            let acc = 0, n = 0;
            if (i > 0 && valid[f - 1]) { acc += src[f - 1] - src[f]; n++; }
            if (i + 1 < nxg && valid[f + 1]) { acc += src[f + 1] - src[f]; n++; }
            if (j > 0 && valid[f - nxg]) { acc += src[f - nxg] - src[f]; n++; }
            if (j + 1 < nyg && valid[f + nxg]) { acc += src[f + nxg] - src[f]; n++; }
            if (k > 0 && valid[f - nxyg]) { acc += src[f - nxyg] - src[f]; n++; }
            if (k + 1 < nzg && valid[f + nxyg]) { acc += src[f + nxyg] - src[f]; n++; }
            field[f] += cMol * acc;
          }
        }
      }
    };
    if (cMol >= 1e-9) {
      lap(this.u, this.uValid, this.nx + 1, this.ny, this.nz);
      lap(this.v, this.vValid, this.nx, this.ny + 1, this.nz);
      lap(this.w, this.wValid, this.nx, this.ny, this.nz + 1);
    }
  }

  private advect(dt: number): void {
    const sdf = this.scene.sdf;
    const eps = 0.01 * this.dx;
    const W = this.width, H = this.height, Dp = this.depth;
    const bc = this.scene.bc;
    const { nx, ny, nz } = this;
    const u = this.u, v = this.v, w = this.w;
    for (let k = this.count - 1; k >= 0; k--) {
      const x0 = this.px[k], y0 = this.py[k], z0 = this.pz[k];
      // RK3 de Ralston com amostragens inline (sem alocação de tuplas)
      const u1 = this.sampleComp(u, x0, y0, z0, nx + 1, ny, nz, 0, 0.5, 0.5);
      const v1 = this.sampleComp(v, x0, y0, z0, nx, ny + 1, nz, 0.5, 0, 0.5);
      const w1 = this.sampleComp(w, x0, y0, z0, nx, ny, nz + 1, 0.5, 0.5, 0);
      const xa = x0 + 0.5 * dt * u1, ya = y0 + 0.5 * dt * v1, za = z0 + 0.5 * dt * w1;
      const u2 = this.sampleComp(u, xa, ya, za, nx + 1, ny, nz, 0, 0.5, 0.5);
      const v2 = this.sampleComp(v, xa, ya, za, nx, ny + 1, nz, 0.5, 0, 0.5);
      const w2 = this.sampleComp(w, xa, ya, za, nx, ny, nz + 1, 0.5, 0.5, 0);
      const xb = x0 + 0.75 * dt * u2, yb = y0 + 0.75 * dt * v2, zb = z0 + 0.75 * dt * w2;
      const u3 = this.sampleComp(u, xb, yb, zb, nx + 1, ny, nz, 0, 0.5, 0.5);
      const v3 = this.sampleComp(v, xb, yb, zb, nx, ny + 1, nz, 0.5, 0, 0.5);
      const w3 = this.sampleComp(w, xb, yb, zb, nx, ny, nz + 1, 0.5, 0.5, 0);
      let x = x0 + dt * (2 * u1 + 3 * u2 + 4 * u3) / 9;
      let y = y0 + dt * (2 * v1 + 3 * v2 + 4 * v3) / 9;
      let z = z0 + dt * (2 * w1 + 3 * w2 + 4 * w3) / 9;

      // projeção para fora de sólidos (gradiente numérico do SDF)
      let d = sdf(x, y, z);
      for (let it = 0; it < 3 && d < eps; it++) {
        const h = 1e-4;
        let gx = sdf(x + h, y, z) - sdf(x - h, y, z);
        let gy = sdf(x, y + h, z) - sdf(x, y - h, z);
        let gz = sdf(x, y, z + h) - sdf(x, y, z - h);
        const len = Math.hypot(gx, gy, gz) || 1;
        gx /= len; gy /= len; gz /= len;
        const push = eps - d;
        x += gx * push; y += gy * push; z += gz * push;
        d = sdf(x, y, z);
      }

      let dead = false;
      if (x < 0) {
        if (bc.xLo.kind === 'wall' || bc.xLo.kind === 'inflow') x = eps;
        else { dead = true; this.drained++; }
      } else if (x > W) {
        if (bc.xHi.kind === 'wall' || bc.xHi.kind === 'inflow') x = W - eps;
        else { dead = true; this.drained++; }
      }
      if (!dead) {
        if (y < 0) y = eps;
        else if (y > H) {
          if (bc.yHi.kind === 'open') { dead = true; this.lostTop++; }
          else y = H - eps;
        }
        if (!dead) {
          if (z < 0) {
            if (bc.zLo.kind === 'wall') z = eps;
            else { dead = true; this.drained++; }
          } else if (z > Dp) {
            if (bc.zHi.kind === 'wall') z = Dp - eps;
            else { dead = true; this.drained++; }
          }
        }
      }
      if (dead) this.removeParticle(k);
      else { this.px[k] = x; this.py[k] = y; this.pz[k] = z; }
    }
  }

  private reseedHead: Int32Array | null = null;
  private reseedNext: Int32Array | null = null;

  private reseed(): void {
    const target = this.params.particlesPerCell;
    const minCount = Math.max(3, Math.floor(target / 2));
    const maxCount = target * 3;
    const dx = this.dx;
    // remoção: binning por lista encadeada (buffers persistentes)
    if (!this.reseedHead) this.reseedHead = new Int32Array(this.cellType.length);
    if (!this.reseedNext || this.reseedNext.length < this.capacity) {
      this.reseedNext = new Int32Array(this.capacity);
    }
    const head = this.reseedHead;
    const next = this.reseedNext;
    head.fill(-1);
    const inv = 1 / dx;
    for (let pp = 0; pp < this.count; pp++) {
      const i = Math.min(Math.max(Math.floor(this.px[pp] * inv), 0), this.nx - 1);
      const j = Math.min(Math.max(Math.floor(this.py[pp] * inv), 0), this.ny - 1);
      const k = Math.min(Math.max(Math.floor(this.pz[pp] * inv), 0), this.nz - 1);
      const c = this.ic(i, j, k);
      next[pp] = head[c];
      head[c] = pp;
    }
    const kill: number[] = [];
    for (let k = 0; k < this.nz; k++) {
      for (let j = 0; j < this.ny; j++) {
        for (let i = 0; i < this.nx; i++) {
          const c = this.ic(i, j, k);
          if (this.cellType[c] !== FLUID) continue;
          const n = this.cellCount[c];
          if (n > maxCount && this.liquidPhi[c] < -dx) {
            let pp = head[c];
            let seen = 0;
            while (pp >= 0) {
              seen++;
              if (seen > maxCount) kill.push(pp);
              pp = next[pp];
            }
          } else if (
            n < minCount && this.liquidPhi[c] < -dx && this.solidPhiC[c] > 0.75 * dx
          ) {
            const add = target - n;
            for (let a = 0; a < add; a++) {
              const x = (i + this.rng.next()) * dx;
              const y = (j + this.rng.next()) * dx;
              const z = (k + this.rng.next()) * dx;
              if (this.scene.sdf(x, y, z) < 0) continue;
              const [uu, vv, ww] = this.sampleVel(x, y, z);
              this.addParticle(x, y, z, uu, vv, ww);
            }
          }
        }
      }
    }
    kill.sort((a, b) => b - a);
    for (const k of kill) this.removeParticle(k);
  }

  /** Semeia um bloco [x0..x1]×[y0..y1]×[z0..z1] fora dos sólidos. */
  seedBlock(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    jitter: number, vel: (x: number, y: number, z: number) => [number, number, number],
  ): void {
    const nAxis = Math.max(2, Math.round(Math.cbrt(this.params.particlesPerCell)));
    const h = this.dx / nAxis;
    const i0 = Math.floor(x0 / h), i1 = Math.ceil(x1 / h);
    const j0 = Math.floor(y0 / h), j1 = Math.ceil(y1 / h);
    const k0 = Math.floor(z0 / h), k1 = Math.ceil(z1 / h);
    for (let k = k0; k < k1; k++) {
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          const x = (i + 0.5) * h + jitter * h * (this.rng.next() - 0.5);
          const y = (j + 0.5) * h + jitter * h * (this.rng.next() - 0.5);
          const z = (k + 0.5) * h + jitter * h * (this.rng.next() - 0.5);
          if (x < x0 || x >= x1 || y < y0 || y >= y1 || z < z0 || z >= z1) continue;
          if (this.scene.sdf(x, y, z) < 0) continue;
          const [uu, vv, ww] = vel(x, y, z);
          this.addParticle(x, y, z, uu, vv, ww);
        }
      }
    }
  }
}
