/**
 * Cena do problema-alvo em 2D (§1, §4): corte longitudinal do canal com o
 * tubo captador em L, no referencial do trem.
 *
 * No referencial do trem (inercial, pois V é constante — §1.1):
 *  - a água do canal chega pela borda DIREITA com velocidade (−V, 0);
 *  - o leito do canal é uma parede que se move a (−V, 0);
 *  - o tubo e o reservatório estão parados.
 *
 * Geometria por SDF (§4.2): o tubo é o "anel" a distância [D/2, D/2+t] da
 * linha média em L (dois segmentos + arco de cotovelo), cortado nos planos
 * da boca C e do bocal A para deixá-los abertos.
 */

import { Scene2D, Solver2D } from './solver2d';
import { Sdf2, sdfBox, sdfUnion, sdfIntersect } from './sdf';

export interface IntakeParams {
  V: number;            // velocidade do trem [m/s]
  H: number;            // altura do bocal A acima do nível do canal [m]
  D: number;            // diâmetro interno do tubo [m] (largura da fenda em 2D)
  wallT: number;        // espessura da parede do tubo [m]
  elbowR: number;       // raio do cotovelo B (linha média) [m]
  horizLen: number;     // comprimento do trecho horizontal C→B [m]
  waterDepth: number;   // profundidade do canal [m]
  mouthDepth: number;   // profundidade do CENTRO da boca C abaixo da superfície [m]
  domainW: number;      // largura do domínio [m]
  domainH: number;      // altura do domínio [m]
  tubeX: number;        // posição x do eixo vertical do tubo [m]
  resW: number;         // largura interna do reservatório [m]
  resHWall: number;     // altura das paredes do reservatório [m]
  drain: boolean;       // dreno no reservatório (execuções longas)
}

export function defaultIntakeParams(): IntakeParams {
  return {
    V: 8.0,
    H: 1.0,
    D: 0.25,
    wallT: 0.012,
    elbowR: 0.15,
    horizLen: 0.5,
    waterDepth: 0.30,
    // Nota (§4.2): com D = 0.25 m e canal de 0.30 m, a submersão do CENTRO
    // da boca só é geometricamente possível em [D/2 − algo, ...]; o valor
    // 0.10 m da especificação deixaria o lábio superior fora d'água.
    // Padrão adotado: 0.15 m (boca inteira submersa, folga no leito).
    mouthDepth: 0.15,
    domainW: 6.0,
    domainH: 2.25,
    tubeX: 2.8,
    resW: 1.2,
    resHWall: 0.8,
    drain: false,
  };
}

/** Grandezas geométricas derivadas, usadas por sondas e desenho. */
export interface IntakeGeometry {
  xC: number;      // plano da boca C
  yC: number;      // altura do centro da boca C
  yA: number;      // altura do bocal A (saída)
  xTube: number;   // eixo vertical do tubo
  tEff: number;    // espessura efetiva da parede (≥ 1.6·dx)
  resX0: number;   // reservatório: parede interna esquerda
  resX1: number;
  resFloorY: number;
  mouthY0: number; // abertura da boca C: [mouthY0, mouthY1]
  mouthY1: number;
}

export function intakeGeometry(p: IntakeParams, dx: number): IntakeGeometry {
  // Paredes mais finas que ~1.5 células vazariam água entre os nós da
  // grade (a fração de face não as veria). Espessura efetiva limitada por
  // baixo e documentada no README como aproximação de resolução.
  const tEff = Math.max(p.wallT, 1.6 * dx);
  const yC = Math.max(
    p.D / 2 + tEff + 0.01,
    Math.min(p.waterDepth - p.mouthDepth, p.waterDepth - 0.01),
  );
  const yA = p.waterDepth + p.H;
  const xC = p.tubeX + p.horizLen;
  return {
    xC,
    yC,
    yA,
    xTube: p.tubeX,
    tEff,
    resX0: p.tubeX - p.resW / 2,
    resX1: p.tubeX + p.resW / 2,
    resFloorY: yA - 0.06,
    mouthY0: yC - p.D / 2,
    mouthY1: yC + p.D / 2,
  };
}

/** Distância à linha média em L (segmento horizontal + arco + vertical). */
function distToLPath(
  x: number, y: number,
  xC: number, yC: number, xTube: number, yA: number, Rc: number,
): number {
  // Segmento horizontal: y = yC, x ∈ [xTube + Rc, xC]
  const hx0 = xTube + Rc;
  let d = Infinity;
  {
    const t = Math.min(Math.max(x, hx0), xC);
    d = Math.min(d, Math.hypot(x - t, y - yC));
  }
  // Segmento vertical: x = xTube, y ∈ [yC + Rc, yA]
  {
    const t = Math.min(Math.max(y, yC + Rc), yA);
    d = Math.min(d, Math.hypot(x - xTube, y - t));
  }
  // Arco do cotovelo: centro (xTube + Rc, yC + Rc), raio Rc,
  // quadrante inferior-esquerdo (ângulos 180°..270°)
  {
    const cx = xTube + Rc;
    const cy = yC + Rc;
    const px = x - cx;
    const py = y - cy;
    if (px <= 0 && py <= 0) {
      d = Math.min(d, Math.abs(Math.hypot(px, py) - Rc));
    }
  }
  return d;
}

/** SDF do conjunto sólido (tubo + reservatório), tudo preso ao trem. */
export function buildIntakeSdf(p: IntakeParams, dx: number): Sdf2 {
  const g = intakeGeometry(p, dx);
  const rIn = p.D / 2;
  const rOut = rIn + g.tEff;

  // Tubo: anel em torno da linha média, cortado na boca C (x ≤ xC) e no
  // bocal A (y ≤ yA). max() = interseção; o corte reabre as extremidades.
  const tube: Sdf2 = (x, y) => {
    const dPath = distToLPath(x, y, g.xC, g.yC, g.xTube, g.yA, p.elbowR);
    const annulus = Math.max(dPath - rOut, rIn - dPath);
    return Math.max(annulus, x - g.xC, y - g.yA);
  };

  // Reservatório: piso com furo para o tubo + duas paredes laterais.
  const wallW = 0.04;
  const floorL = sdfBox(
    (g.resX0 + (g.xTube - rOut)) / 2, g.resFloorY,
    (g.xTube - rOut - g.resX0) / 2 + wallW / 2, 0.02,
  );
  const floorR = sdfBox(
    (g.resX1 + (g.xTube + rOut)) / 2, g.resFloorY,
    (g.resX1 - (g.xTube + rOut)) / 2 + wallW / 2, 0.02,
  );
  const wallL = sdfBox(
    g.resX0 - wallW / 2, g.resFloorY + p.resHWall / 2,
    wallW / 2, p.resHWall / 2 + 0.02,
  );
  const wallR = sdfBox(
    g.resX1 + wallW / 2, g.resFloorY + p.resHWall / 2,
    wallW / 2, p.resHWall / 2 + 0.02,
  );

  return sdfUnion(tube, floorL, floorR, wallL, wallR);
}

/** Constrói a cena completa do problema-alvo. */
export function buildIntakeScene(p: IntakeParams, dx: number): Scene2D {
  const sdf = buildIntakeSdf(p, dx);
  const geo = intakeGeometry(p, dx);

  return {
    name: 'captacao',
    sdf,
    solidVel: () => [0, 0], // tubo e reservatório parados no referencial do trem
    bc: {
      right: { kind: 'inflow', u: -p.V, v: 0, belowY: p.waterDepth },
      left: { kind: 'outflow', hydroLevel: p.waterDepth },
      bottom: { kind: 'wall' }, // leito móvel: tangencial via bedU (§4.3)
      top: { kind: 'open' },
    },
    postAdvect: (s: Solver2D, _dt: number) => {
      maintainInflow(s, p);
      if (p.drain) drainReservoir(s, p, geo);
    },
  };
}

/**
 * Emissor de entrada (§4.3): mantém a coluna d'água encostada na borda
 * direita com densidade de partículas alvo e velocidade prescrita (−V, 0).
 * As partículas da banda têm a velocidade imposta — a banda funciona como
 * condição de contorno, não como fluido livre.
 */
function maintainInflow(s: Solver2D, p: IntakeParams): void {
  const g = s.grid;
  const dx = g.dx;
  const bandCells = 2;
  const x0 = g.width - bandCells * dx;
  const nAxis = Math.max(2, Math.round(Math.sqrt(s.params.particlesPerCell)));
  const target = nAxis * nAxis;

  // Conta e prescreve as partículas existentes na banda
  const counts = new Map<number, number>();
  for (let k = 0; k < s.parts.count; k++) {
    if (s.parts.x[k] < x0 || s.parts.y[k] > p.waterDepth) continue;
    s.parts.u[k] = -p.V;
    s.parts.v[k] = 0;
    s.parts.cux[k] = 0; s.parts.cuy[k] = 0;
    s.parts.cvx[k] = 0; s.parts.cvy[k] = 0;
    const ci = Math.min(Math.floor(s.parts.x[k] / dx), g.nx - 1);
    const cj = Math.floor(s.parts.y[k] / dx);
    const c = ci + cj * g.nx;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  // Completa células deficitárias
  const jMax = Math.floor(p.waterDepth / dx);
  for (let j = 0; j < jMax; j++) {
    for (let i = g.nx - bandCells; i < g.nx; i++) {
      const c = i + j * g.nx;
      const have = counts.get(c) ?? 0;
      for (let a = have; a < target; a++) {
        const px = (i + s.rng.next()) * dx;
        const py = Math.min((j + s.rng.next()) * dx, p.waterDepth - 1e-6);
        s.parts.add(px, py, -p.V, 0);
        s.emitted++;
      }
    }
  }
}

/** Dreno opcional: remove água numa faixa rente ao piso do reservatório. */
function drainReservoir(s: Solver2D, p: IntakeParams, geo: IntakeGeometry): void {
  const y0 = geo.resFloorY + 0.02;
  const y1 = y0 + 0.05;
  for (let k = s.parts.count - 1; k >= 0; k--) {
    const x = s.parts.x[k];
    const y = s.parts.y[k];
    if (y > y0 && y < y1 && (
      (x > geo.resX0 && x < geo.xTube - p.D) ||
      (x > geo.xTube + p.D && x < geo.resX1)
    )) {
      s.parts.remove(k);
      s.drained++;
    }
  }
}

/** Semeia o estado inicial: canal cheio até waterDepth, movendo-se a −V. */
export function seedIntake(s: Solver2D, p: IntakeParams): void {
  const nAxis = Math.max(2, Math.round(Math.sqrt(s.params.particlesPerCell)));
  s.parts.clear();
  s.parts.seedBlock(
    0, 0, s.grid.width, p.waterDepth, s.grid.dx, nAxis, s.rng, 0.3,
    (x, y) => s.scene.sdf(x, y) > 0,
    () => [-p.V, 0],
  );
  s.markInitialMass();
}

/** Fábrica completa: solver + cena + semeadura, pronto para rodar. */
export function makeIntakeSolver(
  nx: number, p: IntakeParams,
  solverOverrides?: Partial<import('./solver2d').SolverParams2D>,
): Solver2D {
  const dx = p.domainW / nx;
  const ny = Math.round(p.domainH / dx);
  const scene = buildIntakeScene(p, dx);
  const s = new Solver2D(nx, ny, dx, scene, {
    bedU: -p.V, // leito visto do trem (§1.1)
    ...solverOverrides,
  });
  seedIntake(s, p);
  return s;
}
