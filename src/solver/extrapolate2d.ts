/**
 * Extrapolação de velocidade para células de ar (§3.2.7).
 *
 * Depois da projeção, as faces dentro/perto da água têm valores válidos; as
 * faces no ar não. As partículas junto à superfície precisam amostrar um
 * campo contínuo, então propagamos os valores válidos camada por camada
 * (busca em largura): cada face inválida com vizinhos válidos recebe a média
 * deles. Ordem de varredura fixa → determinístico.
 */

export function extrapolateField(
  field: Float64Array, valid: Uint8Array,
  nxg: number, nyg: number, layers: number,
): void {
  const state = new Uint8Array(valid); // 1 = válido nesta rodada
  const next = new Uint8Array(valid.length);
  for (let layer = 0; layer < layers; layer++) {
    next.set(state);
    let changed = false;
    for (let j = 0; j < nyg; j++) {
      for (let i = 0; i < nxg; i++) {
        const k = i + j * nxg;
        if (state[k]) continue;
        let sum = 0;
        let n = 0;
        if (i > 0 && state[k - 1]) { sum += field[k - 1]; n++; }
        if (i + 1 < nxg && state[k + 1]) { sum += field[k + 1]; n++; }
        if (j > 0 && state[k - nxg]) { sum += field[k - nxg]; n++; }
        if (j + 1 < nyg && state[k + nxg]) { sum += field[k + nxg]; n++; }
        if (n > 0) {
          field[k] = sum / n;
          next[k] = 1;
          changed = true;
        }
      }
    }
    state.set(next);
    if (!changed) break;
  }
  // Faces que continuam sem informação ficam em zero
  for (let k = 0; k < field.length; k++) {
    if (!state[k]) field[k] = 0;
  }
}
