/**
 * Testes do codificador de QR Code usado pelo modo celular (scripts/qr.mjs).
 *
 * Conferência externa feita durante o desenvolvimento (não repetida aqui para
 * o teste não depender de Python): 398 de 398 matrizes idênticas, módulo a
 * módulo, às de uma implementação independente (segno 1.6.6) nas versões 1 a 6,
 * com texto ASCII e UTF-8 — com duas ressalvas documentadas:
 *   • a referência acrescenta um byte 0x00 de enchimento quando o fluxo já
 *     termina em fronteira de codeword (7.4.10 manda completar só até a
 *     fronteira); a comparação foi feita com esse desvio corrigido;
 *   • a referência avalia as máscaras com a área de formato mascarada, o que
 *     muda a máscara escolhida em ~7% dos casos — aqui a comparação fixou a
 *     máscara. Qualquer das 8 máscaras gera um símbolo válido.
 * Além disso, 81 dos 83 símbolos gerados foram lidos por um decodificador
 * independente (OpenCV 5.0.0) — os 2 restantes também não são lidos quando
 * gerados pela implementação de referência (limitação do leitor).
 *
 * Os testes abaixo são autocontidos: matrizes douradas + leitura de volta.
 */
import { describe, expect, it } from 'vitest';
import { qrMatriz } from '../../scripts/qr.mjs';

/** Resumo FNV-1a da matriz, para detectar qualquer regressão silenciosa. */
function resumo(m: boolean[][]): string {
  const texto = m.map((l) => l.map((v) => (v ? '1' : '0')).join('')).join('\n');
  let h = 0x811c9dc5;
  for (const c of texto) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const MASCARAS = [
  (i: number, j: number) => (i + j) % 2 === 0,
  (i: number) => i % 2 === 0,
  (_i: number, j: number) => j % 3 === 0,
  (i: number, j: number) => (i + j) % 3 === 0,
  (i: number, j: number) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i: number, j: number) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i: number, j: number) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i: number, j: number) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/**
 * Leitor independente do que o codificador faz: descobre a máscara pela
 * informação de formato gravada na própria matriz, desfaz a máscara, percorre
 * a região de dados e devolve o texto — exercitando formato, máscara,
 * posicionamento e codificação de uma vez.
 */
function lerQr(m: boolean[][]): string {
  const tam = m.length;
  const versao = (tam - 17) / 4;

  // formato: 15 bits, XOR 0x5412; os 3 bits de máscara ficam logo abaixo do
  // nível de correção
  let fmt = 0;
  for (let i = 0; i < 15; i++) {
    let bit: boolean;
    if (i < 6) bit = m[i][8];
    else if (i < 8) bit = m[i + 1][8];
    else if (i === 8) bit = m[8][7];
    else bit = m[8][14 - i];
    if (bit) fmt |= 1 << i;
  }
  const mascara = ((fmt ^ 0x5412) >> 10) & 0b111;

  // módulos de função (não carregam dados)
  const fixo = Array.from({ length: tam }, () => new Array<boolean>(tam).fill(false));
  for (const [li, lj] of [[0, 0], [0, tam - 7], [tam - 7, 0]]) {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const r = li + i, c = lj + j;
        if (r >= 0 && c >= 0 && r < tam && c < tam) fixo[r][c] = true;
      }
    }
  }
  for (let i = 0; i < tam; i++) { fixo[6][i] = true; fixo[i][6] = true; }
  for (let i = 0; i < 9; i++) { fixo[i][8] = true; fixo[8][i] = true; }
  for (let i = 0; i < 8; i++) { fixo[8][tam - 1 - i] = true; fixo[tam - 1 - i][8] = true; }
  if (versao >= 2) {
    const pos = 4 * versao + 10;      // centro do padrão de alinhamento (v2..v6)
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) fixo[pos + i][pos + j] = true;
    }
  }

  const bits: number[] = [];
  let subindo = true;
  for (let col = tam - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let n = 0; n < tam; n++) {
      const linha = subindo ? tam - 1 - n : n;
      for (const c of [col, col - 1]) {
        if (fixo[linha][c]) continue;
        const mascarado = MASCARAS[mascara](linha, c) ? 1 : 0;
        bits.push((m[linha][c] ? 1 : 0) ^ mascarado);
      }
    }
    subindo = !subindo;
  }

  // codewords na ordem em que aparecem no símbolo
  const cw: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    cw.push(v);
  }
  // desintercalar: a partir da versão 4 os dados vêm em vários blocos
  // (nível M: v4 e v5 → 2 blocos; v6 → 4 blocos)
  const nDados = [16, 28, 44, 64, 86, 108][versao - 1];
  const blocos = [1, 1, 1, 2, 2, 4][versao - 1];
  const porBloco = nDados / blocos;
  const dados: number[] = [];
  for (let b = 0; b < blocos; b++) {
    for (let i = 0; i < porBloco; i++) dados.push(cw[i * blocos + b]);
  }

  const fluxo: number[] = [];
  for (const d of dados) for (let i = 7; i >= 0; i--) fluxo.push((d >> i) & 1);
  const leia = (inicio: number, n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | fluxo[inicio + i];
    return v;
  };
  expect(leia(0, 4)).toBe(0b0100);          // modo byte
  const n = leia(4, 8);
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = leia(12 + 8 * i, 8);
  return new TextDecoder().decode(bytes);
}

describe('Codificador de QR Code (modo celular)', () => {
  it('reproduz matrizes conferidas contra implementação independente', () => {
    expect(resumo(qrMatriz('A')!)).toBe('c1c17b7b');
    expect(resumo(qrMatriz('http://192.168.0.10:5173/')!)).toBe('db6438ce');
  });

  it('gera o tamanho certo por versão (21, 25, 29, … módulos)', () => {
    expect(qrMatriz('A')!.length).toBe(21);                       // versão 1
    expect(qrMatriz('http://192.168.0.10:5173/')!.length).toBe(25); // versão 2
    expect(qrMatriz('http://192.168.100.101:5173/')!.length).toBe(29); // versão 3
  });

  it('tem os três localizadores e a linha de temporização', () => {
    const m = qrMatriz('http://192.168.0.10:5173/')!;
    const tam = m.length;
    for (const [li, lj] of [[0, 0], [0, tam - 7], [tam - 7, 0]]) {
      expect(m[li][lj]).toBe(true);
      expect(m[li + 1][lj + 1]).toBe(false);
      expect(m[li + 3][lj + 3]).toBe(true);
    }
    for (let i = 8; i < tam - 8; i++) expect(m[6][i]).toBe(i % 2 === 0);
    expect(m[tam - 8][8]).toBe(true);            // módulo sempre escuro
  });

  it('a leitura de volta devolve exatamente o texto de origem', () => {
    const casos = [
      'A',
      'http://192.168.0.10:5173/',
      'http://10.0.0.5:5173/',
      'http://172.16.31.244:5173/',
      'http://192.168.100.101:5173/',
      'http://escorrimento.local:5173/simulador?modo=celular',
      'Escorrimento — captação de água (acentuação çãõ)',
    ];
    for (const texto of casos) expect(lerQr(qrMatriz(texto)!)).toBe(texto);
  });

  it('recusa texto acima da capacidade coberta (versão 6, nível M)', () => {
    expect(qrMatriz('x'.repeat(106))).not.toBeNull();
    expect(qrMatriz('x'.repeat(107))).toBeNull();
  });
});
