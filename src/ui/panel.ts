/**
 * Painel de controle (§6.1) — HTML/CSS puro, todo em português, com
 * tooltip em cada controle. Nenhum framework (§2).
 */

export interface PanelState {
  V: number;
  H: number;
  D: number;
  waterDepth: number;
  mouthDepth: number;
  nuMult: number;
  smagorinskyCs: number;
  flipAlpha: number;
  nx: number;
  particlesPerCell: number;
  noSlip: boolean;
  drain: boolean;
  tallDomain: boolean;
  timeScale: number;
  mode: 'cinematic' | 'scientific';
  field: 'speed' | 'pressure' | 'vorticity' | 'divergence';
  showParticles: boolean;
  showVectors: boolean;
  showTracers: boolean;
  aces: boolean;
  vignette: boolean;
  grain: boolean;
  foam: boolean;
  bloom: boolean;
  chroma: boolean;
  scenery: boolean;
}

export interface PanelCallbacks {
  onLight: () => void;                  // mudanças que não reconstroem
  onRebuild: () => void;                // mudanças que reconstroem a cena
  onRun: (running: boolean) => void;
  onStep: () => void;
  onReset: () => void;
  onCamera: (preset: string) => void;
  onSweep: () => void;
  onCsv: () => void;
  onRecord: () => void;
}

interface SliderDef {
  key: keyof PanelState;
  label: string;
  min: number; max: number; step: number;
  unit: string;
  tip: string;
  rebuild: boolean;
}

const SLIDERS: SliderDef[] = [
  { key: 'V', label: 'Velocidade do trem V', min: 4.5, max: 16, step: 0.5, unit: 'm/s', rebuild: false,
    tip: 'Velocidade constante da locomotiva. A teoria prevê captação apenas acima de V_min = √(2gH).' },
  { key: 'H', label: 'Altura do bocal H', min: 0.5, max: 1.6, step: 0.05, unit: 'm', rebuild: true,
    tip: 'Altura do bocal de saída A acima do nível da água do canal. Aumenta a energia necessária para captar.' },
  { key: 'D', label: 'Diâmetro do tubo D', min: 0.12, max: 0.3, step: 0.01, unit: 'm', rebuild: true,
    tip: 'Largura interna do tubo captador (fenda, no corte 2D).' },
  { key: 'waterDepth', label: 'Profundidade do canal', min: 0.2, max: 0.45, step: 0.01, unit: 'm', rebuild: true,
    tip: 'Profundidade da água parada no canal entre os trilhos.' },
  { key: 'mouthDepth', label: 'Submersão da boca C', min: 0.05, max: 0.25, step: 0.01, unit: 'm', rebuild: true,
    tip: 'Profundidade do CENTRO da boca C abaixo da superfície. Limitada pela geometria (D e profundidade do canal).' },
  { key: 'nuMult', label: 'Multiplicador de viscosidade', min: 0, max: 10000, step: 1, unit: '×', rebuild: false,
    tip: 'Multiplica a viscosidade molecular da água (ν = 1e-6 m²/s) para experimentação. 1 = água real.' },
  { key: 'smagorinskyCs', label: 'LES: C_s de Smagorinsky', min: 0, max: 0.24, step: 0.01, unit: '', rebuild: false,
    tip: 'Constante do modelo de submalha (turbulência não resolvida). 0 desliga. Típico: 0.10–0.16. Isto é LES, não DNS.' },
  { key: 'flipAlpha', label: 'Mistura FLIP/PIC α', min: 0, max: 1, step: 0.01, unit: '', rebuild: false,
    tip: 'α = 1: FLIP puro (vivo, mais ruidoso). α = 0: APIC puro (estável, um pouco mais difusivo). Padrão 0.95.' },
  { key: 'nx', label: 'Resolução da grade (largura)', min: 128, max: 512, step: 64, unit: 'células', rebuild: true,
    tip: 'Células na horizontal. Mais células = mais fidelidade e MENOS velocidade (o solver roda na CPU).' },
  { key: 'particlesPerCell', label: 'Partículas por célula', min: 4, max: 9, step: 1, unit: '', rebuild: true,
    tip: 'Densidade de amostragem do fluido. 4–9 por célula (2D).' },
];

export class Panel {
  readonly state: PanelState;
  private cb: PanelCallbacks;
  private root: HTMLElement;
  private running = true;
  private playBtn!: HTMLButtonElement;
  private recordBtn!: HTMLButtonElement;

  constructor(root: HTMLElement, initial: PanelState, cb: PanelCallbacks) {
    this.root = root;
    this.state = initial;
    this.cb = cb;
    this.build();
  }

  private build(): void {
    const el = this.root;
    el.innerHTML = '';

    // ---- transporte
    const transport = div('painel-secao');
    transport.appendChild(title('Simulação', 'Controles de execução'));
    const btns = div('botoes');
    this.playBtn = button('⏸ Pausar', 'Pausar/continuar a simulação (tecla Espaço)', () => {
      this.running = !this.running;
      this.playBtn.textContent = this.running ? '⏸ Pausar' : '▶ Continuar';
      this.cb.onRun(this.running);
    });
    btns.appendChild(this.playBtn);
    btns.appendChild(button('⏭ Passo', 'Avança um único passo de tempo (com a simulação pausada)', () => this.cb.onStep()));
    btns.appendChild(button('↺ Reiniciar', 'Recomeça a simulação do estado inicial', () => this.cb.onReset()));
    transport.appendChild(btns);

    // câmera lenta
    const slowmo = div('botoes');
    for (const ts of [1.0, 0.25, 0.1, 0.02]) {
      slowmo.appendChild(button(`${ts}×`, `Câmera lenta: ${ts}× o tempo real (desacoplada do passo físico)`, () => {
        this.state.timeScale = ts;
        this.cb.onLight();
        this.markSpeed(slowmo, ts);
      }));
    }
    this.markSpeed(slowmo, this.state.timeScale);
    transport.appendChild(labelRow('Câmera lenta', slowmo,
      'Escala de tempo da exibição. O passo físico continua controlado pelo CFL (§3.3).'));
    el.appendChild(transport);

    // ---- física
    const fis = div('painel-secao');
    fis.appendChild(title('Parâmetros físicos', 'Todos em unidades SI'));
    for (const s of SLIDERS) {
      fis.appendChild(this.slider(s));
    }
    const toggles = div('botoes');
    toggles.appendChild(toggle('Paredes no-slip', this.state.noSlip,
      'LIGADO: condição realista u=0 nas paredes (camada limite; v medido fica ABAIXO da teoria — esperado). DESLIGADO: free-slip, o limite ideal da teoria.',
      (v) => { this.state.noSlip = v; this.cb.onLight(); }));
    toggles.appendChild(toggle('Dreno do reservatório', this.state.drain,
      'Remove água do fundo do reservatório para execuções longas em regime permanente.',
      (v) => { this.state.drain = v; this.cb.onRebuild(); }));
    toggles.appendChild(toggle('Domínio alto (3.2 m)', this.state.tallDomain,
      'Aumenta o teto do domínio para conter o jato em V alto (o padrão da especificação, 2.25 m, trunca o jato acima de V ≈ 6 m/s).',
      (v) => { this.state.tallDomain = v; this.cb.onRebuild(); }));
    fis.appendChild(toggles);
    el.appendChild(fis);

    // ---- visualização
    const vis = div('painel-secao');
    vis.appendChild(title('Visualização', 'Tecla M alterna científico/cinematográfico'));
    const modeBtns = div('botoes');
    modeBtns.appendChild(button('🎬 Cinematográfico', 'Água com refração, absorção, espuma e tonemapping ACES', () => {
      this.state.mode = 'cinematic'; this.cb.onLight();
    }));
    modeBtns.appendChild(button('🔬 Científico', 'Campos coloridos, vetores, traçadores e gráficos (§5.5)', () => {
      this.state.mode = 'scientific'; this.cb.onLight();
    }));
    vis.appendChild(modeBtns);

    const fieldSel = select(
      [['speed', 'Módulo da velocidade |u|'], ['pressure', 'Pressão P − P₀'],
       ['vorticity', 'Vorticidade ∇×u'], ['divergence', 'Divergência ∇·u (≈0)']],
      this.state.field,
      'Campo escalar exibido no modo científico. A divergência é um diagnóstico do solver: deve ser ≈ 0.',
      (v) => { this.state.field = v as PanelState['field']; this.cb.onLight(); },
    );
    vis.appendChild(labelRow('Campo (científico)', fieldSel, ''));

    const visToggles = div('botoes');
    visToggles.appendChild(toggle('Cenário de fundo', this.state.scenery,
      'Liga o cenário ilustrativo (céu, colinas, brita, trilho). Desligado: fundo neutro de estúdio que prioriza a leitura das texturas da água.',
      (v) => { this.state.scenery = v; this.cb.onLight(); }));
    visToggles.appendChild(toggle('Partículas', this.state.showParticles,
      'Mostra as partículas do FLIP sobre o campo (modo científico).',
      (v) => { this.state.showParticles = v; this.cb.onLight(); }));
    visToggles.appendChild(toggle('Vetores', this.state.showVectors,
      'Vetores de velocidade em grade esparsa.',
      (v) => { this.state.showVectors = v; this.cb.onLight(); }));
    visToggles.appendChild(toggle('Tubo de corrente', this.state.showTracers,
      'Traçadores soltos a montante: os CAPTURADOS (que terminam no bocal A) em dourado — materializa A_c na tela.',
      (v) => { this.state.showTracers = v; this.cb.onLight(); }));
    vis.appendChild(visToggles);

    const postToggles = div('botoes');
    postToggles.appendChild(toggle('ACES', this.state.aces, 'Mapeamento de tons ACES Filmic (§5.3).',
      (v) => { this.state.aces = v; this.cb.onLight(); }));
    postToggles.appendChild(toggle('Bloom', this.state.bloom, 'Brilho difuso nos reflexos intensos (bright-pass + blur).',
      (v) => { this.state.bloom = v; this.cb.onLight(); }));
    postToggles.appendChild(toggle('Aberração', this.state.chroma, 'Aberração cromática radial sutil.',
      (v) => { this.state.chroma = v; this.cb.onLight(); }));
    postToggles.appendChild(toggle('Vinheta', this.state.vignette, 'Escurecimento sutil das bordas.',
      (v) => { this.state.vignette = v; this.cb.onLight(); }));
    postToggles.appendChild(toggle('Grão', this.state.grain, 'Grão de filme sutil.',
      (v) => { this.state.grain = v; this.cb.onLight(); }));
    postToggles.appendChild(toggle('Espuma', this.state.foam, 'Espuma e spray por critério físico (variância local de velocidade).',
      (v) => { this.state.foam = v; this.cb.onLight(); }));
    vis.appendChild(labelRow('Pós-processamento', postToggles, 'Cada efeito tem chave individual (§5.3).'));
    el.appendChild(vis);

    // ---- câmera
    const cam = div('painel-secao');
    cam.appendChild(title('Câmera', 'Arraste para mover; roda do mouse para zoom'));
    const camBtns = div('botoes');
    const presets: Array<[string, string, string]> = [
      ['corte', 'Corte lateral', 'Vista completa do plano de simulação — ideal para entender o fenômeno'],
      ['bocaC', 'Close em C', 'Aproximação na boca de captação'],
      ['tubo', 'Subida do tubo', 'Acompanha a coluna d’água de C até A'],
      ['reservatorio', 'Reservatório', 'O jato caindo e o nível subindo'],
    ];
    for (const [id, nome, tip] of presets) {
      camBtns.appendChild(button(nome, tip, () => this.cb.onCamera(id)));
    }
    const orb = button('Orbital', 'Órbita lenta — disponível apenas no modo 3D interativo (não implementado nesta versão; ver README §Limitações)', () => {});
    orb.disabled = true;
    camBtns.appendChild(orb);
    cam.appendChild(camBtns);
    const d3 = button('Modo 3D interativo', 'O solver 3D existe e é usado pela validação quantitativa headless (npm run validate → docs/VALIDACAO.md), mas não roda em tempo real na CPU do navegador. Ver README §Limitações e decisões de engenharia.', () => {});
    d3.disabled = true;
    cam.appendChild(labelRow('Dimensão', d3,
      'A simulação interativa é o corte 2D; a comparação quantitativa com a teoria roda em 3D fora do navegador.'));
    el.appendChild(cam);

    // ---- medição
    const med = div('painel-secao');
    med.appendChild(title('Medição', 'Varredura automática e exportação'));
    const medBtns = div('botoes');
    medBtns.appendChild(button('📈 Varredura de V', 'Roda V de 4.5 a 16 m/s, espera o regime permanente em cada valor, mede e plota as curvas medidas sobre as analíticas (§6.3)', () => this.cb.onSweep()));
    medBtns.appendChild(button('💾 Exportar CSV', 'Exporta os pontos da última varredura em CSV', () => this.cb.onCsv()));
    this.recordBtn = button('⏺ Gravar vídeo', 'Grava a tela da simulação em WebM', () => this.cb.onRecord());
    medBtns.appendChild(this.recordBtn);
    med.appendChild(medBtns);
    el.appendChild(med);
  }

  setRecording(rec: boolean): void {
    this.recordBtn.textContent = rec ? '⏹ Parar gravação' : '⏺ Gravar vídeo';
  }

  private markSpeed(container: HTMLElement, ts: number): void {
    for (const b of Array.from(container.children) as HTMLButtonElement[]) {
      b.classList.toggle('ativo', b.textContent === `${ts}×`);
    }
  }

  private slider(def: SliderDef): HTMLElement {
    const wrap = div('controle');
    const lab = document.createElement('label');
    const val = document.createElement('span');
    val.className = 'valor';
    const update = () => {
      val.textContent = `${(this.state[def.key] as number).toFixed(def.step < 0.1 ? 2 : def.step < 1 ? 1 : 0)} ${def.unit}`;
    };
    lab.textContent = def.label + ' ';
    lab.title = def.tip;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(this.state[def.key]);
    input.title = def.tip;
    input.addEventListener('input', () => {
      (this.state[def.key] as number) = parseFloat(input.value);
      update();
    });
    input.addEventListener('change', () => {
      if (def.rebuild) this.cb.onRebuild();
      else this.cb.onLight();
    });
    update();
    lab.appendChild(val);
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }
}

// ------------------------------------------------------------ helpers DOM

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function title(t: string, tip: string): HTMLElement {
  const h = document.createElement('h3');
  h.textContent = t;
  h.title = tip;
  return h;
}

function button(text: string, tip: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = tip;
  b.addEventListener('click', onClick);
  return b;
}

function toggle(
  text: string, initial: boolean, tip: string, onChange: (v: boolean) => void,
): HTMLElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = tip;
  b.classList.toggle('ativo', initial);
  b.addEventListener('click', () => {
    const v = !b.classList.contains('ativo');
    b.classList.toggle('ativo', v);
    onChange(v);
  });
  return b;
}

function select(
  options: Array<[string, string]>, initial: string, tip: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const s = document.createElement('select');
  s.title = tip;
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    if (v === initial) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function labelRow(text: string, control: HTMLElement, tip: string): HTMLElement {
  const wrap = div('controle');
  const lab = document.createElement('label');
  lab.textContent = text;
  if (tip) lab.title = tip;
  wrap.appendChild(lab);
  wrap.appendChild(control);
  return wrap;
}
