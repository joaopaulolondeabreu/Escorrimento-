/**
 * Aplicação principal: detecção de capacidades, worker da simulação,
 * renderização, câmeras, HUD, gráficos, varredura e gravação de vídeo.
 * Toda a interface em português brasileiro (§10).
 */

import { defaultIntakeParams, IntakeParams } from './solver/intake2d';
import { defaultParams2D } from './solver/solver2d';
import type {
  WorkerToMain, MainToWorker, FrameMsg, GeometryInfo, SweepPoint,
} from './app/protocol';
import { Renderer, Fallback2D } from './render/renderer';
import { Camera2D, worldToScreen } from './render/background';
import { drawColorbar } from './render/colormap';
import { Panel, PanelState } from './ui/panel';
import { Hud } from './ui/hud';
import { drawChart, Series } from './ui/charts';
import { sweepToCsv, downloadText } from './physics/csv';
import {
  tubeVelocity, captureFraction, G_STANDARD, RHO_WATER, powerCoefficients,
} from './physics/analytic';

// ------------------------------------------------------------- capacidades

const glCanvas = document.getElementById('tela') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const overlayCtx = overlay.getContext('2d')!;
const avisos = document.getElementById('avisos')!;

const renderer = Renderer.create(glCanvas);
const fallback = renderer ? null : new Fallback2D(glCanvas);

if (!renderer) {
  avisos.innerHTML = `
    <div class="aviso-caixa">
      <strong>Seu navegador não tem WebGL2.</strong><br>
      A simulação vai funcionar com visual simplificado. Para a experiência
      completa, use uma versão recente do Chrome, Edge ou Firefox.
    </div>`;
} else if (!('gpu' in navigator)) {
  avisos.innerHTML = `
    <div class="aviso-caixa aviso-info">
      Seu navegador não expõe WebGPU — sem problema: esta versão do
      simulador executa o solver na CPU e renderiza com WebGL2
      (ver README, seção "Limitações e decisões de engenharia").
    </div>`;
  setTimeout(() => { avisos.innerHTML = ''; }, 9000);
}

// ------------------------------------------------------------------ estado

const state: PanelState = {
  V: 8.0, H: 1.0, D: 0.25,
  waterDepth: 0.30, mouthDepth: 0.15,
  nuMult: 1, smagorinskyCs: 0.12, flipAlpha: 0.95,
  nx: 192, particlesPerCell: 4,
  noSlip: false, drain: false, tallDomain: false,
  timeScale: 1.0,
  mode: 'cinematic', field: 'speed',
  showParticles: true, showVectors: false, showTracers: true,
  aces: true, vignette: true, grain: true, foam: true,
  bloom: true, chroma: true,
  scenery: false,
};

let geometry: GeometryInfo | null = null;
let lastFrame: FrameMsg | null = null;
let framePending = false;
let sweepPoints: SweepPoint[] = [];
let sweepBusy = false;
let sweepProgressText = '';
let showSweepPanel = false;

const cam: Camera2D = { scale: 150, cx: 3, cy: 1.1, viewW: 800, viewH: 600 };
let camPreset = 'corte';

function intakeFromState(): IntakeParams {
  const p = defaultIntakeParams();
  p.V = state.V; p.H = state.H; p.D = state.D;
  p.waterDepth = state.waterDepth;
  p.mouthDepth = state.mouthDepth;
  p.drain = state.drain;
  p.domainH = state.tallDomain ? 3.2 : 2.25;
  return p;
}

function solverFromState(): Record<string, unknown> {
  return {
    nuMultiplier: state.nuMult,
    smagorinskyCs: state.smagorinskyCs,
    flipAlpha: state.flipAlpha,
    noSlip: state.noSlip,
    particlesPerCell: state.particlesPerCell,
    bedU: -state.V,
  };
}

// ------------------------------------------------------------------ worker

const worker = new Worker(new URL('./app/worker.ts', import.meta.url), { type: 'module' });
const send = (msg: MainToWorker) => worker.postMessage(msg);

worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
  const msg = ev.data;
  if (msg.type === 'ready') {
    geometry = msg.geometry;
    renderer?.invalidateBackground();
    hud.reset();
    applyCameraPreset(camPreset);
  } else if (msg.type === 'frame') {
    lastFrame = msg;
    framePending = false;
  } else if (msg.type === 'sweepProgress') {
    sweepPoints = msg.points;
    sweepBusy = !msg.finished;
    showSweepPanel = true;
    sweepProgressText = msg.finished
      ? `Varredura concluída (${msg.points.length} pontos).`
      : `Varredura: V = ${msg.currentV.toFixed(1)} m/s (${msg.done}/${msg.total})…`;
  }
};

send({ type: 'init', nx: state.nx, intake: intakeFromState(), solver: solverFromState() });
send({ type: 'run', running: true });

// -------------------------------------------------------------------- HUD

const hud = new Hud(document.getElementById('hud')!);

// ------------------------------------------------------------------ painel

const panel = new Panel(document.getElementById('painel')!, state, {
  onLight: () => {
    send({
      type: 'setParams', rebuild: false,
      intake: { V: state.V },
      solver: solverFromState(),
    });
    send({ type: 'speed', timeScale: state.timeScale });
  },
  onRebuild: () => {
    send({
      type: 'setParams', rebuild: true, nx: state.nx,
      intake: intakeFromState(), solver: solverFromState(),
    });
  },
  onRun: (running) => send({ type: 'run', running }),
  onStep: () => send({ type: 'singleStep' }),
  onReset: () => { hud.reset(); send({ type: 'reset' }); },
  onCamera: (preset) => applyCameraPreset(preset),
  onSweep: () => {
    if (sweepBusy) {
      send({ type: 'sweepCancel' });
      sweepBusy = false;
      sweepProgressText = 'Varredura cancelada.';
      return;
    }
    const vs: number[] = [];
    for (let v = 4.5; v <= 16.01; v += 1.5) vs.push(Number(v.toFixed(1)));
    sweepPoints = [];
    send({ type: 'sweep', vValues: vs, settleTime: 2.0, measureTime: 1.5 });
  },
  onCsv: () => {
    if (sweepPoints.length === 0) {
      sweepProgressText = 'Rode a varredura antes de exportar.';
      showSweepPanel = true;
      return;
    }
    downloadText('varredura.csv', sweepToCsv(
      sweepPoints, state.H, state.D, RHO_WATER,
      geometry ? Math.max(0, geometry.waterDepth - geometry.yC) : 0,
    ));
  },
  onRecord: () => toggleRecording(),
});

// ------------------------------------------------------------------ câmera

function applyCameraPreset(preset: string): void {
  camPreset = preset;
  if (!geometry) return;
  const g = geometry;
  switch (preset) {
    case 'corte':
      cam.scale = Math.min(cam.viewW / g.domainW, cam.viewH / g.domainH) * 0.96;
      cam.cx = g.domainW / 2;
      cam.cy = g.domainH / 2;
      break;
    case 'bocaC':
      cam.scale = cam.viewH / 1.1;
      cam.cx = g.xC + 0.1;
      cam.cy = g.yC + 0.1;
      break;
    case 'tubo':
      cam.scale = cam.viewH / (g.yA - g.yC + 1.0);
      cam.cx = g.xTube + 0.3;
      cam.cy = (g.yC + g.yA) / 2 + 0.2;
      break;
    case 'reservatorio':
      cam.scale = cam.viewH / 2.0;
      cam.cx = g.xTube;
      cam.cy = g.resFloorY + 0.55;
      break;
  }
  renderer?.invalidateBackground();
}

let dragging = false;
let dragStart: [number, number] | null = null;
overlay.addEventListener('mousedown', (e) => {
  dragging = true;
  dragStart = [e.clientX, e.clientY];
});
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (!dragging || !dragStart) return;
  camPreset = 'livre';
  cam.cx -= (e.clientX - dragStart[0]) / cam.scale;
  cam.cy += (e.clientY - dragStart[1]) / cam.scale;
  dragStart = [e.clientX, e.clientY];
  renderer?.invalidateBackground();
});
overlay.addEventListener('wheel', (e) => {
  e.preventDefault();
  camPreset = 'livre';
  const f = Math.exp(-e.deltaY * 0.0012);
  cam.scale = Math.min(2000, Math.max(30, cam.scale * f));
  renderer?.invalidateBackground();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'm' || e.key === 'M') {
    state.mode = state.mode === 'cinematic' ? 'scientific' : 'cinematic';
  } else if (e.key === ' ') {
    e.preventDefault();
    (document.querySelector('#painel button') as HTMLButtonElement)?.click();
  } else if (e.key === '.') {
    send({ type: 'singleStep' });
  }
});

// --------------------------------------------------------------- gravação

let recorder: MediaRecorder | null = null;
let recordCanvas: HTMLCanvasElement | null = null;
let recordCtx: CanvasRenderingContext2D | null = null;
let recordChunks: Blob[] = [];

function toggleRecording(): void {
  if (recorder) {
    recorder.stop();
    return;
  }
  recordCanvas = document.createElement('canvas');
  recordCanvas.width = glCanvas.width;
  recordCanvas.height = glCanvas.height;
  recordCtx = recordCanvas.getContext('2d')!;
  const stream = recordCanvas.captureStream(30);
  recordChunks = [];
  try {
    recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
  } catch {
    recorder = new MediaRecorder(stream);
  }
  recorder.ondataavailable = (e) => { if (e.data.size) recordChunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(recordChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'simulacao.webm';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    recorder = null;
    recordCanvas = null;
    panel.setRecording(false);
  };
  recorder.start();
  panel.setRecording(true);
}

// --------------------------------------------------------------- overlay

function drawOverlay(frame: FrameMsg): void {
  const ctx = overlayCtx;
  const W = overlay.width, H = overlay.height;
  ctx.clearRect(0, 0, W, H);
  if (!geometry) return;

  const sci = state.mode === 'scientific';

  if (sci && frame.field) {
    const diverging = state.field === 'vorticity' || state.field === 'divergence';
    let lo = frame.fieldMin, hi = frame.fieldMax;
    if (diverging) {
      const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-12);
      lo = -m; hi = m;
    }
    const labels: Record<string, string> = {
      speed: '|u| [m/s]', pressure: 'P − P₀ [Pa]',
      vorticity: 'ω [1/s]', divergence: '∇·u [1/s]',
    };
    drawColorbar(ctx, 16, 60, 14, 180, lo, hi, labels[state.field], diverging);
  }

  // Vetores de velocidade
  if (sci && state.showVectors && frame.vectors) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    const vs = frame.vectors;
    const k = 0.06; // s — comprimento do vetor = u·k
    for (let i = 0; i < vs.length; i += 4) {
      const [sx, sy] = worldToScreen(cam, vs[i], vs[i + 1]);
      const ex = sx + vs[i + 2] * k * cam.scale;
      const ey = sy - vs[i + 3] * k * cam.scale;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(ex - 1, ey - 1, 2, 2);
    }
  }

  // Traçadores do tubo de corrente capturado
  if (sci && state.showTracers && frame.tracers) {
    for (const t of frame.tracers) {
      ctx.strokeStyle = t.captured ? 'rgba(255,200,60,0.95)' : 'rgba(120,170,220,0.4)';
      ctx.lineWidth = t.captured ? 1.8 : 1;
      ctx.beginPath();
      for (let i = 0; i < t.pts.length; i += 2) {
        const [sx, sy] = worldToScreen(cam, t.pts[i], t.pts[i + 1]);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,200,60,0.95)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('dourado = capturado pelo tubo (materializa A_c)', 16, H - 12);
  }

  // Perfil de pressão no tubo vs reta teórica P(z) = P₀ + ρg(H − z)
  // (oculto enquanto o painel da varredura ocupa a lateral direita)
  if (sci && frame.tubeProfile && frame.tubeProfile.length >= 4 && !showSweepPanel) {
    const med: Array<[number, number]> = [];
    for (let i = 0; i < frame.tubeProfile.length; i += 2) {
      med.push([frame.tubeProfile[i + 1] / 1000, frame.tubeProfile[i]]);
    }
    const teo: Array<[number, number]> = [];
    for (let z = 0; z <= state.H; z += state.H / 20) {
      teo.push([RHO_WATER * G_STANDARD * (state.H - z) / 1000, z]);
    }
    drawChart(ctx, W - 280, H - 220, 264, 204,
      [
        { label: 'medido', color: '#6cc5f0', pts: med, marks: true },
        { label: 'teoria ρg(H−z)', color: '#ffc83c', pts: teo, dashed: true },
      ],
      'Pressão no eixo do tubo', 'P − P₀ [kPa]', 'z acima do canal [m]');
  }

  // Painel da varredura
  if (showSweepPanel) {
    drawSweepPanel(ctx, W, H);
  }

  // Barra de status
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, 26);
  ctx.fillStyle = '#dfe6ee';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const modeName = sci ? 'CIENTÍFICO' : 'CINEMATOGRÁFICO';
  ctx.fillText(
    `t = ${frame.time.toFixed(2)} s · modo ${modeName} (tecla M) · câmera: ${camPreset} · ${sweepProgressText}`,
    10, 17,
  );
}

function drawSweepPanel(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const pw = Math.min(330, W * 0.4);
  const ph = 160;
  const x = W - pw - 10;
  let y = 34;

  const mk = (
    title: string, yLab: string,
    getMed: (p: SweepPoint) => number, getTeo: (V: number) => number,
    xIsPhi = false,
  ) => {
    const med: Array<[number, number]> = sweepPoints.map((p) => [
      xIsPhi ? p.flux : p.V, getMed(p),
    ]);
    const teo: Array<[number, number]> = [];
    for (let V = 4.5; V <= 16.01; V += 0.25) {
      teo.push([xIsPhi ? state.D * tubeVelocity(V, state.H) : V, getTeo(V)]);
    }
    drawChart(ctx, x, y, pw, ph,
      [
        { label: 'medido', color: '#6cc5f0', pts: med, marks: true },
        { label: 'teoria', color: '#ffc83c', pts: teo, dashed: true },
      ],
      title, xIsPhi ? 'φ [m²/s]' : 'V [m/s]', yLab);
    y += ph + 8;
  };

  mk('v no bocal', 'v [m/s]', (p) => p.vNozzle, (V) => tubeVelocity(V, state.H));
  mk('Vazão por largura', 'φ [m²/s]', (p) => p.flux, (V) => state.D * tubeVelocity(V, state.H));
  // Teoria de P_C avaliada na posição da sonda: ρg(H + d_C), com d_C a
  // submersão da sonda — a INDEPENDÊNCIA DE V (reta horizontal) é o teste
  const dC = geometry ? Math.max(0, geometry.waterDepth - geometry.yC) : 0;
  mk('P_C − P₀ na sonda (reta: ρg(H+d_C))', 'kPa',
    (p) => p.overpressureC / 1000, () => RHO_WATER * G_STANDARD * (state.H + dC) / 1000);
  mk('Fração captada', 'A_c/A', (p) => p.captureFraction, (V) => captureFraction(V, state.H));
  {
    const { c1, c2 } = powerCoefficients({ V: 0, H: state.H, A: state.D, rho: RHO_WATER, g: G_STANDARD });
    mk('Potência vs vazão', 'Π [kW/m]', (p) => Math.abs(p.power) / 1000,
      (V) => {
        const phi = state.D * tubeVelocity(V, state.H);
        return (c1 * phi ** 3 + c2 * phi) / 1000;
      }, true);
  }
}

// --------------------------------------------------------------- loop

function resize(): void {
  const wrap = document.getElementById('tela-wrap')!;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  cam.viewW = w; cam.viewH = h;
  renderer?.resize(w, h);
  fallback?.resize(w, h);
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
}
window.addEventListener('resize', resize);

function tick(): void {
  resize();
  if (!framePending) {
    framePending = true;
    send({
      type: 'requestFrame',
      wantFields: state.mode === 'scientific',
      field: state.field,
      wantTracers: state.mode === 'scientific' && state.showTracers,
    });
  }
  if (lastFrame && geometry) {
    const opts = {
      mode: state.mode,
      field: state.field,
      showParticles: state.showParticles,
      post: {
        aces: state.aces, vignette: state.vignette,
        grain: state.grain, foam: state.foam,
        bloom: state.bloom, chroma: state.chroma,
      },
      vRef: state.V,
      scenery: state.scenery,
    } as const;
    renderer?.render(lastFrame, geometry, cam, opts);
    fallback?.render(lastFrame, geometry, cam, opts);
    drawOverlay(lastFrame);
    hud.update(lastFrame, intakeFromState(), RHO_WATER, geometry);

    if (recorder && recordCtx && recordCanvas) {
      if (recordCanvas.width !== glCanvas.width || recordCanvas.height !== glCanvas.height) {
        recordCanvas.width = glCanvas.width;
        recordCanvas.height = glCanvas.height;
      }
      recordCtx.drawImage(glCanvas, 0, 0);
      recordCtx.drawImage(overlay, 0, 0);
    }
  }
  requestAnimationFrame(tick);
}
resize();
requestAnimationFrame(tick);
