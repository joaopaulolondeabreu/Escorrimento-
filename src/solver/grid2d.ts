/**
 * Grade MAC (Marker-And-Cell) escalonada em 2D.
 *
 * Discretização clássica de Harlow & Welch: as componentes de velocidade
 * vivem nas FACES das células (u nas faces verticais, v nas horizontais) e a
 * pressão vive nos CENTROS. Este escalonamento evita o desacoplamento
 * par/ímpar da pressão e torna o operador divergência/gradiente adjunto um
 * do outro — essencial para a projeção (§3.2.6).
 *
 * Convenções de indexação (célula i ∈ [0,nx), j ∈ [0,ny)):
 *   u(i,j): face vertical entre as células (i-1,j) e (i,j); i ∈ [0,nx]
 *           posição física: (i·dx, (j+0.5)·dx)
 *   v(i,j): face horizontal entre (i,j-1) e (i,j); j ∈ [0,ny]
 *           posição física: ((i+0.5)·dx, j·dx)
 *   p(i,j): centro da célula ((i+0.5)·dx, (j+0.5)·dx)
 */

import type { Sdf2 } from './sdf';
import { freeFraction } from './sdf';

export const AIR = 0;
export const FLUID = 1;
export const SOLID = 2;

/** Comportamento de cada lado do domínio (§4.3). */
export type SideBC =
  | { kind: 'wall' }                       // parede sólida (velocidade dada)
  // parede móvel que injeta fluido; belowY: injeta só abaixo dessa altura
  | { kind: 'inflow'; u: number; v: number; belowY?: number }
  | { kind: 'open' }                       // aberto ao ar, p' = 0
  | { kind: 'outflow'; hydroLevel: number }; // saída com p' hidrostático

export interface DomainBC {
  left: SideBC;
  right: SideBC;
  bottom: SideBC;
  top: SideBC;
}

export class Grid2D {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;

  /** Velocidades nas faces (componente normal à face). */
  u: Float64Array;
  v: Float64Array;
  /** Cópia das velocidades pós-P2G (para o blend FLIP, Δu = u − uOld). */
  uOld: Float64Array;
  vOld: Float64Array;
  /** Massa acumulada na transferência P2G (peso de normalização). */
  uMass: Float64Array;
  vMass: Float64Array;
  /** Marcação de faces com valor definido (para extrapolação). */
  uValid: Uint8Array;
  vValid: Uint8Array;

  /** Pressão (na verdade p' = p − P₀; só gradientes importam). */
  p: Float64Array;
  /** Tipo de célula: AIR / FLUID / SOLID. */
  cellType: Uint8Array;
  /** Level set do líquido nos centros (φ < 0 dentro da água). */
  liquidPhi: Float64Array;
  /** SDF do sólido amostrado nos NÓS da grade ((nx+1)×(ny+1)). */
  solidPhiNode: Float64Array;
  /** SDF do sólido amostrado nos centros (classificação de células). */
  solidPhiCenter: Float64Array;

  /** Frações LIVRES das faces (cut-cell): 1 = fluido, 0 = sólido (§3.2.6). */
  uW: Float64Array;
  vW: Float64Array;
  /** Velocidade do sólido nas faces (leito móvel, parede de entrada). */
  uSolid: Float64Array;
  vSolid: Float64Array;

  bc: DomainBC = {
    left: { kind: 'wall' },
    right: { kind: 'wall' },
    bottom: { kind: 'wall' },
    top: { kind: 'open' },
  };

  constructor(nx: number, ny: number, dx: number) {
    this.nx = nx;
    this.ny = ny;
    this.dx = dx;
    const nu = (nx + 1) * ny;
    const nv = nx * (ny + 1);
    const nc = nx * ny;
    this.u = new Float64Array(nu);
    this.v = new Float64Array(nv);
    this.uOld = new Float64Array(nu);
    this.vOld = new Float64Array(nv);
    this.uMass = new Float64Array(nu);
    this.vMass = new Float64Array(nv);
    this.uValid = new Uint8Array(nu);
    this.vValid = new Uint8Array(nv);
    this.p = new Float64Array(nc);
    this.cellType = new Uint8Array(nc);
    this.liquidPhi = new Float64Array(nc);
    this.solidPhiNode = new Float64Array((nx + 1) * (ny + 1));
    this.solidPhiCenter = new Float64Array(nc);
    this.uW = new Float64Array(nu);
    this.vW = new Float64Array(nv);
    this.uSolid = new Float64Array(nu);
    this.vSolid = new Float64Array(nv);
  }

  // ------------------------------------------------------------- indexação
  iu(i: number, j: number): number { return i + j * (this.nx + 1); }
  iv(i: number, j: number): number { return i + j * this.nx; }
  ic(i: number, j: number): number { return i + j * this.nx; }
  inode(i: number, j: number): number { return i + j * (this.nx + 1); }

  get width(): number { return this.nx * this.dx; }
  get height(): number { return this.ny * this.dx; }

  /**
   * Define a geometria sólida: amostra o SDF nos nós e centros, calcula as
   * frações de face e a velocidade do sólido em cada face. Chamado uma vez
   * por cena (geometria estática no referencial do trem — §1.1).
   */
  setSolids(sdf: Sdf2, solidVel: (x: number, y: number) => [number, number]): void {
    const { nx, ny, dx } = this;
    // SDF nos nós
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        this.solidPhiNode[this.inode(i, j)] = sdf(i * dx, j * dx);
      }
    }
    // SDF nos centros
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        this.solidPhiCenter[this.ic(i, j)] = sdf((i + 0.5) * dx, (j + 0.5) * dx);
      }
    }
    // Frações das faces u: a face u(i,j) é o segmento entre os nós (i,j)-(i,j+1)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const a = this.solidPhiNode[this.inode(i, j)];
        const b = this.solidPhiNode[this.inode(i, j + 1)];
        this.uW[this.iu(i, j)] = freeFraction(a, b);
        const [us] = solidVel(i * dx, (j + 0.5) * dx);
        this.uSolid[this.iu(i, j)] = us;
      }
    }
    // Frações das faces v: segmento entre os nós (i,j)-(i+1,j)
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = this.solidPhiNode[this.inode(i, j)];
        const b = this.solidPhiNode[this.inode(i + 1, j)];
        this.vW[this.iv(i, j)] = freeFraction(a, b);
        const [, vs] = solidVel((i + 0.5) * dx, j * dx);
        this.vSolid[this.iv(i, j)] = vs;
      }
    }
    // Bordas do domínio: lados 'wall'/'inflow' são paredes (fração 0,
    // velocidade prescrita); lados 'open'/'outflow' ficam livres.
    this.applyDomainEdgeWeights();
  }

  private applyDomainEdgeWeights(): void {
    const { nx, ny } = this;
    const setSideU = (i: number, side: SideBC) => {
      for (let j = 0; j < ny; j++) {
        const k = this.iu(i, j);
        if (side.kind === 'wall') { this.uW[k] = 0; this.uSolid[k] = 0; }
        else if (side.kind === 'inflow') {
          const y = (j + 0.5) * this.dx;
          const below = side.belowY === undefined || y <= side.belowY;
          this.uW[k] = 0;
          this.uSolid[k] = below ? side.u : 0;
        }
        // 'open'/'outflow': mantém a fração calculada (normalmente 1)
      }
    };
    const setSideV = (j: number, side: SideBC) => {
      for (let i = 0; i < nx; i++) {
        const k = this.iv(i, j);
        if (side.kind === 'wall') { this.vW[k] = 0; this.vSolid[k] = 0; }
        else if (side.kind === 'inflow') { this.vW[k] = 0; this.vSolid[k] = side.v; }
      }
    };
    setSideU(0, this.bc.left);
    setSideU(nx, this.bc.right);
    setSideV(0, this.bc.bottom);
    setSideV(ny, this.bc.top);
  }

  /**
   * Classifica células (§3.2.2): SOLID pelo SDF no centro; FLUID se o level
   * set do líquido for negativo (célula contém água); AIR caso contrário.
   * `hasParticles` marca células que contêm ao menos uma partícula.
   */
  classifyCells(hasParticles: Uint8Array): void {
    const n = this.nx * this.ny;
    for (let k = 0; k < n; k++) {
      if (this.solidPhiCenter[k] < 0) this.cellType[k] = SOLID;
      else if (hasParticles[k]) this.cellType[k] = FLUID;
      else this.cellType[k] = AIR;
    }
  }

  /**
   * Impõe a velocidade do sólido nas faces de parede (fração 0) e nas faces
   * na borda do domínio. A componente NORMAL da velocidade nas faces
   * sólidas é a do sólido (u·n = u_solid·n) — condição free-slip; o caso
   * no-slip é tratado no passo viscoso (§4.3).
   */
  enforceSolidFaces(): void {
    const { nx, ny } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const k = this.iu(i, j);
        if (this.uW[k] === 0) { this.u[k] = this.uSolid[k]; this.uValid[k] = 1; }
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = this.iv(i, j);
        if (this.vW[k] === 0) { this.v[k] = this.vSolid[k]; this.vValid[k] = 1; }
      }
    }
  }

  /**
   * Divergência ponderada pelas frações de face (formulação cut-cell):
   *   div = [wR·uR − wL·uL + wT·vT − wB·vB
   *          + (1−wR)·usR − (1−wL)·usL + (1−wT)·vsT − (1−wB)·vsB] / dx
   * Os termos com (1−w) representam o fluxo imposto pelo sólido móvel
   * (leito do canal a −V, parede de entrada) — é assim que a condição de
   * contorno de parede móvel entra na projeção (§4.3).
   */
  divergence(i: number, j: number): number {
    const kL = this.iu(i, j), kR = this.iu(i + 1, j);
    const kB = this.iv(i, j), kT = this.iv(i, j + 1);
    const wL = this.uW[kL], wR = this.uW[kR];
    const wB = this.vW[kB], wT = this.vW[kT];
    return (
      wR * this.u[kR] - wL * this.u[kL] +
      wT * this.v[kT] - wB * this.v[kB] +
      (1 - wR) * this.uSolid[kR] - (1 - wL) * this.uSolid[kL] +
      (1 - wT) * this.vSolid[kT] - (1 - wB) * this.vSolid[kB]
    ) / this.dx;
  }

  /** Máxima |velocidade| nas faces (para o passo CFL, §3.3). */
  maxSpeed(): number {
    let m = 0;
    for (let k = 0; k < this.u.length; k++) m = Math.max(m, Math.abs(this.u[k]));
    for (let k = 0; k < this.v.length; k++) m = Math.max(m, Math.abs(this.v[k]));
    return m;
  }

  // ---------------------------------------------- amostragem bilinear (advecção)

  /** Interpola u na posição física (x,y) — bilinear na grade de faces u. */
  sampleU(x: number, y: number): number {
    const { nx, ny, dx } = this;
    let gx = x / dx;            // grade u: nós em x inteiros
    let gy = y / dx - 0.5;      // e em y deslocados de meia célula
    gx = Math.min(Math.max(gx, 0), nx);
    gy = Math.min(Math.max(gy, 0), ny - 1);
    const i0 = Math.min(Math.floor(gx), nx - 1);
    const j0 = Math.min(Math.floor(gy), ny - 2 >= 0 ? ny - 2 : 0);
    const fx = gx - i0, fy = gy - j0;
    const j1 = Math.min(j0 + 1, ny - 1);
    return (
      (1 - fx) * (1 - fy) * this.u[this.iu(i0, j0)] +
      fx * (1 - fy) * this.u[this.iu(i0 + 1, j0)] +
      (1 - fx) * fy * this.u[this.iu(i0, j1)] +
      fx * fy * this.u[this.iu(i0 + 1, j1)]
    );
  }

  /** Interpola v na posição física (x,y) — bilinear na grade de faces v. */
  sampleV(x: number, y: number): number {
    const { nx, ny, dx } = this;
    let gx = x / dx - 0.5;
    let gy = y / dx;
    gx = Math.min(Math.max(gx, 0), nx - 1);
    gy = Math.min(Math.max(gy, 0), ny);
    const i0 = Math.min(Math.floor(gx), nx - 2 >= 0 ? nx - 2 : 0);
    const j0 = Math.min(Math.floor(gy), ny - 1);
    const fx = gx - i0, fy = gy - j0;
    const i1 = Math.min(i0 + 1, nx - 1);
    return (
      (1 - fx) * (1 - fy) * this.v[this.iv(i0, j0)] +
      fx * (1 - fy) * this.v[this.iv(i1, j0)] +
      (1 - fx) * fy * this.v[this.iv(i0, j0 + 1)] +
      fx * fy * this.v[this.iv(i1, j0 + 1)]
    );
  }

  /** Velocidade interpolada (u,v) em (x,y). */
  sampleVel(x: number, y: number): [number, number] {
    return [this.sampleU(x, y), this.sampleV(x, y)];
  }
}
