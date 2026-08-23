/**
 * Renderizador 2D (WebGL2) com dois modos alternáveis (§5):
 *
 * CINEMATOGRÁFICO — água em espaço de tela: as partículas são "splatadas"
 * como gaussianas num buffer de densidade+velocidade (float); um passo de
 * composição reconstrói superfície e normais do gradiente de densidade e
 * sombreia com refração do cenário de fundo, absorção Beer–Lambert por
 * canal, reflexo tipo Fresnel, especular do sol, espuma e spray por
 * critério físico (velocidade local × faixa de densidade), e finaliza com
 * tonemapping ACES, vinheta e grão sutil (§5.3, chaves individuais).
 * NOTA HONESTA: este é um pipeline 2D estilizado do corte longitudinal —
 * o pipeline 3D completo (blur bilateral de profundidade, cáusticas,
 * sombras em cascata) fica documentado como não implementado no README.
 *
 * CIENTÍFICO — campos coloridos com barra de escala, partículas, vetores,
 * linhas de corrente/traçadores (desenhados no overlay 2D pela UI).
 *
 * Se WebGL2 não estiver disponível, há um fallback Canvas2D funcional.
 */

import { createProgram, createFbo, createQuad, Fbo } from './gl';
import { viridis, coolwarm } from './colormap';
import type { FrameMsg, GeometryInfo, FieldKind } from '../app/protocol';
import { Camera2D, paintBackground, paintSolids, worldToScreen } from './background';

export type RenderMode = 'cinematic' | 'scientific';

export interface PostOptions {
  aces: boolean;
  vignette: boolean;
  grain: boolean;
  foam: boolean;
}

export interface RenderOptions {
  mode: RenderMode;
  field: FieldKind;
  showParticles: boolean;
  post: PostOptions;
  /** Velocidade do trem (escala dos limiares de espuma). */
  vRef: number;
}

// ------------------------------------------------------------- shaders

const SPLAT_VS = `#version 300 es
layout(location=0) in vec2 aPos;    // posição no mundo [m]
layout(location=1) in float aSpeed; // |u| da partícula
uniform vec2 uCenter;   // centro da câmera [m]
uniform vec2 uView;     // tamanho da vista [px]
uniform float uScale;   // px por metro
uniform float uRadiusPx;
out float vSpeed;
void main() {
  vec2 px = (aPos - uCenter) * uScale;
  gl_Position = vec4(2.0 * px / uView, 0.0, 1.0);
  gl_PointSize = uRadiusPx * 2.0;
  vSpeed = aSpeed;
}`;

const SPLAT_FS = `#version 300 es
precision highp float;
in float vSpeed;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float w = exp(-2.6 * r2) - exp(-2.6);
  // Momentos da velocidade: densidade, 1º e 2º momento — o composite usa
  // a VARIÂNCIA local (churn) como critério físico de espuma (§5.1.6),
  // que é invariante ao referencial (canal calmo ≠ frente turbulenta).
  frag = vec4(w, w * vSpeed, w * vSpeed * vSpeed, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uDensity;   // R = densidade, G = densidade*|u|
uniform sampler2D uBackground;
uniform vec2 uView;
uniform float uTime;
uniform bool uAces;
uniform bool uVignette;
uniform bool uGrain;
uniform bool uFoam;
uniform float uVref;   // velocidade do trem: escala dos limiares de espuma
out vec4 frag;

vec3 aces(vec3 x) {
  return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uView;      // origem embaixo (GL)
  vec2 uvBg = vec2(uv.x, 1.0 - uv.y);     // canvas de fundo: origem em cima
  vec2 texel = 1.0 / uView;

  vec4 mom = texture(uDensity, uv);
  float D = mom.r;
  float G = mom.g;
  float B = mom.b;

  // Normal em espaço de tela a partir do gradiente de densidade
  float dR = texture(uDensity, uv + vec2(texel.x, 0.0)).r;
  float dL = texture(uDensity, uv - vec2(texel.x, 0.0)).r;
  float dT = texture(uDensity, uv + vec2(0.0, texel.y)).r;
  float dB = texture(uDensity, uv - vec2(0.0, texel.y)).r;
  vec2 grad = vec2(dR - dL, dT - dB);

  float surf = smoothstep(0.35, 0.75, D);   // máscara da água
  float edge = smoothstep(0.35, 0.9, D) * (1.0 - smoothstep(0.9, 1.8, D));

  // Refração: desloca o fundo proporcional à normal e à espessura (n=1.333)
  vec2 refr = -grad * 9.0 * clamp(D, 0.0, 2.5);
  vec3 bg = texture(uBackground, uvBg + refr * surf * vec2(1.0, -1.0)).rgb;

  // Absorção Beer–Lambert por canal: σ ≈ (0.45, 0.12, 0.08) m⁻¹ (§5.1.5)
  float depth = clamp(D * 1.4, 0.0, 7.0);
  vec3 T = exp(-vec3(0.50, 0.14, 0.09) * depth * 2.2);
  vec3 waterTint = vec3(0.05, 0.22, 0.28);
  vec3 water = bg * T + waterTint * (1.0 - T);

  // Fresnel de borda (reflexo do céu nas cristas) + especular do sol
  float fres = pow(clamp(length(grad) * 4.0, 0.0, 1.0), 3.0);
  vec3 skyRef = vec3(0.95, 0.82, 0.66);
  water = mix(water, skyRef, fres * 0.20 * surf);
  vec2 nrm = normalize(grad + vec2(1e-5));
  float spec = pow(max(dot(nrm, normalize(vec2(0.6, 0.8))), 0.0), 24.0);
  water += vec3(1.0, 0.95, 0.85) * spec * 0.35 * edge;

  // Espuma/spray (§5.1.6): velocidade local alta em região de borda,
  // ou densidade baixa isolada (spray)
  if (uFoam) {
    // Critério físico de espuma: desvio-padrão LOCAL da velocidade
    // (churn). Um escoamento coerente — rápido ou lento — tem variância
    // baixa; a frente da onda, o impacto na boca C e o jato mergulhando no
    // reservatório têm variância alta. Invariante ao referencial.
    float mean = D > 0.05 ? G / D : 0.0;
    float var2 = D > 0.05 ? max(B / D - mean * mean, 0.0) : 0.0;
    float turb = sqrt(var2) / max(uVref, 1.0);
    float foam = smoothstep(0.10, 0.30, turb) * surf;
    float spray = smoothstep(0.06, 0.20, D) * (1.0 - smoothstep(0.20, 0.40, D))
                * smoothstep(0.06, 0.22, turb);
    float f = clamp(foam + spray * 0.8, 0.0, 1.0);
    water = mix(water, vec3(0.97, 0.98, 1.0), f * 0.8);
    surf = max(surf, spray * 0.9);
  }

  vec3 col = mix(bg, water, surf);

  if (uAces) col = aces(col * 1.15);
  if (uVignette) {
    vec2 q = uv - 0.5;
    col *= 1.0 - 0.35 * dot(q, q) * 2.2;
  }
  if (uGrain) {
    float n = fract(sin(dot(gl_FragCoord.xy + uTime * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
    col += (n - 0.5) * 0.02;
  }
  frag = vec4(col, 1.0);
}`;

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
uniform vec4 uWorldRect;  // x0,y0,x1,y1 do quad no mundo
uniform vec2 uCenter;
uniform vec2 uView;
uniform float uScale;
out vec2 vUv;
void main() {
  // O triângulo estendido cobre t ∈ [0,2]; t = 0..1 mapeia o domínio e o
  // excedente é descartado no fragmento (vUv fora de [0,1]).
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

// ------------------------------------------------------------ renderer

export class Renderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private splatProg: WebGLProgram;
  private compositeProg: WebGLProgram;
  private pointsProg: WebGLProgram;
  private texQuadProg: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private densityFbo: Fbo | null = null;
  private posBuf: WebGLBuffer;
  private speedBuf: WebGLBuffer;
  private particleVao: WebGLVertexArrayObject;
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
    this.compositeProg = createProgram(gl, `#version 300 es
layout(location=0) in vec2 aClip;
void main(){ gl_Position = vec4(aClip, 0.0, 1.0); }`, COMPOSITE_FS);
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
    // textura 1D do colormap (viridis)
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
      this.densityFbo = null;
      this.bgDirty = true;
    }
  }

  private ensureFbos(): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    if (!this.densityFbo || this.densityFbo.w !== w || this.densityFbo.h !== h) {
      const internal = this.hasFloat ? gl.RGBA16F : gl.RGBA8;
      const type = this.hasFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
      this.densityFbo = createFbo(gl, w, h, internal, gl.RGBA, type, gl.LINEAR);
    }
  }

  private updateBackground(cam: Camera2D, geo: GeometryInfo): void {
    const key = `${cam.scale.toFixed(2)}|${cam.cx.toFixed(3)}|${cam.cy.toFixed(3)}|${cam.viewW}x${cam.viewH}`;
    if (!this.bgDirty && key === this.lastCamKey) return;
    this.lastCamKey = key;
    this.bgDirty = false;
    this.bgCanvas.width = cam.viewW;
    this.bgCanvas.height = cam.viewH;
    paintBackground(this.bgCtx, cam, geo);
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

  /** Converte o campo escalar em textura RGBA com colormap (CPU). */
  private uploadField(
    frame: FrameMsg, geo: GeometryInfo, kind: FieldKind,
  ): void {
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

  render(frame: FrameMsg, geo: GeometryInfo, cam: Camera2D, opts: RenderOptions): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);

    // Buffers de partículas
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, frame.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.speedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, frame.speeds, gl.DYNAMIC_DRAW);

    if (opts.mode === 'cinematic' && this.hasFloat) {
      this.updateBackground(cam, geo);
      this.ensureFbos();

      // 1) splat de densidade
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.densityFbo!.fb);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.splatProg);
      gl.uniform2f(gl.getUniformLocation(this.splatProg, 'uCenter'), cam.cx, cam.cy);
      gl.uniform2f(gl.getUniformLocation(this.splatProg, 'uView'), w, h);
      gl.uniform1f(gl.getUniformLocation(this.splatProg, 'uScale'), cam.scale);
      const radiusPx = Math.max(2, 1.5 * geo.dx * cam.scale);
      gl.uniform1f(gl.getUniformLocation(this.splatProg, 'uRadiusPx'), radiusPx);
      gl.bindVertexArray(this.particleVao);
      gl.drawArrays(gl.POINTS, 0, frame.count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // 2) composição
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(this.compositeProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.densityFbo!.tex);
      gl.uniform1i(gl.getUniformLocation(this.compositeProg, 'uDensity'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.uniform1i(gl.getUniformLocation(this.compositeProg, 'uBackground'), 1);
      gl.uniform2f(gl.getUniformLocation(this.compositeProg, 'uView'), w, h);
      gl.uniform1f(gl.getUniformLocation(this.compositeProg, 'uTime'), frame.time);
      gl.uniform1i(gl.getUniformLocation(this.compositeProg, 'uAces'), opts.post.aces ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(this.compositeProg, 'uVignette'), opts.post.vignette ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(this.compositeProg, 'uGrain'), opts.post.grain ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(this.compositeProg, 'uFoam'), opts.post.foam ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(this.compositeProg, 'uVref'), opts.vRef);
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      return;
    }

    // ---------------- modo científico (ou fallback sem float) ----------------
    gl.clearColor(0.07, 0.08, 0.10, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (frame.field) {
      this.uploadField(frame, geo, opts.field);
      gl.useProgram(this.texQuadProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
      gl.uniform1i(gl.getUniformLocation(this.texQuadProg, 'uTex'), 0);
      gl.uniform4f(gl.getUniformLocation(this.texQuadProg, 'uWorldRect'),
        0, 0, geo.domainW, geo.domainH);
      gl.uniform2f(gl.getUniformLocation(this.texQuadProg, 'uCenter'), cam.cx, cam.cy);
      gl.uniform2f(gl.getUniformLocation(this.texQuadProg, 'uView'), w, h);
      gl.uniform1f(gl.getUniformLocation(this.texQuadProg, 'uScale'), cam.scale);
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    if (opts.showParticles || !frame.field) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.pointsProg);
      gl.uniform2f(gl.getUniformLocation(this.pointsProg, 'uCenter'), cam.cx, cam.cy);
      gl.uniform2f(gl.getUniformLocation(this.pointsProg, 'uView'), w, h);
      gl.uniform1f(gl.getUniformLocation(this.pointsProg, 'uScale'), cam.scale);
      gl.uniform1f(gl.getUniformLocation(this.pointsProg, 'uPointPx'),
        Math.max(1.5, 0.6 * geo.dx * cam.scale));
      gl.uniform1f(gl.getUniformLocation(this.pointsProg, 'uSpeedMax'), 12);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.cmapTex);
      gl.uniform1i(gl.getUniformLocation(this.pointsProg, 'uColormap'), 0);
      gl.bindVertexArray(this.particleVao);
      gl.drawArrays(gl.POINTS, 0, frame.count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
  }
}

// --------------------------------------------------------------- fallback

/** Fallback Canvas2D (funcional, resolução visual reduzida — §2). */
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
    const cmap = opts.mode === 'cinematic';
    for (let k = 0; k < frame.count; k++) {
      const [sx, sy] = worldToScreen(cam, frame.positions[2 * k], frame.positions[2 * k + 1]);
      if (sx < -2 || sx > w + 2 || sy < -2 || sy > h + 2) continue;
      if (cmap) {
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
