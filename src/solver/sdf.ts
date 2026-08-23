/**
 * Campos de distância assinada (SDF) 2D e 3D.
 *
 * A geometria sólida (tubo em L, leito do canal, reservatório) é representada
 * como composição de SDFs primitivos (§4.2). Convenção: φ < 0 DENTRO do
 * sólido, φ > 0 fora. As frações de célula cortada (cut-cell) usadas na
 * projeção de pressão são derivadas destas distâncias.
 */

export type Sdf2 = (x: number, y: number) => number;
export type Sdf3 = (x: number, y: number, z: number) => number;

// ---------------------------------------------------------------- primitivos 2D

/** Meio-plano y < y0 (leito do canal). φ = y − y0. */
export function sdfHalfPlaneBelow(y0: number): Sdf2 {
  return (_x, y) => y - y0;
}

/** Caixa alinhada aos eixos, centro (cx,cy), meia-largura hx, meia-altura hy. */
export function sdfBox(cx: number, cy: number, hx: number, hy: number): Sdf2 {
  return (x, y) => {
    const dx = Math.abs(x - cx) - hx;
    const dy = Math.abs(y - cy) - hy;
    const ox = Math.max(dx, 0);
    const oy = Math.max(dy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0);
  };
}

/** Segmento de A a B com raio r (cápsula). */
export function sdfCapsule(
  ax: number, ay: number, bx: number, by: number, r: number,
): Sdf2 {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  return (x, y) => {
    const px = x - ax;
    const py = y - ay;
    const t = len2 > 0 ? Math.min(1, Math.max(0, (px * ex + py * ey) / len2)) : 0;
    return Math.hypot(px - t * ex, py - t * ey) - r;
  };
}

/** Arco de circunferência (para o cotovelo B): centro c, raio R, espessura 2r,
 *  limitado ao quadrante definido pelos ângulos [a0, a1] (radianos). */
export function sdfArc(
  cx: number, cy: number, R: number, r: number, a0: number, a1: number,
): Sdf2 {
  return (x, y) => {
    const px = x - cx;
    const py = y - cy;
    let ang = Math.atan2(py, px);
    // Ajusta o ângulo para o intervalo [a0, a1]
    while (ang < a0) ang += 2 * Math.PI;
    if (ang > a1) {
      // Fora do setor angular: distância aos extremos do arco
      const e0x = cx + R * Math.cos(a0);
      const e0y = cy + R * Math.sin(a0);
      const e1x = cx + R * Math.cos(a1);
      const e1y = cy + R * Math.sin(a1);
      const d0 = Math.hypot(x - e0x, y - e0y);
      const d1 = Math.hypot(x - e1x, y - e1y);
      return Math.min(d0, d1) - r;
    }
    return Math.abs(Math.hypot(px, py) - R) - r;
  };
}

// ------------------------------------------------------------- operações CSG

export function sdfUnion(...fields: Sdf2[]): Sdf2 {
  return (x, y) => {
    let d = Infinity;
    for (const f of fields) d = Math.min(d, f(x, y));
    return d;
  };
}

export function sdfSubtract(a: Sdf2, b: Sdf2): Sdf2 {
  // a \ b  →  max(φa, −φb)
  return (x, y) => Math.max(a(x, y), -b(x, y));
}

export function sdfIntersect(a: Sdf2, b: Sdf2): Sdf2 {
  return (x, y) => Math.max(a(x, y), b(x, y));
}

/** SDF constante "vazio" (nenhum sólido). */
export const sdfNone: Sdf2 = () => 1e9;

// ------------------------------------------------------------------ gradiente

/** Normal (gradiente normalizado) do SDF por diferenças centradas. */
export function sdfNormal2(f: Sdf2, x: number, y: number, h = 1e-4): [number, number] {
  const nx = f(x + h, y) - f(x - h, y);
  const ny = f(x, y + h) - f(x, y - h);
  const len = Math.hypot(nx, ny) || 1;
  return [nx / len, ny / len];
}

/**
 * Projeta um ponto para fora do sólido (φ ≥ margem), andando ao longo da
 * normal do SDF. Usado para corrigir partículas que penetram paredes (§3.2.9).
 */
export function projectOut2(
  f: Sdf2, x: number, y: number, margin: number, maxIter = 4,
): [number, number] {
  let px = x;
  let py = y;
  for (let it = 0; it < maxIter; it++) {
    const d = f(px, py);
    if (d >= margin) break;
    const [nx, ny] = sdfNormal2(f, px, py);
    const push = margin - d;
    px += nx * push;
    py += ny * push;
  }
  return [px, py];
}

// ---------------------------------------------------------------- fração 1D

/**
 * Fração LIVRE (não-sólida) de uma aresta cujos extremos têm distâncias
 * assinadas φa e φb ao sólido. Usada para as frações de face (cut-cell) na
 * projeção de pressão: peso 1 = face totalmente no fluido, 0 = totalmente
 * dentro do sólido.
 */
export function freeFraction(phiA: number, phiB: number): number {
  if (phiA >= 0 && phiB >= 0) return 1;
  if (phiA < 0 && phiB < 0) return 0;
  // A aresta cruza a superfície: fração do lado positivo (livre)
  if (phiA >= 0) return phiA / (phiA - phiB);
  return phiB / (phiB - phiA);
}
