/**
 * Sondas de medição do problema-alvo (§6.2) — versão 2D.
 *
 * Em 2D todas as grandezas são POR METRO DE LARGURA:
 *   A → D [m²/m],  φ = ∫u·n dl [m²/s],  F [N/m],  Π [W/m].
 * O HUD compara com a teoria também escrita por metro de largura. A
 * distorção do 2D (a água não contorna lateralmente — §4.1) é lembrada na
 * interface; a comparação quantitativa fiel exige o modo 3D.
 */

import { FLUID, SOLID, Grid2D } from '../solver/grid2d';
import { Solver2D } from '../solver/solver2d';
import { IntakeParams, intakeGeometry, IntakeGeometry } from '../solver/intake2d';
import { P_VAPOR_20C, P_ATM } from './analytic';

export interface IntakeMeasurement {
  vNozzle: number;        // velocidade média no bocal A [m/s]
  flux: number;           // vazão por largura φ [m²/s]
  overpressureC: number;  // P_C − P₀ [Pa]
  dragForce: number;      // F_x por largura [N/m] (integral de pressão)
  power: number;          // Π = F·V [W/m]
  captureFraction: number; // A_c/A via traçadores retro-integrados
  jetHeight: number;      // altura do jato acima de A [m]
  reservoirLevel: number; // nível de água no reservatório [m acima do piso]
  minPressureAbs: number; // pressão absoluta mínima no fluido [Pa]
  cavitationRisk: boolean;
  tubeFilled: number;     // fração do tubo vertical preenchida (0..1)
}

/** Média/integral da velocidade vertical no plano do bocal A. */
export function measureNozzle(
  g: Grid2D, geo: IntakeGeometry, D: number,
): { v: number; flux: number } {
  const dx = g.dx;
  const j = Math.min(Math.round(geo.yA / dx) - 1, g.ny - 1); // uma linha abaixo da saída
  const i0 = Math.max(0, Math.floor((geo.xTube - D / 2) / dx));
  const i1 = Math.min(g.nx - 1, Math.ceil((geo.xTube + D / 2) / dx));
  let sum = 0;
  let len = 0;
  for (let i = i0; i <= i1; i++) {
    const xFace = (i + 0.5) * dx;
    if (Math.abs(xFace - geo.xTube) > D / 2) continue;
    const k = g.iv(i, j);
    if (g.vW[k] <= 0) continue;
    // conta apenas onde há fluido (célula abaixo do plano)
    const cellBelow = g.ic(i, Math.max(0, j - 1));
    if (g.cellType[cellBelow] !== FLUID) { len += dx; continue; }
    sum += g.v[k] * dx;
    len += dx;
  }
  return { v: len > 0 ? sum / len : 0, flux: sum };
}

/**
 * Média da pressão (p' = P − P₀) na entrada do duto. Amostra uma faixa de
 * 0.05–0.15 m PARA DENTRO da boca C: exatamente no plano da boca a média
 * seria contaminada pela estagnação do escoamento externo que contorna o
 * lábio (em especial no 2D, onde o bloqueio do canal é grande).
 */
export function measureMouthPressure(
  g: Grid2D, geo: IntakeGeometry,
): number {
  const dx = g.dx;
  const i0 = Math.max(0, Math.floor((geo.xC - 0.15) / dx));
  const i1 = Math.max(0, Math.floor((geo.xC - 0.05) / dx));
  let sum = 0;
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    for (let j = 0; j < g.ny; j++) {
      const y = (j + 0.5) * dx;
      if (y < geo.mouthY0 || y > geo.mouthY1) continue;
      const k = g.ic(i, j);
      if (g.cellType[k] !== FLUID) continue;
      sum += g.p[k];
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Força horizontal sobre o conjunto tubo+reservatório: integral de pressão
 * de primeira ordem sobre as faces fluido↔sólido (§6.2). A componente
 * viscosa é desprezível em free-slip; em no-slip a tensão de cisalhamento
 * nas paredes do tubo é pequena comparada a ρφV e não é somada aqui —
 * limitação documentada.
 */
export function measureDragX(g: Grid2D): number {
  const dx = g.dx;
  let fx = 0;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = g.ic(i, j);
      if (g.cellType[k] !== FLUID) continue;
      // vizinho à direita sólido: pressão empurra o sólido em +x
      if (i + 1 < g.nx && g.cellType[k + 1] === SOLID) {
        const blocked = 1 - g.uW[g.iu(i + 1, j)];
        fx += g.p[k] * blocked * dx;
      }
      // vizinho à esquerda sólido: pressão empurra o sólido em −x
      if (i - 1 >= 0 && g.cellType[k - 1] === SOLID) {
        const blocked = 1 - g.uW[g.iu(i, j)];
        fx -= g.p[k] * blocked * dx;
      }
    }
  }
  return fx;
}

/**
 * Fração capturada A_c/A por retro-integração de traçadores (§5.5, §6.2):
 * traçadores são soltos numa coluna a montante e integrados no campo de
 * velocidade CONGELADO (hipótese de regime permanente); a espessura da
 * camada capturada δ satisfaz δ·V = D·v ⟹ A_c/A = δ·V/(D·v)... aqui
 * devolvemos diretamente δ (espessura capturada) e a fração δ/δ_teo é
 * computada no HUD. Retorna também as trajetórias para visualização.
 */
export interface TracerResult {
  capturedThickness: number;  // δ [m]
  paths: Array<{ captured: boolean; pts: Float32Array }>; // trajetórias (x,y)
}

export function traceCaptureFraction(
  g: Grid2D, geo: IntakeGeometry, p: IntakeParams,
  nTracers = 60, recordPaths = false,
): TracerResult {
  const dx = g.dx;
  const x0 = Math.min(geo.xC + 1.5, g.width - 3 * dx);
  const dtT = 0.4 * dx / Math.max(p.V, 0.5);
  const maxSteps = Math.ceil((g.width + 4 * (geo.yA + 1)) / (Math.max(p.V, 0.5) * dtT));
  const paths: TracerResult['paths'] = [];
  let capturedCount = 0;
  const spacing = p.waterDepth / (nTracers + 1);

  for (let t = 1; t <= nTracers; t++) {
    let x = x0;
    let y = t * spacing;
    const rec: number[] = recordPaths ? [x, y] : [];
    let captured = false;
    for (let n = 0; n < maxSteps; n++) {
      // RK2 (ponto médio) no campo congelado
      const [u1, v1] = g.sampleVel(x, y);
      const [u2, v2] = g.sampleVel(x + 0.5 * dtT * u1, y + 0.5 * dtT * v1);
      x += dtT * u2;
      y += dtT * v2;
      if (recordPaths && n % 4 === 0) { rec.push(x, y); }
      // capturado: DENTRO do trecho vertical interno do tubo (o critério
      // largo anterior contava água de galgamento por cima do duto como
      // capturada — achado da revisão adversarial)
      if (Math.abs(x - geo.xTube) < p.D / 2 && y > geo.mouthY1 + p.elbowR) {
        captured = true;
        break;
      }
      // perdido: passou por baixo/atrás do tubo ou saiu do domínio
      if (x < geo.xTube - p.D || x <= 2 * dx || x >= g.width - dx) break;
      if (y <= 0 || y >= geo.yA) break;
    }
    if (captured) capturedCount++;
    if (recordPaths) {
      paths.push({ captured, pts: new Float32Array(rec) });
    }
  }
  return {
    capturedThickness: (capturedCount / nTracers) * p.waterDepth,
    paths,
  };
}

/** Altura do jato acima do bocal A (máximo y de partícula sobre o tubo). */
export function measureJetHeight(s: Solver2D, geo: IntakeGeometry, D: number): number {
  let maxY = geo.yA;
  for (let k = 0; k < s.parts.count; k++) {
    if (Math.abs(s.parts.x[k] - geo.xTube) < D && s.parts.y[k] > maxY) {
      maxY = s.parts.y[k];
    }
  }
  return maxY - geo.yA;
}

/** Nível médio de água no reservatório (excluindo a região do jato). */
export function measureReservoirLevel(g: Grid2D, geo: IntakeGeometry, D: number): number {
  const dx = g.dx;
  const j0 = Math.floor(geo.resFloorY / dx) + 1;
  let fluidArea = 0;
  let width = 0;
  const i0 = Math.floor(geo.resX0 / dx) + 1;
  const i1 = Math.floor(geo.resX1 / dx) - 1;
  for (let i = i0; i <= i1; i++) {
    const x = (i + 0.5) * dx;
    if (Math.abs(x - geo.xTube) < D) continue; // fora da coluna do jato
    width += dx;
    for (let j = j0; j < g.ny; j++) {
      if (g.cellType[g.ic(i, j)] === FLUID) fluidArea += dx * dx;
    }
  }
  return width > 0 ? fluidArea / width : 0;
}

/** Fração do tubo vertical preenchida com fluido (deve ser ~1: §1.2-5). */
export function measureTubeFilled(g: Grid2D, geo: IntakeGeometry, D: number): number {
  const dx = g.dx;
  const i0 = Math.floor((geo.xTube - D / 2) / dx) + 1;
  const i1 = Math.floor((geo.xTube + D / 2) / dx) - 1;
  const j0 = Math.floor((geo.mouthY1 + 0.05) / dx);
  const j1 = Math.floor((geo.yA - 0.05) / dx);
  let fluid = 0;
  let total = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = g.ic(i, j);
      if (g.cellType[k] === SOLID) continue;
      total++;
      if (g.cellType[k] === FLUID) fluid++;
    }
  }
  return total > 0 ? fluid / total : 0;
}

/** Pressão absoluta mínima nas células fluidas (aviso de cavitação §7.3). */
export function measureMinPressure(g: Grid2D): number {
  let minP = Infinity;
  for (let k = 0; k < g.p.length; k++) {
    if (g.cellType[k] === FLUID && g.p[k] < minP) minP = g.p[k];
  }
  return minP === Infinity ? P_ATM : minP + P_ATM;
}

/** Medição completa (chamada pelo HUD a cada N passos). */
export function measureIntake(
  s: Solver2D, p: IntakeParams,
): IntakeMeasurement {
  const g = s.grid;
  const geo = intakeGeometry(p, g.dx);
  const noz = measureNozzle(g, geo, p.D);
  const pC = measureMouthPressure(g, geo);
  const fx = measureDragX(g);
  const tr = traceCaptureFraction(g, geo, p);
  const minP = measureMinPressure(g);
  return {
    vNozzle: noz.v,
    flux: noz.flux,
    overpressureC: pC,
    dragForce: fx,
    power: fx * p.V,
    // Em 2D: A_c/A = δ/D (camada capturada δ satisfaz δ·V = D·v)
    captureFraction: tr.capturedThickness / p.D,
    jetHeight: measureJetHeight(s, geo, p.D),
    reservoirLevel: measureReservoirLevel(g, geo, p.D),
    minPressureAbs: minP,
    cavitationRisk: minP < P_VAPOR_20C,
    tubeFilled: measureTubeFilled(g, geo, p.D),
  };
}
