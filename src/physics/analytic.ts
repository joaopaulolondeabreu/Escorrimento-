/**
 * Solução analítica de referência (§1.2) — fluido ideal, incompressível,
 * escoamento permanente no referencial do trem.
 *
 * Derivação completa em docs/FISICA.md. Estas fórmulas NÃO são usadas pelo
 * solver; são a resposta esperada contra a qual a simulação é validada.
 */

export const G_STANDARD = 9.81;   // m/s²
export const RHO_WATER = 998;     // kg/m³
export const P_ATM = 101325;      // Pa
export const NU_WATER = 1.0e-6;   // m²/s

export interface IntakeTheory {
  V: number;      // velocidade do trem [m/s]
  H: number;      // altura do bocal A acima do nível do canal [m]
  A: number;      // área do bocal [m²] (ou largura D em 2D, por metro)
  rho: number;
  g: number;
}

/** Velocidade mínima do trem para haver captação: V_min = √(2gH). */
export function vMin(H: number, g = G_STANDARD): number {
  return Math.sqrt(2 * g * H);
}

/**
 * Velocidade no tubo/bocal: v = √(V² − 2gH).
 * Bernoulli entre a corrente livre (velocidade V, pressão P₀ no nível do
 * canal) e o bocal A (altura H, pressão P₀):
 *   P₀ + ½ρV² = P₀ + ½ρv² + ρgH  →  v² = V² − 2gH.
 * Retorna 0 se V < V_min (não há captação).
 */
export function tubeVelocity(V: number, H: number, g = G_STANDARD): number {
  const s = V * V - 2 * g * H;
  return s > 0 ? Math.sqrt(s) : 0;
}

/** Vazão volumétrica: φ = A·v (continuidade no bocal). */
export function flowRate(t: IntakeTheory): number {
  return t.A * tubeVelocity(t.V, t.H, t.g);
}

/** Fração do tubo de corrente capturada: A_c/A = v/V (continuidade). */
export function captureFraction(V: number, H: number, g = G_STANDARD): number {
  return V > 0 ? tubeVelocity(V, H, g) / V : 0;
}

/**
 * Sobrepressão na boca C: P_C − P₀ = ρgH — INDEPENDENTE de V.
 * Bernoulli entre C (velocidade v, profundidade ~0) e A (velocidade v,
 * altura H): a velocidade é a mesma nos dois pontos (continuidade), então
 * toda a diferença é hidrostática da coluna interna.
 */
export function overpressureC(t: IntakeTheory): number {
  return t.rho * t.g * t.H;
}

/**
 * Pressão ao longo do eixo do tubo, a altura z acima do nível do canal:
 * P(z) = P₀ + ρg(H − z). Válida com o tubo cheio e velocidade constante.
 */
export function pressureAtHeight(z: number, t: IntakeTheory): number {
  return P_ATM + t.rho * t.g * (t.H - z);
}

/**
 * Força de arrasto extra sobre o trem: F = ρ·φ·V.
 * Teorema do impulso no referencial da Terra: a água capturada (vazão
 * mássica ρφ) é acelerada do repouso até a velocidade V do trem.
 */
export function dragForce(t: IntakeTheory): number {
  return t.rho * flowRate(t) * t.V;
}

/**
 * Potência extra do motor: Π = F·V = ρ·φ·V².
 * Forma polinomial em φ: Π = (ρ/A²)·φ³ + 2ρgH·φ  (com V² = v² + 2gH e
 * v = φ/A). Metade do primeiro termo vira energia cinética da água no
 * referencial da Terra; o resto vira energia potencial + energia cinética
 * no referencial do trem (dissipada no reservatório).
 */
export function extraPower(t: IntakeTheory): number {
  return dragForce(t) * t.V;
}

/** Coeficientes da forma Π = c₁·φ³ + c₂·φ. */
export function powerCoefficients(t: IntakeTheory): { c1: number; c2: number } {
  return { c1: t.rho / (t.A * t.A), c2: 2 * t.rho * t.g * t.H };
}

/** Altura do jato livre acima de A: h = v²/(2g) (queda livre). */
export function jetHeight(V: number, H: number, g = G_STANDARD): number {
  const v = tubeVelocity(V, H, g);
  return (v * v) / (2 * g);
}

/** Pressão de vapor da água a 20 °C (aviso de cavitação, §7.3). */
export const P_VAPOR_20C = 2339; // Pa
