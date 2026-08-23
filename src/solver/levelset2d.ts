/**
 * Level set do líquido a partir das partículas (§3.2.6).
 *
 * φ(x) = min_p |x − x_p| − r, com r ~ metade do espaçamento entre partículas.
 * O sinal de φ nos centros de célula define onde está a água; a FRAÇÃO
 * θ = φ_F/(φ_F − φ_A) entre uma célula FLUID e uma AIR vizinha posiciona a
 * superfície livre DENTRO da célula para o método ghost-fluid — sem isso a
 * altura de subida no tubo e o jato sairiam errados por até meia célula.
 */

import { Grid2D } from './grid2d';
import { Particles2D } from './particles2d';

const PHI_MAX_CELLS = 3; // valor de saturação (em células) longe da água

export function computeLiquidPhi(
  parts: Particles2D, g: Grid2D, particleRadius: number, smoothPasses = 2,
): void {
  const { nx, ny, dx } = g;
  const phi = g.liquidPhi;
  const cap = PHI_MAX_CELLS * dx;
  phi.fill(cap);

  // Distância mínima às partículas, varrendo a vizinhança 3×3 de cada uma
  for (let p = 0; p < parts.count; p++) {
    const ci = Math.floor(parts.x[p] / dx);
    const cj = Math.floor(parts.y[p] / dx);
    for (let j = Math.max(0, cj - 1); j <= Math.min(ny - 1, cj + 1); j++) {
      for (let i = Math.max(0, ci - 1); i <= Math.min(nx - 1, ci + 1); i++) {
        const cx = (i + 0.5) * dx;
        const cy = (j + 0.5) * dx;
        const d = Math.hypot(cx - parts.x[p], cy - parts.y[p]) - particleRadius;
        const k = g.ic(i, j);
        if (d < phi[k]) phi[k] = d;
      }
    }
  }

  // Suavização leve (média com vizinhos) perto da superfície: remove o
  // "caroço" da amostragem discreta sem deslocar superfícies planas —
  // a média de um campo linear é o próprio campo linear. IMPORTANTE:
  // inclui as células de borda (vizinho espelhado); pular a borda criaria
  // um degrau de θ na junção parede–superfície e chutes espúrios ali.
  const tmp = new Float64Array(phi.length);
  for (let pass = 0; pass < smoothPasses; pass++) {
    tmp.set(phi);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = g.ic(i, j);
        if (Math.abs(tmp[k]) > 2 * dx) continue; // só perto da superfície
        const l = i > 0 ? tmp[k - 1] : tmp[k];
        const r = i < nx - 1 ? tmp[k + 1] : tmp[k];
        const b = j > 0 ? tmp[k - nx] : tmp[k];
        const t = j < ny - 1 ? tmp[k + nx] : tmp[k];
        phi[k] = 0.5 * tmp[k] + 0.125 * (l + r + b + t);
      }
    }
  }
}
