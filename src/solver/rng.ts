/**
 * Gerador de números pseudoaleatórios determinístico (mulberry32).
 *
 * O simulador exige determinismo total (§3.3): duas execuções com os mesmos
 * parâmetros devem produzir exatamente o mesmo resultado. Por isso NUNCA
 * usamos Math.random() — toda aleatoriedade (jitter de partículas,
 * reamostragem) passa por esta classe, com semente fixa.
 */
export class Rng {
  private state: number;

  constructor(seed = 1337) {
    this.state = seed >>> 0;
  }

  /** Retorna um número uniforme em [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniforme em [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Reinicia a semente (para reprodutibilidade entre execuções). */
  reset(seed: number): void {
    this.state = seed >>> 0;
  }
}
