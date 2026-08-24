# NUMERICA — método, discretização, escolhas e justificativas

Este documento descreve **o que está de fato implementado** neste
repositório, incluindo as decisões tomadas durante o desenvolvimento, os
modos de falha encontrados e as aproximações assumidas — com a direção do
erro que cada aproximação introduz. A derivação física está em
`FISICA.md`; os resultados medidos em `VALIDACAO.md`.

## 1. Equações e método

Resolvemos Navier–Stokes incompressível com superfície livre:

```
∂u/∂t + (u·∇)u = −(1/ρ)∇p + ∇·((ν+ν_t)∇u) + g,    ∇·u = 0
```

com ρ = 998 kg/m³, ν = 1.0×10⁻⁶ m²/s, g = 9.81 m/s², pelo método híbrido
**FLIP/APIC sobre grade MAC** (§3.2 da especificação):

- a **grade** resolve pressão/incompressibilidade e as forças;
- as **partículas** transportam o material sem difusão numérica de advecção;
- a transferência usa o kernel B-spline quadrática (suporte de 3 nós).

O passo de tempo segue o splitting clássico: transferência P2G → gravidade
→ viscosidade → projeção de pressão → extrapolação → G2P → advecção RK3 →
reamostragem. Passo adaptativo por CFL (C = 0.9, Δt ≤ 1/120 s).
Determinismo total: RNG mulberry32 com semente fixa, ordem de redução fixa.

## 2. Grade MAC e frações cut-cell

Velocidades nas faces, pressão nos centros (Harlow & Welch). A geometria
sólida é um SDF; cada face carrega uma **fração livre** w ∈ [0,1]:

- **2D**: fração exata da aresta fora do sólido, por interpolação linear do
  SDF nos dois nós da face (`freeFraction`).
- **3D**: estimativa suave `w = clamp(0.5 + φ(centro da face)/Δx, 0, 1)`.
  Menos precisa que a integração por nós (erro de posição da parede
  < 0.5 célula), suficiente para as tolerâncias-alvo de §7.2 e muito mais
  barata. Direção do erro: paredes efetivamente deslocadas em até ~Δx/2.

A divergência discreta é ponderada pelas frações e inclui o termo do
sólido móvel `(1−w)·u_solid` — é assim que o leito móvel e a parede de
entrada entram na projeção.

**Paredes finas:** uma parede mais fina que ~1.5·Δx "vaza" entre os nós da
grade (a fração de face não a vê). A espessura efetiva do tubo é limitada
por baixo a `max(t, 1.6·Δx)` — documentado na UI; em Δx grosso o tubo
fica com parede mais grossa que os 12 mm nominais.

## 3. Transferências APIC — a lição da covariância centrada

P2G (momento afim): `m_i·u_i = Σ w_ip·(u_p + C_p·(x_i − x_p))`, com
normalização pela massa acumulada. Os pesos são avaliados pela **distância
real** ao nó (nunca por offset tabelado com índice grampeado): perto do
contorno o stencil perde nós e a soma de pesos cai — todas as reduções são
normalizadas pela soma efetiva. *Modo de falha real encontrado:* grampear o
índice sem recalcular o peso produz pesos negativos e explosão numérica.

G2P: velocidade por blend FLIP/PIC (α = 0.95 padrão) e reconstrução da
matriz afim por **mínimos quadrados ponderados centrados**:

```
C = Cov_w(r, u) · Cov_w(r, r)⁻¹
```

No interior, `Σw·r = 0` e isso se reduz ao APIC canônico (Jiang et al.
2015) com `D = (Δx²/4)·I`. Perto do contorno o stencil é assimétrico
(`Σw·r ≠ 0`) e a forma NÃO centrada contamina o gradiente com o valor
médio do campo (~u/Δx — explosivo). *Modos de falha reais, na ordem em que
foram encontrados e corrigidos:*

1. `D⁻¹ = 4/Δx²` fixo com stencil truncado → falso gradiente ~400·u → explosão;
2. `C = 0` na faixa de contorno → dissipação artificial concentrada onde o
   escoamento é mais rápido (Taylor–Green: taxa 0.46/s vs 0.20/s teórica,
   independente da resolução);
3. `C = B·D⁻¹` exato sem centrar → instabilidade anti-difusiva (amplitude
   do vórtice CRESCENDO com passos menores);
4. covariância centrada → estável e preciso (TG dentro de 3–5%).

Guarda de condicionamento: `det(Cov) > 10⁻⁴·(Δx²/4)^d` senão C = 0.

## 4. Projeção de pressão

Poisson `∇·((Δt/ρ)∇p) = ∇·u*` com matriz simétrica positiva-definida de
5/7 pontos, resolvida por **PCG com precondicionador MIC(0)** (receita de
Bridson, τ = 0.97, σ = 0.25), tolerância relativa 10⁻⁶ ou 200 iterações.
(A especificação pede MGPCG *ou* MIC(0)-PCG; escolhemos MIC(0) — nos
domínios usados converge em 20–40 iterações.)

**Warm start**: a pressão do passo anterior é o chute inicial
(r₀ = b − A·x₀), com a tolerância ancorada na norma do RHS para manter o
mesmo critério de parada do arranque a frio. Medido: no repouso
hidrostático o PCG cai de 34 iterações para **1**; na cena-alvo, para um
dígito na maior parte dos passos. Determinístico.

Superfície livre por **ghost-fluid**: `p = 0` (relativo a P₀) aplicado na
posição da interface via `θ = φ_F/(φ_F − φ_A)` (clamp em 0.02), não na
célula inteira — essencial para a altura de subida no tubo e o perfil
hidrostático exato (ver VALIDACAO: perfil linear com resíduo < 0.5%).

Bordas: `open` → Dirichlet p′ = 0; `outflow` → Dirichlet hidrostático
`p′ = ρg·max(0, nível − y)` (condição de campo distante do canal
truncado); `wall`/`inflow` → Neumann com velocidade prescrita na face.
Sistema totalmente fechado (Taylor–Green): RHS projetado para média zero +
regularização 10⁻⁸ na diagonal (pressão definida a menos de constante).

**Invalidação de faces antes da projeção** (*modo de falha real*): todas
as faces são marcadas inválidas antes do solve; só faces projetadas
(adjacentes a células FLUID) e de parede voltam a valer; o resto é
reconstruído por extrapolação BFS. Sem isso, faces de ar guardavam o
incremento de gravidade sem contrapeso de pressão e o erro acumulava.

Faces FLUID|SOLID com fração parcial não são projetadas (∂p/∂n = 0) e
ficam para a extrapolação — aproximação de 1ª ordem perto de paredes
cortadas (o método variacional de Batty resolveria exatamente; fora de
escopo).

## 5. Viscosidade e LES

**2D:** difusão implícita (Backward Euler) por gradiente conjugado,
componente a componente. BCs viscosas por direção: na direção da própria
componente a velocidade da parede é conhecida (Dirichlet, ambos os modos);
na direção tangencial, no-slip usa fantasma refletido (parede a meia
célula ⇒ coeficiente 2) e free-slip é Neumann homogêneo. O leito móvel
entra como Dirichlet tangencial u = −V. Difusão fraca (c < 0.05) usa passo
explícito. Validado por Poiseuille (erro L2 < 2%).

**3D:** apenas difusão explícita. Justificativa: com ν nominal da água e
Δx ≥ 2 cm, o número de difusão Δt·ν/Δx² < 10⁻⁵ — o solve implícito seria
custo puro sem efeito mensurável; a validação §7.2 é free-slip.

**Smagorinsky** (§3.2.5): ν_t = (C_s·Δ)²·|S̄|, |S̄| = √(2S̄:S̄), aplicado
como difusão explícita com limitador ν_t ≤ 0.2·Δx²/Δt. C_s padrão 0.12.
**Isto é LES, não DNS** — Re real ≈ 2×10⁶.

## 6. Level set do líquido

União de bolas sobre as partículas (r = 0.9·Δx/√ppc) + uma/duas passadas
de suavização **incluindo as células de borda** (vizinho espelhado) — pular
a borda criava degrau de θ na junção parede–superfície (*modo de falha
real*: chutes espúrios). O φ resultante não é distância exata no interior
(≈ 0 perto das partículas), o que basta para o ghost-fluid (só a banda da
superfície importa) e para a reamostragem.

## 7. Advecção, reamostragem, emissores

- **RK3 de Ralston** no campo de grade congelado:
  `x⁺ = x + Δt·(2k₁ + 3k₂ + 4k₃)/9`. Interpolação bilinear/trilinear
  (dentro de cada célula MAC ela é exatamente livre de divergência).
- Penetração em sólido → projeção para fora pela normal do SDF.
- **Reamostragem por realocação (neutra em massa)** — a história completa,
  porque cada etapa foi um modo de falha REAL medido:
  1. gate por level set (φ < −Δx) era **inatingível** (o φ de união de
     bolas nunca desce de −r ≈ −0.45Δx) → reamostragem era código morto
     (achado da revisão adversarial);
  2. "completar células rarefeitas até o alvo" → **+119–141% de massa** em
     30 s de sloshing: com o clustering natural do FLIP a inserção supera
     sistematicamente a remoção, e cada partícula criada é volume que a
     projeção (incompressível!) empurra para cima — realimentação;
  3. inserir apenas em vazios interiores reais → ainda **+21%**: célula
     vazia transitória não é massa faltando — o volume está nas vizinhas
     aglomeradas;
  4. política final: vazio interior profundo (nenhuma célula de AR num
     raio de 2) é preenchido **realocando** uma partícula da vizinha mais
     aglomerada (contagem inalterada); só aglomerações extremas (> 3× o
     alvo) profundas são removidas. Deriva medida: **0.03%** em 30 s, com
     ~560 realocações fazendo trabalho útil.
  A equalização estrita de 4–8 partículas/célula pedida em §3.2.10 é
  incompatível com deriva de massa < 1% neste esquema — esta é a leitura
  honesta das duas exigências simultâneas.
- Binning e listas SEMPRE refeitos dentro da reamostragem (pós-advecção):
  as listas do início do passo apontariam para índices trocados pelos
  swap-remove da advecção (partícula errada removida — achado da revisão).
- **Emissor de entrada**: banda de 2 células na borda direita mantida na
  densidade-alvo com velocidade prescrita (−V, 0) — a banda é condição de
  contorno, não fluido livre. Saída: partículas que cruzam a borda são
  removidas e contabilizadas (φ de saída, perdas pelo topo).

## 8. Desempenho (CPU) e a decisão sobre WebGPU

A especificação (§2, §8) pede compute em WebGPU com metas de 60 fps. **Não
implementado nesta versão** — decisão de engenharia declarada (§12.3):
um MGPCG + FLIP completo em WGSL é um projeto à parte; a alternativa
entregue prioriza correção física verificável (solver único, testado,
determinístico, em TypeScript) com:

- solver no **Web Worker** (a UI nunca congela — §8 "sem travamentos");
- perfis por etapa expostos (HUD `Δt`, PCG, e `lastTimings` no código);
- otimizações reais medidas: stencils sem closures/tuplas nos caminhos
  quentes (advecção 3D 1430 ms → 60 ms/passo), buffers persistentes,
  `sqrt` direto no lugar de `Math.hypot` (~10× nesse caminho).

Números típicos nesta máquina (4 núcleos): 2D 192×72 ≈ 25–40 ms/passo
(~0.05–0.1× tempo real na cena-alvo); 3D 96×56×27 ≈ 0.5–2.5 s/passo
(validação headless). As metas de §8 exigem a portagem GPU — está no
roadmap do README.

## 9. Tensão superficial

Não implementada (nem como opção). We ≈ 10⁶ ⇒ desprezível na dinâmica
(§3.4 da especificação a lista como opcional/desligada); o custo de um CSF
bem feito não se justificou dentro do escopo. Efeito visual de gotas é
tratado no render (spray).

## 10. Renderização (resumo técnico)

Modo cinematográfico: splat de momentos de velocidade (densidade, média,
variância) em RGBA16F → blur bilateral separável → composição (normais
pseudo-3D + micro-ondulações procedurais advectadas, refração com
dispersão, Beer–Lambert por canal com submersão aparente, subsuperfície,
Fresnel–Schlick F₀ = 0.02, especular GGX, espuma por **variância local de
velocidade** — critério invariante de referencial; no referencial do trem
até o canal calmo se move a V, então |u| não distingue churn de corrente —
cáusticas de Worley) → bloom → ACES/aberração/vinheta/grão. É o pipeline
de "screen-space fluid" adaptado ao corte 2D; os passes 3D plenos da
especificação (profundidade esférica por partícula, sombras em cascata,
HDRI real) exigiriam a cena 3D interativa (ver §8 acima).

## 11. Pipeline Blender (renderização fotorrealista externa)

Para "água idêntica à vida real", o corte 2D interativo tem teto físico
(fenômeno 3D). O caminho entregue e TESTADO de ponta a ponta:

1. `npx tsx src/tests/export3d.ts --V=8 --t=4 --fps=24` roda a simulação
   3D deste repositório e grava `exports/quadro_####.ply` (nuvens de
   pontos binárias com |u| por partícula) + `exports/cena.json`;
2. `blender -b -P blender/importar_escorrimento.py -- exports 1 96`
   reconstrói a superfície por Points→Volume→Mesh (Geometry Nodes),
   aplica água física (Principled BSDF com transmissão, IOR 1.333,
   absorção volumétrica), monta tubo/canal/reservatório a partir do
   cena.json, ilumina com céu Nishita + sol e renderiza em Cycles.

A física é 100% do nosso solver; o Blender é só renderizador. Compatível
com Blender 3.6+/4.x (importador PLY e sockets de GN com fallback; builds
sem OpenImageDenoise caem para render sem denoise automaticamente).
