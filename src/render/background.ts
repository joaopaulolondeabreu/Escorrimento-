/**
 * Cenário de fundo do modo cinematográfico: pintado uma vez por geometria/
 * câmera num canvas offscreen (céu de fim de tarde com nuvens, colinas,
 * brita, dormentes, trilho, leito do canal, tubo de aço com rebites e
 * ferrugem, reservatório). É este fundo que a água refrata no composite
 * (§5.1.5) — quanto mais rico, mais convincente a refração.
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

// RNG determinístico local (o cenário deve ser idêntico entre quadros)
function makeRnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Fundo NEUTRO (padrão): gradiente de estúdio + luz-chave suave — nada
 * compete com a água; a refração continua tendo o que distorcer (o
 * gradiente e o leito), que é o que faz a água "ler" como água.
 */
export function paintBackgroundNeutral(
  ctx: CanvasRenderingContext2D, cam: Camera2D, geo: GeometryInfo,
): void {
  const W = cam.viewW, H = cam.viewH;
  const toS = (x: number, y: number) => worldToScreen(cam, x, y);

  // Gradiente vertical frio e calmo
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#262b33');
  g.addColorStop(0.55, '#3a414b');
  g.addColorStop(1, '#2b3138');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Luz-chave suave no alto à direita (coerente com o especular da água)
  {
    const [kx, ky] = toS(geo.domainW * 0.85, geo.domainH * 0.82);
    const rg = ctx.createRadialGradient(kx, ky, 10, kx, ky, H * 0.7);
    rg.addColorStop(0, 'rgba(235,240,248,0.20)');
    rg.addColorStop(0.4, 'rgba(220,228,240,0.08)');
    rg.addColorStop(1, 'rgba(220,228,240,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }

  // Linha do nível d'água de referência (sutil, ajuda a leitura)
  {
    const [, yw] = toS(0, geo.waterDepth);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, yw, W, 1);
  }

  // Leito do canal: faixa escura discreta + subsolo quase preto
  {
    const [, yBed] = toS(0, 0);
    ctx.fillStyle = '#20262b';
    ctx.fillRect(0, yBed, W, Math.min(12, Math.max(0, H - yBed)));
    ctx.fillStyle = '#111417';
    ctx.fillRect(0, yBed + 12, W, Math.max(0, H - yBed - 12));
  }
}

/** Cenário ilustrativo completo (opcional — toggle "Cenário de fundo"). */
export function paintBackground(
  ctx: CanvasRenderingContext2D, cam: Camera2D, geo: GeometryInfo,
): void {
  const W = cam.viewW, H = cam.viewH;
  const toS = (x: number, y: number) => worldToScreen(cam, x, y);
  const rnd = makeRnd(987654);

  // ---- céu de fim de tarde (gradiente rico)
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#232f56');
  sky.addColorStop(0.35, '#5c5480');
  sky.addColorStop(0.62, '#b0728a');
  sky.addColorStop(0.8, '#e59a63');
  sky.addColorStop(1, '#f2b877');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // ---- sol baixo com halo quente
  const [sunX, sunY] = toS(geo.domainW * 0.85, geo.domainH * 0.82);
  {
    const rg = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 160);
    rg.addColorStop(0, 'rgba(255,244,214,1.0)');
    rg.addColorStop(0.12, 'rgba(255,225,160,0.9)');
    rg.addColorStop(0.35, 'rgba(255,190,110,0.35)');
    rg.addColorStop(1, 'rgba(255,180,110,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(sunX - 170, sunY - 170, 340, 340);
  }

  // ---- nuvens finas iluminadas por baixo
  for (let n = 0; n < 9; n++) {
    const cy = H * (0.08 + 0.45 * rnd());
    const cx = W * rnd();
    const cw = W * (0.12 + 0.25 * rnd());
    const chh = 6 + 14 * rnd();
    const warm = rnd();
    const grad = ctx.createLinearGradient(0, cy - chh, 0, cy + chh);
    grad.addColorStop(0, `rgba(${90 + warm * 60},${80 + warm * 40},${120 + warm * 10},0.0)`);
    grad.addColorStop(0.55, `rgba(${170 + warm * 70},${120 + warm * 60},${130 + warm * 30},0.35)`);
    grad.addColorStop(1, `rgba(${255},${190 + warm * 30},${140},0.18)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw, chh, 0, 0, 2 * Math.PI);
    ctx.fill();
  }

  // ---- colinas ao longe (duas camadas)
  {
    const [, yHor] = toS(0, geo.waterDepth + 0.35);
    ctx.fillStyle = 'rgba(58, 48, 82, 0.85)';
    ctx.beginPath();
    ctx.moveTo(0, yHor);
    for (let x = 0; x <= W; x += 24) {
      ctx.lineTo(x, yHor - 14 - 26 * Math.abs(Math.sin(x * 0.004 + 1.2)) - 12 * Math.sin(x * 0.013));
    }
    ctx.lineTo(W, yHor + 60);
    ctx.lineTo(0, yHor + 60);
    ctx.fill();
    ctx.fillStyle = 'rgba(44, 38, 60, 0.95)';
    ctx.beginPath();
    ctx.moveTo(0, yHor + 6);
    for (let x = 0; x <= W; x += 20) {
      ctx.lineTo(x, yHor + 4 - 16 * Math.abs(Math.sin(x * 0.006 + 4.0)));
    }
    ctx.lineTo(W, yHor + 80);
    ctx.lineTo(0, yHor + 80);
    ctx.fill();
  }

  // ---- faixa de lastro (brita) atrás do canal
  {
    const [, yTop] = toS(0, geo.waterDepth + 0.12);
    const grad = ctx.createLinearGradient(0, yTop, 0, H);
    grad.addColorStop(0, '#544840');
    grad.addColorStop(0.4, '#3c342c');
    grad.addColorStop(1, '#241f1a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, yTop, W, H - yTop);
    // pedras individuais com faces iluminadas pelo sol
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yTop, W, H - yTop);
    ctx.clip();
    for (let n = 0; n < 1400; n++) {
      const px = rnd() * W;
      const py = yTop + rnd() * (H - yTop);
      const r = 1.2 + rnd() * 3.2;
      const base = 52 + rnd() * 46;
      ctx.fillStyle = `rgb(${base + 8},${base * 0.93},${base * 0.82})`;
      ctx.beginPath();
      ctx.moveTo(px, py - r);
      ctx.lineTo(px + r * 0.9, py + r * 0.4);
      ctx.lineTo(px - r * 0.8, py + r * 0.5);
      ctx.fill();
      // face quente virada ao sol
      ctx.fillStyle = `rgba(${base + 70},${base + 34},${base * 0.9},0.5)`;
      ctx.beginPath();
      ctx.moveTo(px, py - r);
      ctx.lineTo(px + r * 0.9, py + r * 0.4);
      ctx.lineTo(px + r * 0.3, py + r * 0.1);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- dormentes e trilho de fundo
  {
    const [, yr] = toS(0, geo.waterDepth + 0.05);
    // dormentes de madeira
    const [x0] = toS(0, 0);
    const step = 0.62 * cam.scale;
    const sw = Math.max(8, 0.22 * cam.scale * 0.45);
    for (let x = ((x0 % step) + step) % step - step; x < W; x += step) {
      const wood = ctx.createLinearGradient(x, yr - 2, x + sw, yr + 8);
      wood.addColorStop(0, '#4a3424');
      wood.addColorStop(0.5, '#33241a');
      wood.addColorStop(1, '#241a12');
      ctx.fillStyle = wood;
      ctx.fillRect(x, yr - 2, sw, 9);
    }
    // trilho: alma escura + boleto com brilho especular
    ctx.fillStyle = '#3a3531';
    ctx.fillRect(0, yr - 5, W, 6);
    const rail = ctx.createLinearGradient(0, yr - 8, 0, yr - 2);
    rail.addColorStop(0, '#cfc4ae');
    rail.addColorStop(0.4, '#8d8276');
    rail.addColorStop(1, '#4e463f');
    ctx.fillStyle = rail;
    ctx.fillRect(0, yr - 8, W, 4);
  }

  // ---- leito do canal e subsolo
  {
    const [, yBed] = toS(0, 0);
    // faixa do leito com pedrisco escuro molhado
    const bed = ctx.createLinearGradient(0, yBed, 0, yBed + 14);
    bed.addColorStop(0, '#2b3f38');
    bed.addColorStop(1, '#1a2622');
    ctx.fillStyle = bed;
    ctx.fillRect(0, yBed, W, Math.min(14, Math.max(0, H - yBed)));
    ctx.fillStyle = '#14171b';
    ctx.fillRect(0, yBed + 14, W, Math.max(0, H - yBed - 14));
    // seixos do leito
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yBed, W, Math.min(14, Math.max(0, H - yBed)));
    ctx.clip();
    for (let n = 0; n < 300; n++) {
      const px = rnd() * W;
      const py = yBed + rnd() * 12;
      const r = 1 + rnd() * 2;
      const c = 40 + rnd() * 30;
      ctx.fillStyle = `rgba(${c * 0.8},${c},${c * 0.9},0.7)`;
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 0.7, 0, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Desenha o sólido (tubo + reservatório) com aparência de aço usado. */
export function paintSolids(
  ctx: CanvasRenderingContext2D, cam: Camera2D, geo: GeometryInfo,
  style: 'steel' | 'outline',
): void {
  const cell = cam.scale * geo.dx;
  const [ox, oy] = worldToScreen(cam, 0, 0);
  const mask = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < geo.nx && j < geo.ny && geo.solidMask[i + j * geo.nx] === 1;

  if (style === 'outline') {
    ctx.fillStyle = 'rgba(150,160,170,0.9)';
    for (let j = 0; j < geo.ny; j++) {
      for (let i = 0; i < geo.nx; i++) {
        if (!mask(i, j)) continue;
        const x = ox + i * geo.dx * cam.scale;
        const y = oy - (j + 1) * geo.dx * cam.scale;
        ctx.fillRect(x, y, cell + 1, cell + 1);
      }
    }
    return;
  }

  // Aço: gradiente frio com leve resposta ao pôr do sol
  const rnd = makeRnd(24601);
  const grad = ctx.createLinearGradient(0, 0, 0, cam.viewH);
  grad.addColorStop(0, '#6a6f78');
  grad.addColorStop(0.45, '#4a4f58');
  grad.addColorStop(1, '#2c3138');
  ctx.fillStyle = grad;
  for (let j = 0; j < geo.ny; j++) {
    for (let i = 0; i < geo.nx; i++) {
      if (!mask(i, j)) continue;
      const x = ox + i * geo.dx * cam.scale;
      const y = oy - (j + 1) * geo.dx * cam.scale;
      ctx.fillRect(x, y, cell + 1, cell + 1);
    }
  }
  // Realce quente nas bordas viradas ao sol (direita/topo) e sombra fria
  ctx.fillStyle = 'rgba(255,214,170,0.5)';
  for (let j = 0; j < geo.ny; j++) {
    for (let i = 0; i < geo.nx; i++) {
      if (!mask(i, j)) continue;
      const x = ox + i * geo.dx * cam.scale;
      const y = oy - (j + 1) * geo.dx * cam.scale;
      if (!mask(i, j + 1)) ctx.fillRect(x, y, cell + 1, 1.6);
      if (!mask(i + 1, j)) ctx.fillRect(x + cell - 0.6, y, 1.6, cell + 1);
    }
  }
  ctx.fillStyle = 'rgba(10,14,22,0.5)';
  for (let j = 0; j < geo.ny; j++) {
    for (let i = 0; i < geo.nx; i++) {
      if (!mask(i, j)) continue;
      const x = ox + i * geo.dx * cam.scale;
      const y = oy - (j + 1) * geo.dx * cam.scale;
      if (!mask(i, j - 1)) ctx.fillRect(x, y + cell - 0.6, cell + 1, 1.6);
      if (!mask(i - 1, j)) ctx.fillRect(x, y, 1.6, cell + 1);
    }
  }

  // Rebites ao longo do tubo vertical e escorrimentos de ferrugem
  {
    const [tx0] = worldToScreen(cam, geo.xTube - 0.02, 0);
    const [tx1] = worldToScreen(cam, geo.xTube + 0.02, 0);
    const [, yTop] = worldToScreen(cam, 0, geo.yA);
    const [, yBot] = worldToScreen(cam, 0, geo.mouthY1 + 0.2);
    const stepR = Math.max(10, 0.16 * cam.scale);
    for (let y = yTop + 8; y < yBot; y += stepR) {
      for (const x of [tx0, tx1]) {
        ctx.fillStyle = 'rgba(210,214,222,0.6)';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2, cell * 0.14), 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = 'rgba(20,24,30,0.4)';
        ctx.beginPath();
        ctx.arc(x + 0.7, y + 0.7, Math.max(0.8, cell * 0.1), 0, 2 * Math.PI);
        ctx.fill();
      }
      // ferrugem escorrida abaixo de alguns rebites
      if (rnd() < 0.5) {
        const rx = rnd() < 0.5 ? tx0 : tx1;
        const len = 6 + rnd() * 22;
        const rust = ctx.createLinearGradient(0, y, 0, y + len);
        rust.addColorStop(0, 'rgba(122,66,38,0.5)');
        rust.addColorStop(1, 'rgba(122,66,38,0)');
        ctx.fillStyle = rust;
        ctx.fillRect(rx - 1, y, 2.4, len);
      }
    }
  }
}
