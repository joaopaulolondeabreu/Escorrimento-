/**
 * Codificador de QR Code mínimo, sem dependências (mesma regra do resto do
 * projeto: nada de biblioteca externa — §2). Cobre o suficiente para um
 * endereço de rede local: modo byte, nível de correção M, versões 1 a 6
 * (até 106 caracteres). Se o texto não couber, quem chama recebe null e
 * mostra só o endereço escrito.
 *
 * Referência: ISO/IEC 18004. A implementação foi conferida módulo a módulo
 * contra uma implementação independente (ver scripts/qr-verificar.mjs).
 */

// Versões 1..6 no nível M: total de codewords, EC por bloco e nº de blocos.
const VERSOES = {
  1: { total: 26, ecPorBloco: 10, blocos: 1, alinhamento: 0 },
  2: { total: 44, ecPorBloco: 16, blocos: 1, alinhamento: 18 },
  3: { total: 70, ecPorBloco: 26, blocos: 1, alinhamento: 22 },
  4: { total: 100, ecPorBloco: 18, blocos: 2, alinhamento: 26 },
  5: { total: 134, ecPorBloco: 24, blocos: 2, alinhamento: 30 },
  6: { total: 172, ecPorBloco: 16, blocos: 4, alinhamento: 34 },
};

// ----------------------------------------------------------- GF(256)
// Campo de Galois do QR: polinômio primitivo 0x11D, gerador 2.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * Polinômio gerador de grau `grau`: produto de (x + α^i), i = 0..grau−1,
 * guardado em ordem DECRESCENTE de grau (g[0] = coeficiente líder = 1) —
 * é essa a convenção que a divisão sintética abaixo espera, usando g[i+1].
 */
function polinomioGerador(grau) {
  let g = [1];
  for (let i = 0; i < grau; i++) {
    const novo = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      novo[j] ^= g[j];                     // multiplica por x
      novo[j + 1] ^= mul(g[j], EXP[i]);    // multiplica por α^i
    }
    g = novo;
  }
  return g;
}

/** Codewords de correção de erros (Reed–Solomon) de um bloco de dados. */
function correcaoErro(dados, nEc) {
  const g = polinomioGerador(nEc);
  const resto = new Uint8Array(nEc);
  for (const d of dados) {
    const fator = d ^ resto[0];
    resto.copyWithin(0, 1);
    resto[nEc - 1] = 0;
    if (fator !== 0) {
      for (let i = 0; i < nEc; i++) resto[i] ^= mul(g[i + 1], fator);
    }
  }
  return resto;
}

// ----------------------------------------------------------- bits e blocos

/** Fluxo de bits do modo byte + preenchimento até encher os dados. */
function fluxoDeBits(bytes, nDados) {
  const bits = [];
  const push = (valor, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((valor >> i) & 1);
  };
  push(0b0100, 4);            // modo byte
  push(bytes.length, 8);      // contagem (8 bits nas versões 1..9)
  for (const b of bytes) push(b, 8);
  const capacidade = nDados * 8;
  for (let i = 0; i < 4 && bits.length < capacidade; i++) bits.push(0);  // terminador
  while (bits.length % 8 !== 0) bits.push(0);
  const enchimento = [0xec, 0x11];
  for (let i = 0; bits.length < capacidade; i++) push(enchimento[i % 2], 8);
  const codewords = new Uint8Array(nDados);
  for (let i = 0; i < nDados; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[8 * i + j];
    codewords[i] = v;
  }
  return codewords;
}

/** Divide em blocos, calcula a correção e intercala na ordem final. */
function sequenciaFinal(codewords, info) {
  const { blocos, ecPorBloco } = info;
  const porBloco = codewords.length / blocos;
  const dados = [];
  const ecs = [];
  for (let b = 0; b < blocos; b++) {
    const bloco = codewords.subarray(b * porBloco, (b + 1) * porBloco);
    dados.push(bloco);
    ecs.push(correcaoErro(bloco, ecPorBloco));
  }
  const saida = [];
  for (let i = 0; i < porBloco; i++) for (const d of dados) saida.push(d[i]);
  for (let i = 0; i < ecPorBloco; i++) for (const e of ecs) saida.push(e[i]);
  return saida;
}

// ----------------------------------------------------------- matriz

const MASCARAS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/** Padrões fixos (localizadores, temporização, alinhamento) e reservas. */
function matrizBase(versao) {
  const tam = 17 + 4 * versao;
  const m = Array.from({ length: tam }, () => new Array(tam).fill(0));
  const fixo = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const set = (i, j, v) => { m[i][j] = v ? 1 : 0; fixo[i][j] = true; };

  // localizadores 7×7 + separadores, nos três cantos
  for (const [li, lj] of [[0, 0], [0, tam - 7], [tam - 7, 0]]) {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const r = li + i, c = lj + j;
        if (r < 0 || c < 0 || r >= tam || c >= tam) continue;
        const borda = i === 0 || i === 6 || j === 0 || j === 6;
        const centro = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        const dentro = i >= 0 && i <= 6 && j >= 0 && j <= 6;
        set(r, c, dentro && (borda || centro));
      }
    }
  }
  // temporização
  for (let i = 8; i < tam - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // alinhamento (uma única ocorrência nas versões 2..6)
  const pos = VERSOES[versao].alinhamento;
  if (pos) {
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const anel = Math.max(Math.abs(i), Math.abs(j));
        set(pos + i, pos + j, anel !== 1);
      }
    }
  }
  // módulo sempre escuro + reserva das áreas de formato
  set(4 * versao + 9, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!fixo[i][8]) set(i, 8, false);
    if (!fixo[8][i]) set(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!fixo[8][tam - 1 - i]) set(8, tam - 1 - i, false);
    if (!fixo[tam - 1 - i][8]) set(tam - 1 - i, 8, false);
  }
  return { m, fixo, tam };
}

/** Percurso em ziguezague, de baixo para cima, duas colunas por vez. */
function colocarDados(m, fixo, tam, sequencia, remanescentes) {
  const bits = [];
  for (const cw of sequencia) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  for (let i = 0; i < remanescentes; i++) bits.push(0);
  let k = 0;
  let subindo = true;
  for (let col = tam - 1; col > 0; col -= 2) {
    if (col === 6) col--;                       // coluna de temporização
    for (let n = 0; n < tam; n++) {
      const linha = subindo ? tam - 1 - n : n;
      for (const c of [col, col - 1]) {
        if (fixo[linha][c]) continue;
        m[linha][c] = k < bits.length ? bits[k] : 0;
        k++;
      }
    }
    subindo = !subindo;
  }
}

/** Penalidades da norma (N1..N4) para escolher a máscara. */
function penalidade(m, tam) {
  let p = 0;
  const linhaCol = (get) => {
    for (let i = 0; i < tam; i++) {
      let run = 1;
      for (let j = 1; j < tam; j++) {
        if (get(i, j) === get(i, j - 1)) {
          run++;
        } else {
          if (run >= 5) p += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) p += 3 + (run - 5);
    }
  };
  linhaCol((i, j) => m[i][j]);
  linhaCol((i, j) => m[j][i]);

  for (let i = 0; i < tam - 1; i++) {
    for (let j = 0; j < tam - 1; j++) {
      const v = m[i][j];
      if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) p += 3;
    }
  }

  // N3 (edição de 2015): padrão 1:1:3:1:1 — dark,light,dark×3,light,dark —
  // precedido OU seguido de área clara de 4 módulos; a borda do símbolo
  // vale como área clara.
  const alvo = [1, 0, 1, 1, 1, 0, 1];
  const ocorrencias = (seq) => {
    let total = 0;
    let i = 0;
    while (i + 7 <= tam) {
      let idx = -1;
      for (let k = i; k + 7 <= tam; k++) {
        let igual = true;
        for (let d = 0; d < 7; d++) if (seq[k + d] !== alvo[d]) { igual = false; break; }
        if (igual) { idx = k; break; }
      }
      if (idx < 0) break;
      const antes = seq.slice(Math.max(0, idx - 4), idx);
      const depois = seq.slice(idx + 7, Math.min(tam, idx + 11));
      const claroAntes = antes.every((v) => v === 0);
      const claroDepois = depois.every((v) => v === 0);
      if (idx === 0 || idx === tam - 7 || claroAntes || claroDepois) {
        total += 40;
        i = idx + 7;
      } else {
        i = idx + 4;    // pode haver outra ocorrência dentro do próprio padrão
      }
    }
    return total;
  };
  for (let i = 0; i < tam; i++) {
    p += ocorrencias(m[i]);
    p += ocorrencias(m.map((linha) => linha[i]));
  }

  let escuros = 0;
  for (let i = 0; i < tam; i++) for (let j = 0; j < tam; j++) escuros += m[i][j];
  const pct = (100 * escuros) / (tam * tam);
  p += 10 * Math.floor(Math.abs(pct - 50) / 5);
  return p;
}

/** Informação de formato: BCH(15,5) + máscara 0x5412, nas duas cópias. */
function gravarFormato(m, tam, mascara) {
  const dados = (0b00 << 3) | mascara;         // 0b00 = nível M
  let bch = dados << 10;
  for (let i = 4; i >= 0; i--) {
    if ((bch >> (i + 10)) & 1) bch ^= 0x537 << i;
  }
  const fmt = ((dados << 10) | bch) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1;
    if (i < 6) m[i][8] = bit;
    else if (i < 8) m[i + 1][8] = bit;
    else if (i === 8) m[8][7] = bit;
    else m[8][14 - i] = bit;

    if (i < 8) m[8][tam - 1 - i] = bit;
    else m[tam - 15 + i][8] = bit;
  }
}

/**
 * Matriz do QR Code de `texto` (true = módulo escuro), ou null se o texto
 * não couber nas versões cobertas. `mascaraFixa` existe para a conferência
 * contra a implementação de referência (scripts/qr-verificar.mjs).
 */
export function qrMatriz(texto, { mascaraFixa = null } = {}) {
  const bytes = [...new TextEncoder().encode(texto)];
  for (const versao of Object.keys(VERSOES).map(Number)) {
    const info = VERSOES[versao];
    const nDados = info.total - info.ecPorBloco * info.blocos;
    if (bytes.length > Math.floor((nDados * 8 - 12) / 8)) continue;

    const sequencia = sequenciaFinal(fluxoDeBits(bytes, nDados), info);
    const { m, fixo, tam } = matrizBase(versao);
    colocarDados(m, fixo, tam, sequencia, versao === 1 ? 0 : 7);

    // A máscara escolhida é a de menor penalidade. A avaliação é feita ANTES
    // de gravar a informação de formato — leitura de 7.8 da norma de 2015
    // (a máscara se aplica à região de codificação, não ao formato), a mesma
    // adotada pela implementação de referência usada na conferência.
    let melhor = null;
    for (let mascara = 0; mascara < 8; mascara++) {
      if (mascaraFixa !== null && mascara !== mascaraFixa) continue;
      const teste = m.map((linha) => [...linha]);
      for (let i = 0; i < tam; i++) {
        for (let j = 0; j < tam; j++) {
          if (!fixo[i][j] && MASCARAS[mascara](i, j)) teste[i][j] ^= 1;
        }
      }
      const p = penalidade(teste, tam);
      if (!melhor || p < melhor.p) melhor = { p, teste, mascara };
    }
    gravarFormato(melhor.teste, tam, melhor.mascara);
    return melhor.teste.map((linha) => linha.map((v) => v === 1));
  }
  return null;
}

/**
 * QR Code desenhado para o terminal, com meio-bloco (duas linhas por
 * caractere) e cores explícitas — assim a polaridade fica correta tanto em
 * terminal claro quanto escuro. Sem cor (NO_COLOR), usa blocos cheios.
 */
export function qrTerminal(texto, { cor = !process.env.NO_COLOR } = {}) {
  const m = qrMatriz(texto);
  if (!m) return null;
  const borda = 4;                              // zona de silêncio exigida
  const tam = m.length + 2 * borda;
  const escuro = (i, j) => {
    const r = i - borda, c = j - borda;
    return r >= 0 && c >= 0 && r < m.length && c < m.length ? m[r][c] : false;
  };
  const linhas = [];
  for (let i = 0; i < tam; i += 2) {
    let linha = '';
    for (let j = 0; j < tam; j++) {
      const cima = escuro(i, j);
      const baixo = i + 1 < tam ? escuro(i + 1, j) : false;
      if (cor) {
        // fundo = módulo de baixo, frente = módulo de cima (▀)
        linha += `\x1b[${baixo ? 40 : 47}m\x1b[${cima ? 30 : 37}m▀`;
      } else {
        linha += cima && baixo ? ' ' : cima ? '▄' : baixo ? '▀' : '█';
      }
    }
    linhas.push(cor ? linha + '\x1b[0m' : linha);
  }
  return linhas.join('\n');
}
