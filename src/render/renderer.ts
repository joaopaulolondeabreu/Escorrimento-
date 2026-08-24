/**
 * Renderizador 2D (WebGL2) com dois modos alternáveis (§5):
 *
 * CINEMATOGRÁFICO — pipeline de água em espaço de tela multi-pass:
 *   1. splat de momentos de velocidade das partículas (RGBA16F);
 *   2. blur bilateral separável — superfície lisa preservando silhuetas
 *      (§5.1.2: sem isto a água fica com cara de bolinhas);
 *   3. composição: normais pseudo-3D do campo de espessura + micro-
 *      ondulações procedurais advectadas, refração com dispersão cromática
 *      (n = 1.333), absorção Beer–Lambert por canal, subsuperfície,
 *      Fresnel–Schlick (F₀ = 0.02) contra céu procedural, especular GGX,
 *      espuma por variância local com textura rendada, spray cintilante,
 *      cáusticas de Worley no leito (§5.1.5–6);
 *   4. bloom (bright-pass + blur separável em meia resolução);
 *   5. pós final: ACES filmic, aberração cromática sutil, vinheta, grão
 *      (§5.3 — cada efeito com chave individual).
 *
 * CIENTÍFICO — campos coloridos com barra de escala, partículas, vetores,
 * traçadores (overlay 2D desenhado pela UI).
 *
 * Sem WebGL2 há um fallback Canvas2D funcional (§2).
 */

import { createProgram, createFbo, createQuad, Fbo } from './gl';
import { viridis, coolwarm } from './colormap';
import type { FrameMsg, GeometryInfo, FieldKind } from '../app/protocol';
import {
  Camera2D, paintBackground, paintBackgroundNeutral, paintSolids, worldToScreen,
} from './background';
import {
  FULLSCREEN_VS, SPLAT_VS, SPLAT_FS, BILATERAL_FS,
  WATER_COMPOSITE_FS, BRIGHT_FS, BLUR_FS, POST_FS,
} from './water-shaders';

export type RenderMode = 'cinematic' | 'scientific';

export interface PostOptions {
  aces: boolean;
  vignette: boolean;
  grain: boolean;
  foam: boolean;
  bloom: boolean;
  chroma: boolean;
}

export interface RenderOptions {
  mode: RenderMode;
  field: FieldKind;
  showParticles: boolean;
  post: PostOptions;
  /** Velocidade do trem (escala de espuma e deriva das ondulações). */
  vRef: number;
  /** Cenário ilustrativo (céu/colinas/brita). false = fundo neutro de
   *  estúdio que prioriza a leitura da água. */
  scenery: boolean;
}

const POINTS_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in float aSpeed;
uniform vec2 uCenter;
uniform vec2 uView;
uniform float uScale;
uniform float uPointPx;
uniform float uSpeedMax;
out float vT;
void main() {
  vec2 px = (aPos - uCenter) * uScale;
  gl_Position = vec4(2.0 * px / uView, 0.0, 1.0);
  gl_PointSize = uPointPx;
  vT = clamp(aSpeed / uSpeedMax, 0.0, 1.0);
}`;

const POINTS_FS = `#version 300 es
precision highp float;
uniform sampler2D uColormap;
in float vT;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  if (dot(d, d) > 1.0) discard;
  frag = vec4(texture(uColormap, vec2(vT, 0.5)).rgb, 0.9);
}`;

const TEXQUAD_VS = `#version 300 es
layout(location=0) in vec2 aClip;
uniform vec4 uWorldRect;
uniform vec2 uCenter;
uniform vec2 uView;
uniform float uScale;
out vec2 vUv;
void main() {
  // Triângulo estendido: t ∈ [0,2]; t = 0..1 mapeia o domínio, o excedente
  // é descartado no fragmento.
  vec2 t = aClip * 0.5 + 0.5;
  vUv = t;
  vec2 world = uWorldRect.xy + t * (uWorldRect.zw - uWorldRect.xy);
  vec2 px = (world - uCenter) * uScale;
  gl_Position = vec4(2.0 * px / uView, 0.0, 1.0);
}`;

const TEXQUAD_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 frag;
void main() {
  if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) discard;
  frag = texture(uTex, vUv);
}`;

export class Renderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  // programas
  private splatProg: WebGLProgram;
  private bilateralProg: WebGLProgram;
  private compositeProg: WebGLProgram;
  private brightProg: WebGLProgram;
  private blurProg: WebGLProgram;
  private postProg: WebGLProgram;
  private pointsProg: WebGLProgram;
  private texQuadProg: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  // FBOs do pipeline de água
  private moments: Fbo | null = null;
  private blurA: Fbo | null = null;
  private blurB: Fbo | null = null;
  private sceneFbo: Fbo | null = null;
  private bright: Fbo | null = null;
  private bloomA: Fbo | null = null;
  private bloomB: Fbo | null = null;
  // partículas
  private posBuf: WebGLBuffer;
  private speedBuf: WebGLBuffer;
  private particleVao: WebGLVertexArrayObject;
  // fundo / campo / colormap
  private bgCanvas: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private bgTex: WebGLTexture;
  private fieldTex: WebGLTexture;
  private cmapTex: WebGLTexture;
  private fieldPixels: Uint8Array | null = null;
  private bgDirty = true;
  private lastCamKey = '';
  readonly hasFloat: boolean;

  static create(canvas: HTMLCanvasElement): Renderer | null {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) return null;
    return new Renderer(canvas, gl);
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.hasFloat = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.splatProg = createProgram(gl, SPLAT_VS, SPLAT_FS);
    this.bilateralProg = createProgram(gl, FULLSCREEN_VS, BILATERAL_FS);
    this.compositeProg = createProgram(gl, FULLSCREEN_VS, WATER_COMPOSITE_FS);
    this.brightProg = createProgram(gl, FULLSCREEN_VS, BRIGHT_FS);
    this.blurProg = createProgram(gl, FULLSCREEN_VS, BLUR_FS);
    this.postProg = createProgram(gl, FULLSCREEN_VS, POST_FS);
    this.pointsProg = createProgram(gl, POINTS_VS, POINTS_FS);
    this.texQuadProg = createProgram(gl, TEXQUAD_VS, TEXQUAD_FS);
    this.quad = createQuad(gl);

    this.posBuf = gl.createBuffer()!;
    this.speedBuf = gl.createBuffer()!;
    this.particleVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.speedBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.bgCanvas = document.createElement('canvas');
    this.bgCtx = this.bgCanvas.getContext('2d')!;
    this.bgTex = gl.createTexture()!;
    this.fieldTex = gl.createTexture()!;
    this.cmapTex = gl.createTexture()!;
    const cmap = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = viridis(i / 255);
      cmap[4 * i] = r; cmap[4 * i + 1] = g; cmap[4 * i + 2] = b; cmap[4 * i + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.cmapTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, cmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  invalidateBackground(): void { this.bgDirty = true; }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.moments = null;
      this.bgDirty = true;
    }
  }

  private ensureFbos(): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    if (this.moments && this.moments.w === w && this.moments.h === h) return;
    const mk = (ww: number, hh: number) =>
      createFbo(gl, ww, hh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.moments = mk(w, h);
    this.blurA = mk(w, h);
    this.blurB = mk(w, h);
    this.sceneFbo = mk(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.bright = mk(hw, hh);
    this.bloomA = mk(hw, hh);
    this.bloomB = mk(hw, hh);
  }

  private updateBackground(cam: Camera2D, geo: GeometryInfo, scenery: boolean): void {
    const key = `${cam.scale.toFixed(2)}|${cam.cx.toFixed(3)}|${cam.cy.toFixed(3)}|${cam.viewW}x${cam.viewH}|${scenery ? 1 : 0}`;
    if (!this.bgDirty && key === this.lastCamKey) return;
    this.lastCamKey = key;
    this.bgDirty = false;
    this.bgCanvas.width = cam.viewW;
    this.bgCanvas.height = cam.viewH;
    if (scenery) paintBackground(this.bgCtx, cam, geo);
    else paintBackgroundNeutral(this.bgCtx, cam, geo);
    paintSolids(this.bgCtx, cam, geo, 'steel');
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.bgCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private uni(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(prog, name);
  }

  private drawQuad(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private bindTex(unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  render(frame: FrameMsg, geo: GeometryInfo, cam: Camera2D, opts: RenderOptions): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, frame.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.speedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, frame.speeds, gl.DYNAMIC_DRAW);

    if (opts.mode === 'cinematic' && this.hasFloat) {
      this.renderWater(frame, geo, cam, opts);
      return;
    }
    this.renderScientific(frame, geo, cam, opts);
  }

  // ------------------------------------------------------- água realista

  private renderWater(frame: FrameMsg, geo: GeometryInfo, cam: Camera2D, opts: RenderOptions): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    this.updateBackground(cam, geo, opts.scenery);
    this.ensureFbos();

    // 1) splat de momentos
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.moments!.fb);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.splatProg);
    gl.uniform2f(this.uni(this.splatProg, 'uCenter'), cam.cx, cam.cy);
    gl.uniform2f(this.uni(this.splatProg, 'uView'), w, h);
    gl.uniform1f(this.uni(this.splatProg, 'uScale'), cam.scale);
    gl.uniform1f(this.uni(this.splatProg, 'uRadiusPx'), Math.max(2, 1.5 * geo.dx * cam.scale));
    gl.bindVertexArray(this.particleVao);
    gl.drawArrays(gl.POINTS, 0, frame.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // 2) blur bilateral separável (H depois V)
    const radius = Math.max(3, 0.9 * geo.dx * cam.scale);
    gl.useProgram(this.bilateralProg);
    gl.uniform2f(this.uni(this.bilateralProg, 'uView'), w, h);
    gl.uniform1f(this.uni(this.bilateralProg, 'uRadius'), radius);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurA!.fb);
    this.bindTex(0, this.moments!.tex);
    gl.uniform1i(this.uni(this.bilateralProg, 'uTex'), 0);
    gl.uniform2f(this.uni(this.bilateralProg, 'uDir'), 1, 0);
    this.drawQuad();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurB!.fb);
    this.bindTex(0, this.blurA!.tex);
    gl.uniform2f(this.uni(this.bilateralProg, 'uDir'), 0, 1);
    this.drawQuad();

    // 3) composição da água
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo!.fb);
    gl.useProgram(this.compositeProg);
    this.bindTex(0, this.blurB!.tex);
    gl.uniform1i(this.uni(this.compositeProg, 'uDensity'), 0);
    this.bindTex(1, this.moments!.tex);
    gl.uniform1i(this.uni(this.compositeProg, 'uDensityRaw'), 1);
    this.bindTex(2, this.bgTex);
    gl.uniform1i(this.uni(this.compositeProg, 'uBackground'), 2);
    gl.uniform2f(this.uni(this.compositeProg, 'uView'), w, h);
    gl.uniform1f(this.uni(this.compositeProg, 'uTime'), frame.time);
    gl.uniform1f(this.uni(this.compositeProg, 'uVref'), opts.vRef);
    gl.uniform1f(this.uni(this.compositeProg, 'uPxPerMeter'), cam.scale);
    gl.uniform1i(this.uni(this.compositeProg, 'uFoam'), opts.post.foam ? 1 : 0);
    gl.uniform1i(this.uni(this.compositeProg, 'uScenery'), opts.scenery ? 1 : 0);
    // sol na tela (uv, origem embaixo) — coerente com o fundo pintado
    {
      const [sx, sy] = worldToScreen(cam, geo.domainW * 0.85, geo.domainH * 0.82);
      gl.uniform2f(this.uni(this.compositeProg, 'uSunUv'), sx / w, 1 - sy / h);
    }
    // deriva das micro-ondulações: a água se move a −V no referencial do trem
    gl.uniform2f(this.uni(this.compositeProg, 'uFlowDir'), -opts.vRef, 0);
    this.drawQuad();

    // 4) bloom
    if (opts.post.bloom) {
      const hw = this.bright!.w, hh = this.bright!.h;
      gl.viewport(0, 0, hw, hh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bright!.fb);
      gl.useProgram(this.brightProg);
      this.bindTex(0, this.sceneFbo!.tex);
      gl.uniform1i(this.uni(this.brightProg, 'uTex'), 0);
      gl.uniform2f(this.uni(this.brightProg, 'uView'), hw, hh);
      this.drawQuad();

      gl.useProgram(this.blurProg);
      gl.uniform2f(this.uni(this.blurProg, 'uView'), hw, hh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA!.fb);
      this.bindTex(0, this.bright!.tex);
      gl.uniform1i(this.uni(this.blurProg, 'uTex'), 0);
      gl.uniform2f(this.uni(this.blurProg, 'uDir'), 1, 0);
      this.drawQuad();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB!.fb);
      this.bindTex(0, this.bloomA!.tex);
      gl.uniform2f(this.uni(this.blurProg, 'uDir'), 0, 1);
      this.drawQuad();
      gl.viewport(0, 0, w, h);
    }

    // 5) pós final para a tela
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.postProg);
    this.bindTex(0, this.sceneFbo!.tex);
    gl.uniform1i(this.uni(this.postProg, 'uScene'), 0);
    this.bindTex(1, (opts.post.bloom ? this.bloomB! : this.sceneFbo!).tex);
    gl.uniform1i(this.uni(this.postProg, 'uBloom'), 1);
    gl.uniform2f(this.uni(this.postProg, 'uView'), w, h);
    gl.uniform1f(this.uni(this.postProg, 'uTime'), frame.time);
    gl.uniform1i(this.uni(this.postProg, 'uAces'), opts.post.aces ? 1 : 0);
    gl.uniform1i(this.uni(this.postProg, 'uVignette'), opts.post.vignette ? 1 : 0);
    gl.uniform1i(this.uni(this.postProg, 'uGrain'), opts.post.grain ? 1 : 0);
    gl.uniform1i(this.uni(this.postProg, 'uBloomOn'), opts.post.bloom ? 1 : 0);
    gl.uniform1i(this.uni(this.postProg, 'uChroma'), opts.post.chroma ? 1 : 0);
    this.drawQuad();
  }

  // ------------------------------------------------------ modo científico

  private uploadField(frame: FrameMsg, geo: GeometryInfo, kind: FieldKind): void {
    const { nx, ny } = geo;
    const n = nx * ny;
    if (!this.fieldPixels || this.fieldPixels.length !== n * 4) {
      this.fieldPixels = new Uint8Array(n * 4);
    }
    const px = this.fieldPixels;
    const f = frame.field!;
    const diverging = kind === 'vorticity' || kind === 'divergence';
    let lo = frame.fieldMin, hi = frame.fieldMax;
    if (diverging) {
      const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-12);
      lo = -m; hi = m;
    }
    const span = hi - lo || 1;
    for (let k = 0; k < n; k++) {
      const v = f[k];
      const o = 4 * k;
      if (Number.isNaN(v)) {
        if (geo.solidMask[k]) {
          px[o] = 70; px[o + 1] = 74; px[o + 2] = 80; px[o + 3] = 255;
        } else {
          px[o] = 18; px[o + 1] = 20; px[o + 2] = 26; px[o + 3] = 255;
        }
      } else {
        const t = (v - lo) / span;
        const [r, g, b] = diverging ? coolwarm(t) : viridis(t);
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nx, ny, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private renderScientific(frame: FrameMsg, geo: GeometryInfo, cam: Camera2D, opts: RenderOptions): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.07, 0.08, 0.10, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (frame.field) {
      this.uploadField(frame, geo, opts.field);
      gl.useProgram(this.texQuadProg);
      this.bindTex(0, this.fieldTex);
      gl.uniform1i(this.uni(this.texQuadProg, 'uTex'), 0);
      gl.uniform4f(this.uni(this.texQuadProg, 'uWorldRect'), 0, 0, geo.domainW, geo.domainH);
      gl.uniform2f(this.uni(this.texQuadProg, 'uCenter'), cam.cx, cam.cy);
      gl.uniform2f(this.uni(this.texQuadProg, 'uView'), w, h);
      gl.uniform1f(this.uni(this.texQuadProg, 'uScale'), cam.scale);
      this.drawQuad();
    }

    if (opts.showParticles || !frame.field) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.pointsProg);
      gl.uniform2f(this.uni(this.pointsProg, 'uCenter'), cam.cx, cam.cy);
      gl.uniform2f(this.uni(this.pointsProg, 'uView'), w, h);
      gl.uniform1f(this.uni(this.pointsProg, 'uScale'), cam.scale);
      gl.uniform1f(this.uni(this.pointsProg, 'uPointPx'), Math.max(1.5, 0.6 * geo.dx * cam.scale));
      gl.uniform1f(this.uni(this.pointsProg, 'uSpeedMax'), 12);
      this.bindTex(0, this.cmapTex);
      gl.uniform1i(this.uni(this.pointsProg, 'uColormap'), 0);
      gl.bindVertexArray(this.particleVao);
      gl.drawArrays(gl.POINTS, 0, frame.count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
  }
}

// --------------------------------------------------------------- fallback

/** Fallback Canvas2D (funcional, visual simplificado — §2). */
export class Fallback2D {
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }
  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }
  render(frame: FrameMsg, geo: GeometryInfo, cam: Camera2D, opts: RenderOptions): void {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.fillStyle = '#12141a';
    ctx.fillRect(0, 0, w, h);
    paintSolids(ctx, cam, geo, 'outline');
    const cine = opts.mode === 'cinematic';
    for (let k = 0; k < frame.count; k++) {
      const [sx, sy] = worldToScreen(cam, frame.positions[2 * k], frame.positions[2 * k + 1]);
      if (sx < -2 || sx > w + 2 || sy < -2 || sy > h + 2) continue;
      if (cine) {
        ctx.fillStyle = '#5ab4d6';
      } else {
        const t = Math.min(frame.speeds[k] / 12, 1);
        const [r, g, b] = viridis(t);
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      }
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
  }
}
