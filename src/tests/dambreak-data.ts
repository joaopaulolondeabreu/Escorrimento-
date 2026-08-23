/**
 * Dados experimentais de Martin & Moyce (1952), Part IV, Phil. Trans. R.
 * Soc. Lond. A 244(882), 312–324 — colapso de coluna d'água sobre plano
 * horizontal rígido. Caso n² = 2 (altura = 2a), base a = 2.25 in (0.05715 m).
 *
 * FONTE dos valores numéricos: digitalização da Figura 3 do paper original
 * feita pelo projeto PySPH (arquivo pysph/examples/db_exp_data.py, variável
 * mm_data_2): https://github.com/pypr/pysph . Digitalizações independentes
 * (Lethe/Polytechnique Montréal e Koshizuka & Oka 1996) concordam com esta
 * dentro de ~1–3%, que é a escala do erro de leitura dos gráficos.
 *
 * Convenção: T = t·√(2g/a); Z = z/a medido da parede vertical fixa
 * (Z = 1 em t = 0, borda frontal da coluna).
 *
 * Incerteza conhecida: a liberação da comporta (diafragma) não é
 * instantânea — a origem do tempo experimental é incerta em ΔT ≈ 0.15–0.25.
 * Seguindo a prática do projeto Lethe (time_correction = 0.175), o tempo da
 * SIMULAÇÃO é deslocado de +0.175 em T antes da comparação. O relatório de
 * validação mostra o erro com e sem esta correção.
 */

/** Pares [T, Z] — trecho confiável T ≲ 3.5 (o espalhamento cresce depois). */
export const MARTIN_MOYCE_N2_A225: Array<[number, number]> = [
  [0.832, 1.217],
  [1.219, 1.474],
  [1.997, 2.292],
  [2.547, 2.995],
  [3.345, 4.134],
];

/** Correção do atraso de liberação da comporta (prática do projeto Lethe). */
export const GATE_TIME_SHIFT = 0.175;
