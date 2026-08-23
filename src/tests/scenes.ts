/**
 * Cenas auxiliares para os testes canônicos (§7.1).
 * Todas determinísticas (semente fixa, sem Math.random).
 */

import { Solver2D, Scene2D, SolverParams2D } from '../solver/solver2d';
import { sdfNone } from '../solver/sdf';

/** Cena "tanque fechado": paredes em três lados, topo aberto, sem sólidos internos. */
export function tankScene(): Scene2D {
  return {
    name: 'tanque',
    sdf: sdfNone,
    solidVel: () => [0, 0],
    bc: {
      left: { kind: 'wall' },
      right: { kind: 'wall' },
      bottom: { kind: 'wall' },
      top: { kind: 'open' },
    },
  };
}

/** Cena "caixa fechada" (Taylor–Green): paredes nos quatro lados. */
export function closedBoxScene(): Scene2D {
  return {
    name: 'caixa-fechada',
    sdf: sdfNone,
    solidVel: () => [0, 0],
    bc: {
      left: { kind: 'wall' },
      right: { kind: 'wall' },
      bottom: { kind: 'wall' },
      top: { kind: 'wall' },
    },
  };
}

/**
 * Tanque com água em repouso até a altura `waterLevel`.
 * jitter=0 → partículas em sub-rede regular (teste hidrostático).
 */
export function makeRestingTank(
  nx: number, ny: number, dx: number, waterLevel: number,
  params?: Partial<SolverParams2D>, jitter = 0,
): Solver2D {
  const s = new Solver2D(nx, ny, dx, tankScene(), params);
  const nAxis = Math.round(Math.sqrt(s.params.particlesPerCell));
  s.parts.seedBlock(
    0, 0, nx * dx, waterLevel, dx, nAxis, s.rng, jitter,
    () => true,
  );
  s.markInitialMass();
  return s;
}

/** Coluna de água para o dam break: largura a, altura h, canto esquerdo. */
export function makeDamBreak(
  nx: number, ny: number, dx: number, a: number, h: number,
  params?: Partial<SolverParams2D>,
): Solver2D {
  const s = new Solver2D(nx, ny, dx, tankScene(), params);
  const nAxis = Math.round(Math.sqrt(s.params.particlesPerCell));
  s.parts.seedBlock(0, 0, a, h, dx, nAxis, s.rng, 0.3, () => true);
  s.markInitialMass();
  return s;
}

/**
 * Vórtice de Taylor–Green em caixa fechada (paredes free-slip são planos de
 * simetria da solução):
 *   u =  U·sin(πx/L)·cos(πy/L)·exp(−2νπ²t/L²)
 *   v = −U·cos(πx/L)·sin(πy/L)·exp(−2νπ²t/L²)
 * Caixa L×L totalmente cheia, sem gravidade.
 */
export function makeTaylorGreen(
  n: number, L: number, U: number,
  params?: Partial<SolverParams2D>,
): Solver2D {
  const dx = L / n;
  const s = new Solver2D(n, n, dx, closedBoxScene(), {
    gy: 0,
    smagorinskyCs: 0,
    ...params,
  });
  const nAxis = Math.round(Math.sqrt(s.params.particlesPerCell));
  const k = Math.PI / L;
  s.parts.seedBlock(
    0, 0, L, L, dx, nAxis, s.rng, 0,
    () => true,
    (x, y) => [
      U * Math.sin(k * x) * Math.cos(k * y),
      -U * Math.cos(k * x) * Math.sin(k * y),
    ],
  );
  s.markInitialMass();
  return s;
}

/** Energia cinética total das partículas (por unidade de massa de partícula). */
export function particleKineticEnergy(s: Solver2D): number {
  let ke = 0;
  for (let k = 0; k < s.parts.count; k++) {
    ke += 0.5 * (s.parts.u[k] * s.parts.u[k] + s.parts.v[k] * s.parts.v[k]);
  }
  return ke;
}

/** Máxima |velocidade| entre as partículas. */
export function maxParticleSpeed(s: Solver2D): number {
  let m = 0;
  for (let k = 0; k < s.parts.count; k++) {
    m = Math.max(m, Math.hypot(s.parts.u[k], s.parts.v[k]));
  }
  return m;
}
