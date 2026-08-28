/**
 * Mapas de cor para o modo científico (§5.5) e barra de escala.
 * Viridis (perceptualmente uniforme) para grandezas positivas;
 * coolwarm (divergente) para vorticidade/pressão relativa.
 */

type Rgb = [number, number, number];

const VIRIDIS: Rgb[] = [
  [68, 1, 84], [71, 44, 122], [59, 81, 139], [44, 113, 142],
  [33, 144, 141], [39, 173, 129], [92, 200, 99], [170, 220, 50],
  [253, 231, 37],
];

const COOLWARM: Rgb[] = [
  [59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249],
  [221, 221, 221], [245, 196, 173], [244, 154, 123], [222, 96, 77],
  [180, 4, 38],
];

function sample(table: Rgb[], t: number): Rgb {
  const x = Math.min(Math.max(t, 0), 1) * (table.length - 1);
  const i = Math.min(Math.floor(x), table.length - 2);
  const f = x - i;
  return [
    table[i][0] + f * (table[i + 1][0] - table[i][0]),
    table[i][1] + f * (table[i + 1][1] - table[i][1]),
    table[i][2] + f * (table[i + 1][2] - table[i][2]),
  ];
}

export function viridis(t: number): Rgb { return sample(VIRIDIS, t); }
export function coolwarm(t: number): Rgb { return sample(COOLWARM, t); }

/** Desenha uma barra de escala vertical num contexto 2D. */
export function drawColorbar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  min: number, max: number, label: string, diverging: boolean,
): void {
  for (let i = 0; i < h; i++) {
    const t = 1 - i / h;
    const [r, g, b] = diverging ? coolwarm(t) : viridis(t);
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(x, y + i, w, 1);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.fillStyle = '#fff';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const fmt = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
    if (a >= 10) return v.toFixed(0);
    if (a >= 0.01 || a === 0) return v.toFixed(2);
    return v.toExponential(1);
  };
  ctx.fillText(fmt(max), x + w + 4, y + 10);
  ctx.fillText(fmt(diverging ? (min + max) / 2 : (min + max) / 2), x + w + 4, y + h / 2 + 4);
  ctx.fillText(fmt(min), x + w + 4, y + h - 2);
  ctx.save();
  ctx.translate(x - 4, y + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(label, 0, 0);
  ctx.restore();
}
