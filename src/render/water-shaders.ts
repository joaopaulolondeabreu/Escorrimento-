/**
 * Shaders do pipeline de água fotorrealista (§5.1, §5.3).
 *
 * Passes: splat de momentos → blur bilateral separável → composição
 * (normais pseudo-3D + micro-ondulações, refração com dispersão,
 * Beer–Lambert, subsuperfície, Fresnel–Schlick, especular GGX, espuma,
 * cáusticas) → bright-pass → blur do bloom → pós final (ACES, aberração
 * cromática, vinheta, grão).
 *
 * NOTA HONESTA: é o pipeline de fluido em espaço de tela adaptado ao corte
 * 2D — profundidade "esférica" por partícula e sombras em cascata do §5.1
 * pleno exigiriam a cena 3D; documentado no README.
 */

export const FULLSCREEN_VS = `#version 300 es
layout(location=0) in vec2 aClip;
void main(){ gl_Position = vec4(aClip, 0.0, 1.0); }`;

export const SPLAT_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in float aSpeed;
uniform vec2 uCenter;
uniform vec2 uView;
uniform float uScale;
uniform float uRadiusPx;
out float vSpeed;
void main() {
  vec2 px = (aPos - uCenter) * uScale;
  gl_Position = vec4(2.0 * px / uView, 0.0, 1.0);
  gl_PointSize = uRadiusPx * 2.0;
  vSpeed = aSpeed;
}`;

export const SPLAT_FS = `#version 300 es
precision highp float;
in float vSpeed;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float w = exp(-2.6 * r2) - exp(-2.6);
  // Momentos: densidade, 1º e 2º momento da velocidade (relativa à
  // corrente) — a VARIÂNCIA local vira o critério físico de espuma.
  frag = vec4(w, w * vSpeed, w * vSpeed * vSpeed, 1.0);
}`;

/**
 * Blur bilateral separável (§5.1.2): suaviza a densidade preservando a
 * silhueta — pesos gaussianos no espaço E na diferença de densidade.
 * Sem isto a superfície fica com aparência de bolinhas.
 */
export const BILATERAL_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uView;
uniform vec2 uDir;        // (1,0) ou (0,1)
uniform float uRadius;    // raio em pixels
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec2 texel = uDir / uView;
  vec4 center = texture(uTex, uv);
  float sigmaS = uRadius * 0.5;
  float sigmaR = max(0.35, center.r * 0.6 + 0.15);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (float o = -8.0; o <= 8.0; o += 1.0) {
    float off = o * uRadius / 8.0;
    vec4 s = texture(uTex, uv + texel * off);
    float ws = exp(-off * off / (2.0 * sigmaS * sigmaS));
    float dr = (s.r - center.r) / sigmaR;
    float wr = exp(-dr * dr * 0.5);
    float wgt = ws * wr;
    acc += s * wgt;
    wsum += wgt;
  }
  frag = acc / max(wsum, 1e-6);
}`;

/** Ruído procedural compartilhado (hash → value noise → fbm). */
const NOISE_GLSL = `
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return v;
}
// Célula de Worley (cáusticas / espuma rendada)
float worley(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash21(i + g), hash21(i + g + 19.19));
      d = min(d, length(g + o - f));
    }
  }
  return d;
}`;

/**
 * Composição principal da água. Reconstrução de superfície e sombreamento
 * físico (ver cabeçalho do arquivo).
 */
export const WATER_COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uDensity;    // momentos suavizados (bilateral)
uniform sampler2D uDensityRaw; // momentos crus (spray fino)
uniform sampler2D uBackground;
uniform vec2 uView;
uniform float uTime;
uniform float uVref;
uniform vec2 uSunUv;           // posição do sol na tela (uv, origem embaixo)
uniform vec2 uFlowDir;         // direção média do escoamento (tela)
uniform float uPxPerMeter;
uniform bool uFoam;
uniform bool uScenery;
out vec4 frag;

${NOISE_GLSL}

// Ambiente refletido: céu de fim de tarde (cenário ligado) ou estúdio
// neutro frio (padrão — nada compete com a água)
vec3 envSky(vec3 dir) {
  float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  if (uScenery) {
    vec3 horizon = vec3(0.91, 0.62, 0.42);
    vec3 zenith = vec3(0.17, 0.24, 0.42);
    return mix(horizon, zenith, pow(t, 0.8));
  }
  vec3 horizon = vec3(0.42, 0.46, 0.52);
  vec3 zenith = vec3(0.14, 0.16, 0.20);
  return mix(horizon, zenith, pow(t, 0.8));
}

// GGX (Trowbridge-Reitz) — especular físico (§5.1.5)
float ggx(vec3 n, vec3 h, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float ndh = max(dot(n, h), 0.0);
  float denom = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * denom * denom);
}

vec3 aces(vec3 x) {
  return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec2 uvBg = vec2(uv.x, 1.0 - uv.y);
  vec2 texel = 1.0 / uView;

  vec4 mom = texture(uDensity, uv);
  float D = mom.r;
  float mean = D > 0.03 ? mom.g / D : 0.0;
  float var2 = D > 0.03 ? max(mom.b / D - mean * mean, 0.0) : 0.0;
  float turb = sqrt(var2) / max(uVref, 1.0);

  vec4 momRaw = texture(uDensityRaw, uv);

  // ---- superfície: máscara com anti-alias em espaço de tela
  float aa = fwidth(D) * 1.2 + 1e-4;
  float surf = smoothstep(0.42 - aa, 0.42 + aa, D);

  // ---- altura pseudo-3D: perfil arredondado h = sqrt(D̂)
  float hC = sqrt(clamp(D / 1.6, 0.0, 1.0));
  float hR = sqrt(clamp(texture(uDensity, uv + vec2(texel.x, 0.0)).r / 1.6, 0.0, 1.0));
  float hT = sqrt(clamp(texture(uDensity, uv + vec2(0.0, texel.y)).r / 1.6, 0.0, 1.0));
  vec2 gradH = vec2(hR - hC, hT - hC);

  // ---- micro-ondulações procedurais: amplitude cresce com a turbulência
  // e o fluxo arrasta o padrão (uFlowDir) — é o que tira a cara de "gel"
  vec2 wuv = gl_FragCoord.xy / uPxPerMeter;   // coordenadas em metros
  vec2 drift = uFlowDir * uTime * 0.6;
  float r1 = fbm((wuv - drift) * 22.0 + uTime * vec2(0.7, 1.1));
  float r2 = fbm((wuv - drift * 1.7) * 47.0 - uTime * vec2(1.3, 0.4));
  float rippleAmp = (0.05 + 0.30 * smoothstep(0.02, 0.25, turb)) * surf;
  vec2 ripple = vec2(dFdx(r1 + 0.6 * r2), dFdy(r1 + 0.6 * r2)) * rippleAmp * 22.0;

  vec3 n = normalize(vec3(-(gradH * 34.0 + ripple), 1.0));

  // ---- refração com dispersão cromática (n_agua = 1.333)
  // Deslocamento em unidades FÍSICAS (metros × px/m): consistente com o
  // zoom — em UV cru o close-up amostraria o cenário a metros de distância.
  float thick = clamp(D, 0.0, 3.0);
  float thickM = thick * 0.11;                      // espessura óptica [m]
  vec2 refrPx = n.xy * 0.30 * thickM * uPxPerMeter; // deslocamento [px]
  vec2 refrBase = refrPx / uView;
  vec2 flipY = vec2(1.0, -1.0);
  float rR = texture(uBackground, uvBg + refrBase * 0.94 * flipY * surf).r;
  float rG = texture(uBackground, uvBg + refrBase * 1.00 * flipY * surf).g;
  float rB = texture(uBackground, uvBg + refrBase * 1.07 * flipY * surf).b;
  vec3 bgRefr = vec3(rR, rG, rB);
  vec3 bg = texture(uBackground, uvBg).rgb;

  // ---- absorção Beer–Lambert por canal: σ = (0.45, 0.12, 0.08) m⁻¹
  // (§5.1.5). O percurso óptico combina a espessura splatada com a
  // SUBMERSÃO aparente (marcha curta para cima no campo de densidade:
  // quanto mais água acima, mais fundo — água funda fica mais escura).
  float above = 0.0;
  float stepPx = 0.045 * uPxPerMeter; // amostras a cada ~4.5 cm de mundo
  for (float o = 1.0; o <= 4.0; o += 1.0) {
    above += texture(uDensity, uv + vec2(0.0, texel.y * o * stepPx)).r;
  }
  float submerge = clamp(above * 0.35, 0.0, 2.5);
  float path = thick * 1.9 + submerge * 2.4;
  vec3 T = exp(-vec3(0.45, 0.12, 0.08) * path * 1.7);
  vec3 deepColor = vec3(0.012, 0.10, 0.13);
  vec3 water = bgRefr * T + deepColor * (1.0 - T);

  // ---- subsuperfície: luz do sol espalhada dentro do volume nas bordas
  // viradas para o sol (translucidez de crista de onda)
  vec3 sunDir = normalize(vec3(uSunUv - uv, 0.35));
  float sss = pow(max(dot(n, sunDir), 0.0), 2.0) * (1.0 - T.g) * 0.5;
  water += vec3(0.10, 0.30, 0.30) * sss;

  // ---- reflexão de Fresnel-Schlick, F0 = 0.02 (§5.1.5)
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float ndv = max(dot(n, viewDir), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 reflDir = reflect(-viewDir, n);
  vec3 env = envSky(reflDir);
  // brilho da luz principal no reflexo (quente com cenário; branca no estúdio)
  float sunGlint = pow(max(dot(reflDir, sunDir), 0.0), 60.0);
  vec3 glintCol = uScenery ? vec3(1.4, 1.15, 0.85) : vec3(1.25, 1.3, 1.4);
  env += glintCol * sunGlint * 2.0;
  water = mix(water, env, clamp(fresnel * 1.6, 0.0, 0.55));

  // ---- especular GGX do sol (rugosidade sobe com a turbulência)
  vec3 h = normalize(sunDir + viewDir);
  float rough = mix(0.03, 0.28, smoothstep(0.03, 0.3, turb));
  float spec = ggx(n, h, rough) * fresnel;
  vec3 specCol = uScenery ? vec3(1.3, 1.1, 0.85) : vec3(1.15, 1.22, 1.3);
  water += specCol * spec * 0.65;

  // ---- espuma por variância local (critério físico invariante) com
  // textura procedural rendada + borbulhas
  if (uFoam) {
    float foamTrig = smoothstep(0.10, 0.30, turb) * surf;
    float lace = 1.0 - smoothstep(0.0, 0.65, worley((wuv - drift * 1.2) * 60.0 + fbm(wuv * 30.0) * 2.0));
    float bubbles = smoothstep(0.75, 0.95, vnoise((wuv - drift) * 140.0));
    float foamTex = clamp(lace * 0.85 + bubbles * 0.5, 0.0, 1.0);
    float foam = foamTrig * (0.35 + 0.65 * foamTex);
    // espuma persistente na superfície superior (linha d'água)
    float topEdge = smoothstep(0.0, 0.03, gradH.y) * surf * smoothstep(0.02, 0.1, turb);
    foam = clamp(foam + topEdge * foamTex * 0.6, 0.0, 1.0);
    vec3 foamCol = vec3(0.96, 0.985, 1.0) * (0.75 + 0.25 * r1);
    water = mix(water, foamCol, foam * 0.9);

    // spray fino: densidade crua baixa e isolada, com cintilação
    float sprayD = momRaw.r;
    float spray = smoothstep(0.05, 0.16, sprayD) * (1.0 - smoothstep(0.16, 0.38, sprayD))
                * smoothstep(0.05, 0.2, turb);
    float sparkle = smoothstep(0.86, 0.97, vnoise(gl_FragCoord.xy * 0.9 + uTime * 13.0));
    vec3 sprayCol = mix(vec3(0.85, 0.92, 0.97), vec3(1.3), sparkle);
    water = mix(water, sprayCol, clamp(spray, 0.0, 1.0) * 0.85);
    surf = max(surf, spray * 0.9);
  }

  // ---- linha d'água: menisco fino escuro na fronteira água-ar e crista
  // sutilmente clara. Bandas definidas em LARGURA DE TELA (fwidth), não em
  // densidade — senão em zoom alto virariam listras largas.
  {
    float bw = fwidth(D) * 2.0 + 1e-4;
    float edgeBand = smoothstep(0.42 - 3.0 * bw, 0.42 - bw, D)
                   * (1.0 - smoothstep(0.42 + bw, 0.42 + 3.0 * bw, D));
    water *= 1.0 - 0.30 * edgeBand;
    float crest = smoothstep(0.42 + bw, 0.42 + 3.0 * bw, D)
                * (1.0 - smoothstep(0.42 + 3.0 * bw, 0.42 + 6.0 * bw, D));
    water += vec3(0.10, 0.12, 0.12) * crest * clamp(gradH.y * 30.0, 0.0, 1.0);
  }

  // ---- cáusticas no leito: rede de Worley animada projetada no fundo
  // sob a água (aproximação em espaço de tela, §5.1.5)
  float below = smoothstep(0.5, 1.2, D);
  float caust = pow(1.0 - worley(wuv * 34.0 + vec2(uTime * 0.5, uTime * 0.23)
                + vec2(fbm(wuv * 8.0 + uTime * 0.2)) * 1.4), 3.0);
  vec3 caustCol = uScenery ? vec3(1.0, 0.95, 0.8) : vec3(0.9, 0.97, 1.0);
  bg += caustCol * caust * below * 0.30 * T.g;

  vec3 col = mix(bg, water, surf);
  frag = vec4(col, 1.0);
}`;

/** Bright-pass do bloom (limiar suave). */
export const BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uView;
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec3 c = texture(uTex, uv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float wgt = smoothstep(0.78, 1.15, l);
  frag = vec4(c * wgt, 1.0);
}`;

/** Blur gaussiano separável do bloom (meia resolução). */
export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uView;
uniform vec2 uDir;
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec2 texel = uDir / uView;
  vec3 acc = texture(uTex, uv).rgb * 0.227027;
  float offs[4];
  offs[0] = 1.3846; offs[1] = 3.2308; offs[2] = 5.0769; offs[3] = 6.923;
  float wgts[4];
  wgts[0] = 0.3162; wgts[1] = 0.0702; wgts[2] = 0.0102; wgts[3] = 0.0010;
  for (int i = 0; i < 4; i++) {
    acc += texture(uTex, uv + texel * offs[i]).rgb * wgts[i];
    acc += texture(uTex, uv - texel * offs[i]).rgb * wgts[i];
  }
  frag = vec4(acc, 1.0);
}`;

/** Pós-processamento final (§5.3): bloom + ACES + aberração + vinheta + grão. */
export const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uView;
uniform float uTime;
uniform bool uAces;
uniform bool uVignette;
uniform bool uGrain;
uniform bool uBloomOn;
uniform bool uChroma;
out vec4 frag;

vec3 aces(vec3 x) {
  return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec3 col;
  if (uChroma) {
    // aberração cromática sutil, radial
    vec2 d = (uv - 0.5) * 0.0012;
    col = vec3(
      texture(uScene, uv + d).r,
      texture(uScene, uv).g,
      texture(uScene, uv - d).b
    );
  } else {
    col = texture(uScene, uv).rgb;
  }
  if (uBloomOn) col += texture(uBloom, uv).rgb * 0.55;
  if (uAces) col = aces(col * 1.12);
  if (uVignette) {
    vec2 q = uv - 0.5;
    col *= 1.0 - 0.38 * dot(q, q) * 2.1;
  }
  if (uGrain) col += (hash(gl_FragCoord.xy + fract(uTime) * 431.0) - 0.5) * 0.022;
  frag = vec4(col, 1.0);
}`;
