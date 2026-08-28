/**
 * Gráficos em canvas puro (§5.5 e §6.3): perfil de pressão no tubo com a
 * reta teórica sobreposta, e as curvas da varredura (medido × analítico).
 */

export interface Series {
  label: string;
  color: string;
  pts: Array<[number, number]>;
  dashed?: boolean;
  marks?: boolean;
}

export function drawChart(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, w: number, h: number,
  series: Series[], title: string, xLabel: string, yLabel: string,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(12,14,20,0.88)';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w, h);

  const padL = 46, padR = 10, padT = 22, padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const s of series) {
    for (const [x, y] of s.pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    }
  }
  if (!(xMax > xMin)) { xMin = 0; xMax = 1; }
  if (!(yMax > yMin)) { yMin = 0; yMax = 1; }
  const ySpan = yMax - yMin || 1;
  yMin -= 0.08 * ySpan; yMax += 0.08 * ySpan;

  const toX = (x: number) => x0 + padL + ((x - xMin) / (xMax - xMin)) * plotW;
  const toY = (y: number) => y0 + padT + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  // eixos + grade
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.lineWidth = 1;
  for (let n = 0; n <= 4; n++) {
    const yv = yMin + (n / 4) * (yMax - yMin);
    const sy = toY(yv);
    ctx.beginPath();
    ctx.moveTo(x0 + padL, sy);
    ctx.lineTo(x0 + w - padR, sy);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(fmt(yv), x0 + padL - 4, sy + 3);
  }
  for (let n = 0; n <= 4; n++) {
    const xv = xMin + (n / 4) * (xMax - xMin);
    const sx = toX(xv);
    ctx.textAlign = 'center';
    ctx.fillText(fmt(xv), sx, y0 + h - padB + 14);
  }

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.beginPath();
    let first = true;
    for (const [x, y] of s.pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const sx = toX(x), sy = toY(y);
      if (first) { ctx.moveTo(sx, sy); first = false; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.marks) {
      for (const [x, y] of s.pts) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ctx.beginPath();
        ctx.arc(toX(x), toY(y), 2.6, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  // título, rótulos, legenda
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, x0 + padL, y0 + 14);
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(xLabel, x0 + padL + plotW / 2, y0 + h - 6);
  ctx.save();
  ctx.translate(x0 + 12, y0 + padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
  let lx = x0 + padL + 6;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, y0 + 18, 12, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'left';
    ctx.fillText(s.label, lx + 15, y0 + 22);
    lx += 15 + ctx.measureText(s.label).width + 12;
  }
  ctx.restore();
}

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return (v / 1000).toFixed(0) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  if (a === 0) return '0';
  return v.toFixed(2);
}
