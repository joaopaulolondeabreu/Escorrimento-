/**
 * Cenário de fundo do modo cinematográfico: pintado uma vez por geometria
 * num canvas offscreen (céu de fim de tarde, brita, dormentes, trilho,
 * leito do canal, tubo de aço e reservatório). É este fundo que a água
 * refrata no composite (§5.1.5).
 */

import type { GeometryInfo } from '../app/protocol';

export interface Camera2D {
  /** pixels por metro */
  scale: number;
  /** centro da vista em coordenadas de mundo [m] */
  cx: number;
  cy: number;
  viewW: number;
  viewH: number;
}

export function worldToScreen(cam: Camera2D, x: number, y: number): [number, number] {
  return [
    cam.viewW / 2 + (x - cam.cx) * cam.scale,
    cam.viewH / 2 - (y - cam.cy) * cam.scale,
  ];
}

/** Pinta o cenário completo no canvas (usado como textura de refração). */
export function paintBackground(
  ctx: CanvasRenderingContext2D, cam: Camera2D, geo: GeometryInfo,
): void {
  const W = cam.viewW, H = cam.viewH;
  const toS = (x: number, y: number) => worldToScreen(cam, x, y);

  // Céu de fim de tarde
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2c3e6b');
  sky.addColorStop(0.45, '#7a6a8f');
  sky.addColorStop(0.75, '#d98e5f');
  sky.addColorStop(1, '#e8b075');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Sol baixo
  {
    const [sx, sy] = toS(geo.domainW * 0.85, geo.domainH * 0.82);
    const rg = ctx.createRadialGradient(sx, sy, 2, sx, sy, 90);
    rg.addColorStop(0, 'rgba(255,236,190,0.95)');
    rg.addColorStop(0.35, 'rgba(255,200,120,0.35)');
    rg.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(sx - 100, sy - 100, 200, 200);
  }

  // Faixa de brita/lastro atrás do canal
  {
    const [, yTop] = toS(0, geo.waterDepth + 0.12);
    const grad = ctx.createLinearGradient(0, yTop, 0, H);
    grad.addColorStop(0, '#4a4038');
    grad.addColorStop(1, '#2c2620');
    ctx.fillStyle = grad;
    ctx.fillRect(0, yTop, W, H - yTop);
    // textura de brita (determinística)
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yTop, W, H - yTop);
    ctx.clip();
    for (let n = 0; n < 900; n++) {
      const px = rnd() * W;
      const py = yTop + rnd() * (H - yTop);
      const r = 1 + rnd() * 2.5;
      const c = 60 + rnd() * 50;
      ctx.fillStyle = `rgba(${c},${c * 0.92},${c * 0.8},0.5)`;
      ctx.fillRect(px, py, r, r * 0.8);
    }
    ctx.restore();
  }

  // Leito do canal (faixa fina) e subsolo neutro abaixo do domínio
  {
    const [, yBed] = toS(0, 0);
    ctx.fillStyle = '#233530';
    ctx.fillRect(0, yBed, W, Math.min(10, Math.max(0, H - yBed)));
    ctx.fillStyle = '#15181c';
    ctx.fillRect(0, yBed + 10, W, Math.max(0, H - yBed - 10));
  }

  // Trilho ao fundo (linha estilizada acima do canal, atrás do tubo)
  {
    const [, yr] = toS(0, geo.waterDepth + 0.05);
    ctx.fillStyle = '#5c5049';
    ctx.fillRect(0, yr - 2, W, 3);
    ctx.fillStyle = '#847467';
    ctx.fillRect(0, yr - 3, W, 1.2);
    // dormentes
    const [x0] = toS(0, 0);
    const step = 0.65 * cam.scale;
    for (let x = x0 % step; x < W; x += step) {
      ctx.fillStyle = 'rgba(46,36,28,0.85)';
      ctx.fillRect(x, yr - 1, 14 * (cam.scale / 160), 7 * (cam.scale / 160) + 3);
    }
  }
}

/** Desenha o sólido (tubo + reservatório) com aparência de aço. */
export function paintSolids(
  ctx: CanvasRenderingContext2D, cam: Camera2D, geo: GeometryInfo,
  style: 'steel' | 'outline',
): void {
  const cell = cam.scale * geo.dx;
  const [ox, oy] = worldToScreen(cam, 0, 0);
  const mask = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < geo.nx && j < geo.ny && geo.solidMask[i + j * geo.nx] === 1;

  if (style === 'steel') {
    // Aço escuro com gradiente vertical (contraste com o céu)
    const grad = ctx.createLinearGradient(0, 0, 0, cam.viewH);
    grad.addColorStop(0, '#565d66');
    grad.addColorStop(0.5, '#3d434b');
    grad.addColorStop(1, '#282d34');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = 'rgba(150,160,170,0.9)';
  }
  for (let j = 0; j < geo.ny; j++) {
    for (let i = 0; i < geo.nx; i++) {
      if (!mask(i, j)) continue;
      const x = ox + i * geo.dx * cam.scale;
      const y = oy - (j + 1) * geo.dx * cam.scale;
      ctx.fillRect(x, y, cell + 1, cell + 1);
    }
  }
  if (style === 'steel') {
    // Realce nas bordas expostas do metal (célula sólida com vizinho livre)
    ctx.fillStyle = 'rgba(215,220,228,0.55)';
    for (let j = 0; j < geo.ny; j++) {
      for (let i = 0; i < geo.nx; i++) {
        if (!mask(i, j)) continue;
        const x = ox + i * geo.dx * cam.scale;
        const y = oy - (j + 1) * geo.dx * cam.scale;
        if (!mask(i, j + 1)) ctx.fillRect(x, y, cell + 1, 1.5);
        if (!mask(i - 1, j)) ctx.fillRect(x, y, 1.5, cell + 1);
      }
    }
  }
}
