# VALIDAÇÃO — resultados medidos × teoria

Gerado por `npm run validate` em 2026-08-24T11:18:39.801Z.
Todos os números abaixo são MEDIDOS pelas execuções desta máquina —
nenhum valor é copiado da teoria. Critérios da especificação §7.

## §7.1 Testes canônicos do solver

| Teste | Critério | Resultado | Situação |
|---|---|---|---|
| Repouso hidrostático | vel. espúria < 1e-3 m/s; perfil de pressão linear (inclinação ρg ± 0.5%, resíduo < 0.5%) | vel_espuria_max [m/s] = 2.464e-11; erro_inclinacao [%] = 0.00003556; residuo_max [%] = 0.0001867; y_superficie_implicita [m] = 0.4; celulas_verificadas = 37 | ✅ PASSA |
| Divergência pós-projeção | máx |∇·u|·Δx/|u|max < 1e-4 após a projeção | divergencia_normalizada_max = 8.366e-7 | ✅ PASSA |
| Conservação de massa | deriva de massa < 1% em 30 s de sloshing | deriva_max [%] = 0; particulas_final = 6400; reseed_add = 579; reseed_rem = 0 | ✅ PASSA |
| Escoamento de Poiseuille | perfil parabólico com erro L2 < 2% (canal no-slip) | erro_L2 [%] = 0.03343; u_max_medido [m/s] = 0.0512; u_max_teorico [m/s] = 0.0512 | ✅ PASSA |
| Vórtice de Taylor–Green | taxa de decaimento da amplitude do modo dentro de 5% de 2νπ²/L² (ν de referência 0.02 m²/s) | taxa_medida [1/s] = 0.4071; taxa_teorica [1/s] = 0.3948; erro_relativo [%] = 3.124; amplitude_final = 0.6656 | ✅ PASSA |
| | _Com ν nominal da água (1e-6), a dissipação numérica de transporte do FLIP/APIC domina o decaimento físico em qualquer resolução praticável — por isso o teste usa viscosidade de referência elevada, como o de Poiseuille. A dissipação numérica residual é reportada em VALIDACAO.md._ | | |
| Ruptura de barragem (Martin & Moyce 1952) | erro MÉDIO da posição da frente < 8% vs dados experimentais (com correção do atraso da comporta, ΔT=0.175); erro máximo por ponto também reportado | erro_medio_com_correcao [%] = 6.893; erro_max_com_correcao [%] = 9.007; erro_max_sem_correcao [%] = 19.81; pontos_comparados = 5 | ✅ PASSA |
| | _A comporta do experimento não abre instantaneamente (incerteza ΔT ≈ 0.15–0.25); o deslocamento fixo ΔT = 0.175 segue a prática do projeto Lethe. O erro máximo é dominado pelo ponto T≈1.22, onde digitalizações independentes da mesma figura divergem ~3% entre si. A simulação é sistematicamente ~5% mais RÁPIDA que o experimento — consistente com a ausência de comporta e de camada-limite real._ | | |
| Determinismo | duas execuções com os mesmos parâmetros → estado idêntico | hash_execucao_1 = 728600; hash_execucao_2 = 728600; particulas_1 = 1500; particulas_2 = 1500 | ✅ PASSA |

## Problema-alvo em 2D (corte longitudinal)

**Advertência (§4.1):** em 2D a água excedente não pode contornar o
tubo lateralmente — com os padrões da especificação o tubo bloqueia
D/profundidade = 83% do canal, forma-se onda de proa com galgamento e
o escoamento oscila. Os números 2D abaixo (média dos últimos 2 s) são
reportados para documentar essa distorção; a comparação quantitativa
com a teoria é o modo 3D (§7.2).

| Grandeza (por metro de largura) | Medido 2D | Teoria | Desvio |
|---|---|---|---|
| v no bocal [m/s] | 5.44 | 6.66 | -18.4% |
| φ [m²/s] | 1.401 | 1.665 | -15.9% |
| P_C − P₀ na sonda [kPa] (teoria ρg(H+d_C), d_C=0.127 m) | 31.00 | 11.04 | +180.8% |
| A_c/A | 0.65 | 0.83 | -22.4% |
| F [kN/m] | 26.45 | 13.30 | +98.9% |

## §7.2 Problema-alvo em 3D (geometria cilíndrica, free-slip, ν nominal)

Grade 92 células no comprimento (Δx ≈ 4.1 cm ⇒ D/Δx ≈ 9.7 células no diâmetro);
média temporal em regime permanente com dreno no reservatório.

**Geometria de validação** (difere dos padrões da UI — justificativas em
`src/solver/intake3d.ts`): D = 0.4 m com cotovelo R = 0.3 m e canal de
0.55 m. Com o orçamento de CPU, um duto de 0.25 m teria ~5 células no
diâmetro e a perda de carga NUMÉRICA domina (medimos K ≈ 2–4 nessa
configuração: v ~40% abaixo e P_C acima de ρgH — assinatura de duto
sub-resolvido). As fórmulas testadas independem de D (v, P_C, V_min) ou
escalam com A = πD²/4 (φ, F, A_c/A).

| V [m/s] | v med | v teo | erro (tol ±3%) | φ med | φ teo | erro (±5%) | P_C−P₀ med [kPa] | teo | erro (±5%) | A_c/A med | teo | erro (±8%) | F med [N] | teo | erro (±8%) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 1.48 | 2.32 | -36.2% ❌ | 0.1869 | 0.2915 | -35.9% ❌ | 14.25 | 12.38 | +15.1% ❌ | 0.32 | 0.46 | -30.9% ❌ | 2127 | 1454 | +46.2% ❌ |
| 6 | 2.59 | 4.05 | -35.9% ❌ | 0.3276 | 0.5086 | -35.6% ❌ | 17.34 | 12.38 | +40.0% ❌ | 0.46 | 0.67 | -31.2% ❌ | 3313 | 3045 | +8.8% ❌ |
| 8 | 5.23 | 6.66 | -21.6% ❌ | 0.6598 | 0.8372 | -21.2% ❌ | 23.77 | 12.38 | +92.0% ❌ | 0.61 | 0.83 | -27.3% ❌ | 6602 | 6684 | -1.2% ✅ |
| 10 | 6.47 | 8.97 | -27.8% ❌ | 0.8172 | 1.1266 | -27.5% ❌ | 34.44 | 12.38 | +178.1% ❌ | 0.59 | 0.90 | -33.8% ❌ | 8815 | 11244 | -21.6% ❌ |
| 12 | 7.83 | 11.15 | -29.8% ❌ | 0.9879 | 1.4015 | -29.5% ❌ | 48.64 | 12.38 | +292.7% ❌ | 0.59 | 0.93 | -36.0% ❌ | 12296 | 16784 | -26.7% ❌ |
| 15 | 9.80 | 14.33 | -31.6% ❌ | 1.2375 | 1.8009 | -31.3% ❌ | 72.70 | 12.38 | +487.0% ❌ | 0.60 | 0.96 | -36.9% ❌ | 18588 | 26959 | -31.1% ❌ |

**Constância de P_C − P₀ com V** (o teste conceitual central — §1.2): desvio
padrão relativo medido = **57.7%** (critério < 3%) ❌;
média 35.19 kPa vs ρgH = 12.38 kPa.

**V_min** (por ajuste linear de φ² vs V², extrapolando φ → 0):
medido **3.88 m/s** vs teoria √(2gH) = 4.43 m/s
(erro -12.3%, critério ±5%) ❌.

| Diagnóstico | Valor |
|---|---|
| V=5: divergência máx normalizada | 1.1e-6 |
| V=5: tubo vertical cheio | 100% |
| V=5: pressão mínima absoluta | 89.9 kPa  |
| V=6: divergência máx normalizada | 9.4e-7 |
| V=6: tubo vertical cheio | 100% |
| V=6: pressão mínima absoluta | 78.1 kPa  |
| V=8: divergência máx normalizada | 1.0e-6 |
| V=8: tubo vertical cheio | 81% |
| V=8: pressão mínima absoluta | 71.1 kPa  |
| V=10: divergência máx normalizada | 6.5e-7 |
| V=10: tubo vertical cheio | 79% |
| V=10: pressão mínima absoluta | 31.7 kPa  |
| V=12: divergência máx normalizada | 6.6e-7 |
| V=12: tubo vertical cheio | 78% |
| V=12: pressão mínima absoluta | -24.6 kPa ⚠ cavitação (não modelada) |
| V=15: divergência máx normalizada | 6.4e-7 |
| V=15: tubo vertical cheio | 77% |
| V=15: pressão mínima absoluta | -285.8 kPa ⚠ cavitação (não modelada) |

**Interpretação dos desvios (§12.1 — reportados, não ajustados).** Os
critérios do §7.2 NÃO são atendidos nesta resolução de CPU, e a causa é
identificável: com D/Δx ≈ 9,7 células no diâmetro, a camada-limite no duto
não é resolvida e a perda de carga numérica equivale a um coeficiente
K ≈ 0,8–1,4 (medido; ver HUD). Isso explica o padrão coerente das falhas:
v e φ ficam ~20–36% abaixo do limite invíscido; a energia cinética que
deixa de ser convertida em velocidade aparece como pressão no cotovelo,
por isso P_C−P₀ CRESCE com V (aprox. como fração de ½ρV²) em vez de
permanecer em ρgH — a constância de P_C, teste conceitual central, é o
que mais sofre (rsd 57,7%). Os pontos V=12 e V=15 apresentam pressões
absolutas negativas em bolsões de recirculação (cavitação não modelada),
então seus números devem ser lidos como qualitativos. O único critério
atendido (F em V=8, −1,2%) não deve ser lido como validação — é um
cruzamento fortuito entre dois vieses de sinais opostos. Nenhuma
constante foi ajustada para aproximar os números da teoria; o caminho
legítimo para atender §7.2 é resolução maior (D/Δx ≳ 30, viável com o
solver WebGPU em GPU dedicada), não calibração.

## Notas de honestidade científica (§7.3)

1. **LES, não DNS**: Re ≈ 2×10⁶; a turbulência de submalha é modelada
   (Smagorinsky) e a dissipação numérica de transporte do FLIP/APIC é
   mensurável (ver teste de Taylor–Green: com ν nominal da água o
   decaimento numérico domina o físico em qualquer resolução viável).
2. **2D ≠ 3D** para a fração captada (bloqueio lateral) — tabela 2D acima.
3. **Sem arrastamento de ar** (fase gasosa = vazio a pressão constante);
   a espuma real é subestimada.
4. **No-slip** reduz v abaixo de √(V²−2gH) por perdas viscosas e do
   cotovelo — esperado; a fórmula analítica é o limite invíscido.
5. **Cavitação não modelada** — apenas aviso quando P < 2.34 kPa.
6. Dam break: dados de Martin & Moyce digitalizados da Fig. 3 do paper
   original (PySPH); incerteza da comporta ΔT ≈ 0.15–0.25 tratada com o
   deslocamento fixo do projeto Lethe (0.175). Fontes em dambreak-data.ts.

_Tempo total de validação: 3.7 min._
