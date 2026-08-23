/**
 * Armazenamento de partículas 2D (estrutura de arrays, SoA).
 *
 * As partículas carregam o material (transporte lagrangiano, sem difusão
 * numérica) enquanto a grade resolve a incompressibilidade (§3.2). Cada
 * partícula guarda posição, velocidade e a matriz afim C do método APIC
 * (Jiang et al., 2015): as linhas cu = (∂u/∂x, ∂u/∂y) e cv = (∂v/∂x, ∂v/∂y)
 * reconstroem o campo de velocidade LOCALMENTE afim em torno da partícula,
 * preservando momento angular e eliminando o ruído do FLIP puro.
 */

import { Rng } from './rng';

export class Particles2D {
  count = 0;
  capacity: number;

  x: Float64Array;
  y: Float64Array;
  u: Float64Array;
  v: Float64Array;
  // Matriz afim APIC: linha de u e linha de v
  cux: Float64Array;
  cuy: Float64Array;
  cvx: Float64Array;
  cvy: Float64Array;

  constructor(capacity = 1 << 16) {
    this.capacity = capacity;
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.u = new Float64Array(capacity);
    this.v = new Float64Array(capacity);
    this.cux = new Float64Array(capacity);
    this.cuy = new Float64Array(capacity);
    this.cvx = new Float64Array(capacity);
    this.cvy = new Float64Array(capacity);
  }

  private grow(): void {
    const nc = this.capacity * 2;
    const copy = (a: Float64Array) => {
      const b = new Float64Array(nc);
      b.set(a);
      return b;
    };
    this.x = copy(this.x);
    this.y = copy(this.y);
    this.u = copy(this.u);
    this.v = copy(this.v);
    this.cux = copy(this.cux);
    this.cuy = copy(this.cuy);
    this.cvx = copy(this.cvx);
    this.cvy = copy(this.cvy);
    this.capacity = nc;
  }

  add(x: number, y: number, u = 0, v = 0): number {
    if (this.count >= this.capacity) this.grow();
    const k = this.count++;
    this.x[k] = x; this.y[k] = y;
    this.u[k] = u; this.v[k] = v;
    this.cux[k] = 0; this.cuy[k] = 0;
    this.cvx[k] = 0; this.cvy[k] = 0;
    return k;
  }

  /** Remove a partícula k trocando-a com a última (O(1), ordem determinística). */
  remove(k: number): void {
    const last = --this.count;
    if (k !== last) {
      this.x[k] = this.x[last]; this.y[k] = this.y[last];
      this.u[k] = this.u[last]; this.v[k] = this.v[last];
      this.cux[k] = this.cux[last]; this.cuy[k] = this.cuy[last];
      this.cvx[k] = this.cvx[last]; this.cvy[k] = this.cvy[last];
    }
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * Semeia um bloco retangular [x0,x1]×[y0,y1] com `nPerAxis`² partículas por
   * célula, em sub-rede regular com jitter opcional (determinístico via rng).
   * `accept` permite recusar posições (ex.: dentro de sólido).
   */
  seedBlock(
    x0: number, y0: number, x1: number, y1: number,
    dx: number, nPerAxis: number, rng: Rng, jitter: number,
    accept: (x: number, y: number) => boolean,
    vel: (x: number, y: number) => [number, number] = () => [0, 0],
  ): void {
    const h = dx / nPerAxis;
    const i0 = Math.floor(x0 / h), i1 = Math.ceil(x1 / h);
    const j0 = Math.floor(y0 / h), j1 = Math.ceil(y1 / h);
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const px = (i + 0.5) * h + jitter * h * (rng.next() - 0.5);
        const py = (j + 0.5) * h + jitter * h * (rng.next() - 0.5);
        if (px < x0 || px >= x1 || py < y0 || py >= y1) continue;
        if (!accept(px, py)) continue;
        const [u, v] = vel(px, py);
        this.add(px, py, u, v);
      }
    }
  }
}
