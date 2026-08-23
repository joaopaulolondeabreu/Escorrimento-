# Física da Captação de Água por uma Locomotiva em Movimento

**Derivação completa do problema do "track pan" (caixa d'água entre trilhos)**

---

## Enunciado do modelo

Uma locomotiva viaja com velocidade constante $V$ sobre trilhos horizontais e retilíneos. Entre os trilhos há um canal raso, longo, contendo água em repouso em relação à Terra. A locomotiva carrega um tubo rígido em forma de L:

- a extremidade **C**, aberta, fica submersa no canal e voltada para a frente (contra o movimento relativo da água);
- o cotovelo **B** faz uma curva de $90^\circ$;
- o bocal de saída **A** fica a uma altura $H$ acima do nível livre da água do canal e despeja em um reservatório aberto (à pressão atmosférica) montado no trem.

Dados e convenções usados ao longo do documento:

| Símbolo | Significado | Valor |
|---|---|---|
| $\rho$ | massa específica da água | $998\ \mathrm{kg/m^3}$ |
| $g$ | aceleração da gravidade | $9{,}81\ \mathrm{m/s^2}$ |
| $P_0$ | pressão atmosférica | — |
| $D$ | diâmetro interno do tubo | $0{,}25\ \mathrm{m}$ |
| $A$ | área interna do tubo, $A = \pi D^2/4$ | $\approx 4{,}909 \times 10^{-2}\ \mathrm{m^2}$ |
| $H$ | altura do bocal A acima do nível do canal | — |
| $V$ | velocidade do trem (constante) | — |
| $v$ | velocidade da água **no interior do tubo**, medida no referencial do trem | — |
| $z$ | cota vertical, com origem $z=0$ no nível livre do canal | — |

Hipóteses do modelo ideal (revisadas criticamente na Seção 11):

1. fluido **ideal** (invíscido) e **incompressível** ($\rho$ constante);
2. escoamento **permanente** no referencial adequado (Seção 1);
3. canal largo e profundo o bastante para que o nível livre não se altere apreciavelmente e a submersão de C seja rasa (desprezamos a profundidade de C frente a $H$);
4. tubo de seção constante $A$ de C até A, completamente cheio de água (escoamento afogado);
5. sem arrastamento de ar, sem ondas de superfície, sem cavitação.

---

## 1. Escolha do referencial

### 1.1 O referencial do trem é inercial

O trem move-se com velocidade **constante** $V$ (módulo, direção e sentido fixos). Um referencial que translada uniformemente em relação a um referencial inercial (a Terra, com excelente aproximação) é também inercial: nele não aparecem forças fictícias ($\vec{a}_{\text{arrastamento}} = 0$, $\vec{\omega} = 0$). Portanto **todas as leis da mecânica dos fluidos valem no referencial do trem sem nenhum termo adicional** — em particular a equação de Bernoulli na sua forma usual.

### 1.2 Só no referencial do trem o escoamento é permanente

A equação de Bernoulli na forma estacionária,

$$
P + \tfrac{1}{2}\rho u^2 + \rho g z = \text{constante ao longo de uma linha de corrente},
\tag{1}
$$

é a integral da equação de Euler ao longo de uma linha de corrente **sob a hipótese $\partial \vec{u}/\partial t = 0$**. Essa hipótese seleciona o referencial:

- **No referencial da Terra** o escoamento é *transiente*: em cada ponto fixo do canal, a água está em repouso até o tubo chegar, é violentamente perturbada durante a passagem e depois relaxa. O campo de velocidade em um ponto fixo depende do tempo, e Bernoulli estacionária **não se aplica**.
- **No referencial do trem** a geometria (tubo, boca C, bocal A) está parada, e o padrão de escoamento em torno dela não muda no tempo: a água da corrente livre chega por todo lado com velocidade uniforme $V$ **dirigida para trás**, as paredes do tubo estão em repouso, e o leito do canal desliza para trás com velocidade $V$. Cada ponto do espaço vê sempre a mesma velocidade: $\partial \vec{u}/\partial t = 0$.

Conclusão: o referencial do trem é, ao mesmo tempo, **inercial** (porque $V$ é constante) e o **único em que o escoamento é permanente**. Toda a análise por Bernoulli será feita nele. Voltaremos ao referencial da Terra apenas na Seção 7 (força) e na Seção 8 (balanço de energia), onde o teorema do impulso torna o cálculo mais transparente.

---

## 2. Bernoulli entre a corrente livre e o bocal A

### 2.1 A linha de corrente utilizada

No referencial do trem, considere uma partícula de fluido que, muito a montante (longe da boca C), viaja horizontalmente para trás com velocidade $V$, à pressão da corrente livre. Como a submersão de C é rasa (hipótese 3), essa partícula está praticamente no nível $z = 0$ e sua pressão é a atmosférica, $P_0$ (a correção hidrostática da lâmina d'água acima dela é desprezível frente a $\rho g H$ e a $\tfrac12 \rho V^2$).

Essa partícula pertence ao **tubo de corrente capturado** (Seção 5): ela desacelera ao se aproximar de C, entra no tubo, faz a curva no cotovelo B, sobe o trecho vertical e sai pelo bocal A, à altura $z = H$, como jato livre. Um jato que desemboca na atmosfera tem, na seção de saída, pressão igual à atmosférica:

$$
P_A = P_0 .
\tag{2}
$$

(Justificativa: as linhas de corrente na saída são retas e paralelas; sem curvatura não há gradiente de pressão transversal, e na borda do jato a pressão é $P_0$; logo é $P_0$ em toda a seção.)

### 2.2 Aplicação de Bernoulli

Aplicando a Eq. (1) entre o ponto de partida (corrente livre: $P = P_0$, $u = V$, $z = 0$) e a saída A ($P = P_0$, $u = v$, $z = H$), ao longo da linha de corrente descrita:

$$
P_0 + \tfrac{1}{2}\rho V^2 + \rho g \cdot 0 \;=\; P_0 + \tfrac{1}{2}\rho v^2 + \rho g H .
\tag{3}
$$

As hipóteses invocadas são exatamente as do modelo ideal: fluido invíscido (sem perdas por atrito no tubo nem no cotovelo), incompressível, escoamento permanente (garantido pela escolha do referencial), ao longo de uma linha de corrente contínua da corrente livre até A.

Cancelando $P_0$ dos dois lados:

$$
\tfrac{1}{2}\rho V^2 = \tfrac{1}{2}\rho v^2 + \rho g H .
$$

Dividindo por $\tfrac12 \rho$:

$$
V^2 = v^2 + 2 g H
\quad\Longrightarrow\quad
v^2 = V^2 - 2 g H ,
$$

$$
\boxed{\; v = \sqrt{V^2 - 2 g H\,} \;}
\tag{4}
$$

Leitura física: da "carga cinética" disponível $\tfrac12 V^2$ (por unidade de massa), uma parte $gH$ é gasta para erguer a água até o bocal; o que sobra, $\tfrac12 v^2 = \tfrac12 V^2 - gH$, permanece como energia cinética do jato.

---

## 3. Velocidade mínima de captação

A Eq. (4) só fornece $v$ real se o radicando for não negativo:

$$
V^2 - 2gH \ge 0 .
$$

No limiar, $v \to 0$: a água chega ao bocal com velocidade nula e a captação cessa. A velocidade mínima do trem para haver captação é, portanto,

$$
\boxed{\; V_{\min} = \sqrt{2 g H\,} \;}
\tag{5}
$$

Interpretação: $\tfrac12 V_{\min}^2 = gH$ — toda a carga cinética da corrente livre é convertida em carga de elevação, sem sobra. É o mesmo resultado de Torricelli lido ao contrário: $V_{\min}$ é a velocidade que um corpo adquire caindo da altura $H$. Exemplo numérico: para $H = 3\ \mathrm{m}$, $V_{\min} = \sqrt{2 \times 9{,}81 \times 3} \approx 7{,}67\ \mathrm{m/s} \approx 27{,}6\ \mathrm{km/h}$.

Para $V < V_{\min}$ não há escoamento permanente para cima: a coluna d'água não alcança o bocal.

---

## 4. Continuidade e vazão

### 4.1 O tubo permanece completamente cheio

Para $V > V_{\min}$ o escoamento é afogado: o tubo, de C até A, está integralmente preenchido por água (hipótese 4, consistente com a solução — a pressão no interior, Eq. (10), permanece acima de $P_0$, de modo que não há tendência de o ar invadir o tubo por A, nem formação de bolsões).

### 4.2 Continuidade: a velocidade não varia dentro do tubo

Para escoamento permanente e incompressível, a vazão volumétrica é a mesma em toda seção transversal do tubo:

$$
\varphi = A_1 u_1 = A_2 u_2 = \text{constante}.
\tag{6}
$$

Como a seção é **constante** ($A_1 = A_2 = A$) de C até A, segue imediatamente

$$
u_1 = u_2 = v \quad \text{em toda parte dentro do tubo}.
$$

Este ponto merece ênfase, porque é uma fonte comum de erro: **dentro do tubo o módulo da velocidade é o mesmo $v$ em todas as cotas** — na boca C, no cotovelo B e no bocal A. A água não "vai perdendo velocidade" ao subir. O que varia com a altura é a **pressão** (Seção 6): é o gradiente de pressão interno que sustenta o peso da coluna, mantendo o módulo da velocidade constante (no trecho vertical apenas a direção da velocidade já foi ajustada pelo cotovelo; o módulo permanece $v$).

### 4.3 Vazão captada

A vazão volumétrica captada pelo trem é a vazão que atravessa qualquer seção do tubo, por exemplo o bocal A:

$$
\boxed{\; \varphi = A\, v = A \sqrt{V^2 - 2 g H\,} \;}
\tag{7}
$$

com $A = \pi D^2/4 = \pi (0{,}25)^2/4 \approx 4{,}909 \times 10^{-2}\ \mathrm{m^2}$. A vazão mássica correspondente é $\dot m = \rho \varphi$.

---

## 5. O tubo de corrente capturado — o ponto conceitual central

### 5.1 A água NÃO entra em C com velocidade $V$

É tentador (e errado) supor que a água atravessa a boca C com a velocidade da corrente livre, $V$, o que daria a vazão "ingênua" $\varphi_{\text{ingênua}} = A V$. Isso violaria a continuidade: acabamos de mostrar que a velocidade em **toda** seção interna do tubo — inclusive na própria boca C — é $v = \sqrt{V^2 - 2gH} < V$.

O que realmente acontece: a informação de que há um tubo cheio à frente propaga-se corrente acima através do campo de **pressão**. A montante de C forma-se uma região de pressão elevada (Eq. 9) que **desacelera a água antes de ela entrar**, ainda na água livre, de $V$ (longe) até $v$ (na boca). A desaceleração ocorre fora do tubo, ao longo de uma distância da ordem de alguns diâmetros; ao cruzar o plano de C a água já está a $v$.

### 5.2 Geometria do tubo de corrente: $A_c/A = v/V$

Defina o **tubo de corrente capturado** como o feixe de linhas de corrente que termina dentro do tubo. Muito a montante ele tem seção reta $A_c$ e velocidade uniforme $V$; na boca C ele preenche a seção $A$ com velocidade $v$. A conservação da massa (fluido incompressível) entre essas duas seções do mesmo tubo de corrente dá

$$
A_c\, V = A\, v ,
$$

$$
\boxed{\; \frac{A_c}{A} = \frac{v}{V} = \sqrt{1 - \frac{2gH}{V^2}} \;<\; 1 \;}
\tag{8}
$$

Ou seja, o tubo de corrente capturado é **mais estreito longe** ($A_c$) e **"engorda"** até $A$ ao chegar à boca — exatamente como o tubo de corrente que se aproxima de um ponto de estagnação, só que aqui a desaceleração para em $v$ em vez de ir a zero. A área lateral desse tubo de corrente é uma superfície divisora: a água **fora** dela (a "água excedente", que ocuparia a fração $1 - v/V$ da seção $A$ se tudo entrasse a $V$) é defletida e **contorna a boca** por fora, passando ao lado e por baixo do tubo, e segue no canal.

Casos-limite que conferem a fórmula:

- $H \to 0$: $v \to V$, $A_c \to A$ — o tubo engole um cilindro de água do seu próprio calibre, sem perturbação;
- $V \to V_{\min}$: $v \to 0$, $A_c \to 0$ — o tubo de corrente capturado colapsa; quase toda a água contorna a boca e nada é captado. A boca C comporta-se então como um tubo de Pitot: pura estagnação.

### 5.3 Por que este é o ponto central

Todos os resultados quantitativos do problema — vazão (7), pressão em C (9), força (12), potência (13) — dependem de reconhecer que a variável dinâmica é $v$, fixada pelo balanço energético (4), e **não** $V$. O papel de $V$ é duplo: fornece a carga disponível $\tfrac12 V^2$ e fixa a velocidade da corrente livre; mas a vazão é $A v$, não $A V$. A seleção de *quanta* água entra é feita a montante, pelo campo de pressão, e a Eq. (8) quantifica essa seleção.

---

## 6. Pressão na boca C e perfil de pressão no tubo

### 6.1 $P_C$ por Bernoulli pelo interior do tubo

Aplique Bernoulli (1) entre a boca C ($z \approx 0$, velocidade $v$, pressão $P_C$) e o bocal A ($z = H$, velocidade $v$, pressão $P_0$), ao longo de uma linha de corrente que percorre o **interior** do tubo:

$$
P_C + \tfrac{1}{2}\rho v^2 + \rho g \cdot 0 \;=\; P_0 + \tfrac{1}{2}\rho v^2 + \rho g H .
$$

Os termos cinéticos são **idênticos** (mesma velocidade $v$ nos dois pontos, Seção 4.2) e cancelam:

$$
\boxed{\; P_C - P_0 = \rho g H \;}
\tag{9}
$$

A diferença de pressão entre C e A é **puramente hidrostática**: é exatamente o peso, por unidade de área, da coluna de água interna de altura $H$. E — resultado notável — é **independente de $V$**.

*Verificação de consistência* (pelo lado de fora): Bernoulli entre a corrente livre ($P_0$, $V$, $z=0$) e a boca C ($P_C$, $v$, $z=0$) dá $P_C = P_0 + \tfrac12\rho(V^2 - v^2) = P_0 + \tfrac12\rho\,(2gH) = P_0 + \rho g H$. Os dois caminhos coincidem, como deve ser em escoamento ideal.

### 6.2 Interpretação: $V$ aumenta a vazão, não a pressão em C

Por que $P_C$ não depende de $V$? A pressão em C é fixada **a jusante**, pela condição de contorno em A ($P_A = P_0$) somada ao peso da coluna interna: o tubo cheio exige $P_C = P_0 + \rho g H$ para sustentar a coluna, e ponto final. Quando $V$ aumenta, o excesso de carga dinâmica $\tfrac12\rho(V^2 - v^2)$ convertido na desaceleração externa continua valendo exatamente $\rho g H$ — o que muda é que a desaceleração parte de um $V$ maior e termina em um $v$ maior, com $V^2 - v^2 = 2gH$ fixo. O efeito de aumentar $V$ é, portanto, **aumentar $v$ e com ele a vazão** $\varphi = Av$ (e "engordar" o tubo de corrente capturado, Eq. 8), mantendo $P_C$ inalterada. A boca C **não** é um ponto de estagnação (exceto no limiar $V = V_{\min}$): a pressão ali é $P_0 + \rho g H$, em geral menor que a pressão de estagnação $P_0 + \tfrac12 \rho V^2$.

### 6.3 Perfil de pressão $P(z)$ no trecho vertical

No trecho vertical (entre o cotovelo B e o bocal A), tome um ponto genérico de cota $z$ ($0 \le z \le H$), onde a velocidade vale $v$ (Seção 4.2) e a pressão vale $P(z)$. Bernoulli entre esse ponto e A:

$$
P(z) + \tfrac{1}{2}\rho v^2 + \rho g z = P_0 + \tfrac{1}{2}\rho v^2 + \rho g H ,
$$

e, cancelando os termos cinéticos,

$$
\boxed{\; P(z) = P_0 + \rho g\,(H - z) \;}
\tag{10}
$$

O perfil é **linear em $z$** e idêntico ao de uma coluna hidrostática parada: máximo na base ($P(0) = P_0 + \rho g H$, coerente com a Eq. 9) e decrescendo até $P(H) = P_0$ na saída. Fisicamente: como o módulo da velocidade não muda ao longo do trecho vertical, a aceleração convectiva ali é nula, e a equação de Euler reduz-se localmente a $\mathrm{d}P/\mathrm{d}z = -\rho g$ — hidrostática pura, apesar de a água estar em movimento. Em nenhum ponto do trecho vertical a pressão cai abaixo de $P_0$: o modelo ideal não prevê pressões subatmosféricas no tubo (ver, porém, a Seção 11 sobre o cotovelo).

---

## 7. Força de arrasto sobre o trem

### 7.1 Por que calcular no referencial da Terra

Para a força, o referencial da Terra é o mais limpo, por duas razões:

1. **Estados inicial e final triviais**: no referencial da Terra a água capturada parte do repouso ($u = 0$, no canal) e termina movendo-se com o trem ($u = V$, em repouso no reservatório *relativo ao trem*). A variação de quantidade de movimento por unidade de tempo é imediata. No referencial do trem, ao contrário, a água entra a $V$ e o cálculo exigiria contabilizar o fluxo de quantidade de movimento das seções de entrada e saída e as pressões sobre toda a superfície de controle.
2. **É no referencial da Terra que a força tem a interpretação de interesse prático** — o arrasto extra que a locomotiva deve vencer e a potência que ela deve fornecer.

(O escoamento é transiente no referencial da Terra ponto a ponto, mas o teorema do impulso na forma "taxa de variação da quantidade de movimento do sistema material" não requer permanência; alternativamente, aplica-se o teorema em um volume de controle que acompanha o trem e traduz-se o resultado.)

### 7.2 Teorema do impulso

Considere, no referencial da Terra, a porção de água que é capturada durante um intervalo $\mathrm{d}t$. Sua massa é

$$
\mathrm{d}m = \rho\, \varphi\, \mathrm{d}t .
$$

Antes da captação ela está em repouso: quantidade de movimento horizontal inicial nula. Depois de embarcada (em repouso no reservatório em relação ao trem), ela se move com velocidade $V$: quantidade de movimento final $\mathrm{d}m \, V$. A força horizontal média que o trem (via tubo e reservatório) exerce sobre essa água é

$$
F_{\text{trem} \to \text{água}} = \frac{\mathrm{d}(mV)}{\mathrm{d}t} = \rho\, \varphi\, V .
\tag{11}
$$

Pela terceira lei de Newton, a água exerce sobre o trem uma força igual e oposta — dirigida **para trás**: é o arrasto de captação,

$$
\boxed{\; F = \rho\, \varphi\, V = \rho\, A\, V \sqrt{V^2 - 2 g H\,} \;}
\tag{12}
$$

Observação: a componente vertical (o peso da água içada e a deflexão do jato) é suportada pelos trilhos e não realiza trabalho no movimento horizontal; para a potência de tração só importa a componente horizontal (12). Note também que $F$ **cresce com $V$** por dois mecanismos: o fator explícito $V$ e o crescimento de $\varphi$ com $V$.

---

## 8. Potência e balanço de energia

### 8.1 Potência de tração

Como o ponto de aplicação da força move-se com o trem a velocidade $V$, a potência extra que a locomotiva desenvolve para captar água é

$$
\boxed{\; \Pi = F\,V = \rho\, \varphi\, V^2 \;}
\tag{13}
$$

### 8.2 Forma polinomial em $\varphi$

É útil exprimir $\Pi$ em função da vazão. Da Eq. (4), $V^2 = v^2 + 2gH$; e da Eq. (7), $v = \varphi/A$. Substituindo em (13), passo a passo:

$$
\Pi = \rho\,\varphi\,V^2
= \rho\,\varphi\,\left(v^2 + 2gH\right)
= \rho\,\varphi\,\left(\frac{\varphi^2}{A^2} + 2gH\right),
$$

$$
\boxed{\; \Pi(\varphi) = \frac{\rho}{A^2}\,\varphi^{3} + 2\,\rho g H\, \varphi \;}
\tag{14}
$$

O termo cúbico domina em alta vazão (custo de dar velocidade à água), o termo linear domina perto do limiar (custo associado à elevação). Note o fator **2** no termo linear: eleva-se a água gastando $\rho g H \varphi$, mas o processo cobra o dobro — o excedente é explicado pelo balanço a seguir.

### 8.3 Balanço de energia: para onde vai $\rho\varphi V^2$

Contabilizemos, por unidade de tempo, o destino da potência (13). Estado final da água captada: em repouso no reservatório (relativo ao trem), à altura $H$; no referencial da Terra, portanto, movendo-se a $V$.

**(a) Energia cinética no referencial da Terra.** A água embarcada, de vazão mássica $\rho\varphi$, passa a mover-se com o trem:

$$
\dot E_{c,\text{Terra}} = \tfrac{1}{2}\,\rho\,\varphi\,V^2
= \frac{\Pi}{2}.
\tag{15}
$$

**Exatamente metade** da potência fornecida vira energia cinética de translação da água.

**(b) Energia potencial gravitacional.** A água sobe de $z=0$ a $z=H$:

$$
\dot E_p = \rho\, \varphi\, g H .
\tag{16}
$$

**(c) Energia cinética no referencial do trem (o jato) — parcela dissipada.** Ao sair do bocal A, a água ainda carrega, no referencial do trem, a energia cinética do jato:

$$
\dot E_{c,\text{trem}} = \tfrac{1}{2}\,\rho\,\varphi\,v^2 .
\tag{17}
$$

Essa parcela **não permanece**: o jato sobe, recai e espalha-se no reservatório, e essa energia cinética relativa é integralmente dissipada em turbulência e calor quando a água atinge o repouso relativo ao trem. É a **parcela dissipada** do processo (no modelo ideal, a única).

**A soma fecha.** Somando (15), (16) e (17) e usando $\tfrac12 v^2 = \tfrac12 V^2 - gH$ (Eq. 4):

$$
\tfrac{1}{2}\rho\varphi V^2 + \rho\varphi gH + \tfrac{1}{2}\rho\varphi v^2
= \tfrac{1}{2}\rho\varphi V^2 + \rho\varphi gH + \rho\varphi\left(\tfrac{1}{2}V^2 - gH\right)
= \rho\varphi V^2 = \Pi . \checkmark
\tag{18}
$$

Em resumo:

$$
\underbrace{\rho\varphi V^2}_{\Pi}
= \underbrace{\tfrac{1}{2}\rho\varphi V^2}_{\substack{\text{cinética}\\ \text{(ref. Terra)}}}
+ \underbrace{\rho\varphi g H}_{\text{potencial}}
+ \underbrace{\tfrac{1}{2}\rho\varphi v^2}_{\substack{\text{cinética no ref. do trem}\\ \to\ \text{dissipada no reservatório}}} .
\tag{19}
$$

Note que a "outra metade" de $\Pi$ (isto é, $\tfrac12\rho\varphi V^2$) reparte-se entre o ganho potencial $\rho\varphi gH$ e a dissipação $\tfrac12\rho\varphi v^2$ — a repartição é exatamente a Eq. (3) lida no referencial do trem: a carga cinética que entra ($\tfrac12 V^2$) vira elevação ($gH$) mais jato ($\tfrac12 v^2$), sem perdas *dentro do tubo*.

### 8.4 A analogia com o capacitor e a colisão perfeitamente inelástica

O resultado (15) — *metade da energia fornecida vira energia cinética, aconteça o que acontecer com o resto* — é o mesmo de dois clássicos:

- **Carregamento de um capacitor por uma fonte de tensão constante**: a fonte fornece $QU$; o capacitor armazena $\tfrac12 QU$; a outra metade dissipa-se na resistência do circuito, **qualquer que seja** o valor da resistência.
- **Colisão perfeitamente inelástica** (ou o bloco puxado a velocidade constante que "engole" massa): ao acelerar massa do repouso até $V$ por meio de um agente que se move a velocidade constante $V$ ("arrasto"), o trabalho é $\dot m V \cdot V = \dot m V^2$, mas a energia cinética adquirida é só $\tfrac12 \dot m V^2$. A diferença é inevitavelmente perdida no escorregamento relativo entre o agente (a $V$) e a massa (que parte de $0$).

Aqui a estrutura é idêntica: a força de captação $F = \rho\varphi V$ é aplicada por um agente a velocidade constante $V$ sobre água que parte do repouso, logo metade de $\Pi$ vai obrigatoriamente para a energia cinética (Terra) e a outra metade fica "disponível" no referencial do trem. A sutileza instrutiva do track pan é que essa segunda metade **não é toda desperdiçada de imediato**: a desaceleração de $V$ para $v$ a montante de C é *reversível* (Bernoulli, sem perdas) e recupera parte dela como pressão, que paga a elevação $\rho\varphi gH$; só o resíduo $\tfrac12\rho\varphi v^2$ dissipa, no impacto do jato com o reservatório. No limite $H \to 0$ ($v \to V$) nada é recuperado e recai-se exatamente no caso da colisão inelástica: metade de $\Pi$ dissipada. No limite oposto $V \to V_{\min}$ ($v \to 0$), a segunda metade é integralmente convertida em energia potencial — o "carregamento" torna-se reversível, ao custo de vazão nula.

---

## 9. Altura do jato acima do bocal

Se o jato que sai de A for orientado verticalmente para cima (ou se se pergunta até onde a água "consegue subir"), cada partícula do jato, uma vez na atmosfera, está em queda livre (fluido ideal: sem resistência do ar; jato fino: pressão $P_0$ em toda parte). Por cinemática (ou por Bernoulli entre A e o ápice, onde $u = 0$ e $P = P_0$):

$$
P_0 + \tfrac{1}{2}\rho v^2 + \rho g H = P_0 + 0 + \rho g\,(H + h_{\text{jato}}) ,
$$

$$
\boxed{\; h_{\text{jato}} = \frac{v^2}{2g} = \frac{V^2 - 2gH}{2g} = \frac{V^2}{2g} - H \;}
\tag{20}
$$

Verificação elegante: $H + h_{\text{jato}} = V^2/(2g)$ — o ápice do jato atinge exatamente a **altura de carga total** da corrente livre, medida a partir do nível do canal. No modelo ideal, a água sobe até a altura ditada pela velocidade do trem, nem mais, nem menos — independentemente de como $H$ reparte o percurso entre tubo e voo livre.

---

## 10. Tabela-resumo das fórmulas

| # | Grandeza | Fórmula | Eq. | Observações |
|---|---|---|---|---|
| 1 | Velocidade no tubo (ref. do trem) | $v = \sqrt{V^2 - 2gH}$ | (4) | mesma em toda seção do tubo |
| 2 | Velocidade mínima do trem | $V_{\min} = \sqrt{2gH}$ | (5) | $v \to 0$; Torricelli invertido |
| 3 | Vazão volumétrica | $\varphi = A\,v = A\sqrt{V^2 - 2gH}$ | (7) | $A = \pi D^2/4 \approx 4{,}909\times10^{-2}\ \mathrm{m^2}$ |
| 4 | Vazão mássica | $\dot m = \rho\,\varphi$ | — | |
| 5 | Seção do tubo de corrente capturado | $A_c = A\,\dfrac{v}{V}$ | (8) | "engorda" de $A_c$ até $A$; excedente contorna C |
| 6 | Sobrepressão na boca C | $P_C - P_0 = \rho g H$ | (9) | **independente de $V$** |
| 7 | Perfil de pressão no trecho vertical | $P(z) = P_0 + \rho g\,(H - z)$ | (10) | hidrostático, apesar do movimento |
| 8 | Força de arrasto (ref. da Terra) | $F = \rho\,\varphi\,V$ | (12) | teorema do impulso |
| 9 | Potência de captação | $\Pi = \rho\,\varphi\,V^2$ | (13) | |
| 10 | Potência em função da vazão | $\Pi = \dfrac{\rho}{A^2}\varphi^3 + 2\rho g H\,\varphi$ | (14) | cúbico: cinética; linear: elevação ×2 |
| 11 | Balanço de energia | $\Pi = \tfrac12\rho\varphi V^2 + \rho\varphi gH + \tfrac12\rho\varphi v^2$ | (19) | metade → cinética (Terra); $\tfrac12\rho\varphi v^2$ dissipa |
| 12 | Altura do jato acima de A | $h_{\text{jato}} = \dfrac{v^2}{2g} = \dfrac{V^2}{2g} - H$ | (20) | ápice na altura de carga total |

---

## 11. Limites de validade do modelo ideal

O modelo acima é o esqueleto exato do fenômeno, mas cada hipótese ideal tem um custo real. Abaixo, cada efeito desprezado e **em que direção** ele desloca as previsões.

### 11.1 Perdas viscosas distribuídas e localizadas

Com viscosidade, Bernoulli entre a corrente livre e A ganha um termo de perda de carga $h_f \ge 0$:

$$
\tfrac{1}{2}\rho V^2 = \tfrac{1}{2}\rho v_{\text{real}}^2 + \rho g H + \rho g\, h_f ,
\qquad
v_{\text{real}} = \sqrt{V^2 - 2g\,(H + h_f)} \;<\; \sqrt{V^2 - 2gH} .
\tag{21}
$$

As parcelas dominantes de $h_f$:

- **atrito distribuído** no tubo (Darcy–Weisbach): $h_{f,\text{dist}} = f\,\dfrac{L}{D}\,\dfrac{v^2}{2g}$, com $f$ dado pelo diagrama de Moody (o escoamento é francamente turbulento: para $v \sim 10\ \mathrm{m/s}$ e $D = 0{,}25\ \mathrm{m}$, $Re = vD/\nu \sim 2{,}5\times 10^6$);
- **perda localizada no cotovelo B**: $h_{f,B} = K\,\dfrac{v^2}{2g}$, com coeficiente de perda $K$ tipicamente entre $\sim 0{,}3$ (curva de raio longo) e $\sim 1{,}1$ (joelho vivo a $90^\circ$) — em um captador real, o cotovelo é a perda singular dominante;
- perda de entrada em C (borda viva vs. boca-de-sino) e eventual difusor antes de A.

Consequências direcionais: $v_{\text{real}} < v_{\text{ideal}}$, logo $\varphi_{\text{real}} < A\sqrt{V^2 - 2gH}$; a velocidade mínima efetiva sobe, $V_{\min,\text{real}} = \sqrt{2g(H + h_f)} > \sqrt{2gH}$ (e, como $h_f$ cresce com $v$, o limiar é atingido suavemente); a altura real do jato cai, $h_{\text{jato,real}} < v_{\text{real}}^2/2g$ (perdas no ar somam-se às do tubo). Já a **pressão na boca C sobe**: refazendo a Seção 6 pelo interior do tubo com as perdas *a jusante de C*,

$$
P_C - P_0 = \rho g H + \rho g\, h_{f,\,C \to A} ,
\tag{22}
$$

isto é, C precisa de sobrepressão adicional para empurrar a água através do atrito do tubo e do cotovelo — a pressão em C continua $\approx \rho g H$ **mais as perdas**, e continua (aproximadamente) independente de $V$ apenas na medida em que $h_f$ dependa fracamente de $v$; rigorosamente, com perdas, $P_C$ passa a crescer (fracamente) com $V$ via $h_f(v)$.

### 11.2 Camada limite

Mesmo fora das perdas globais, a condição de não escorregamento cria uma **camada limite** nas paredes internas: o perfil de velocidade não é uniforme (mais rápido no eixo, nulo na parede), e os fluxos de quantidade de movimento e energia exigem fatores de correção ($\beta$, $\alpha > 1$) sobre as expressões de seção uniforme. No canal, a camada limite sobre o leito (que no referencial do trem se move a $V$) e a esteira em torno da boca alteram o campo próximo a C. Direção do efeito: pequena redução adicional de vazão efetiva e aumento do arrasto além de $\rho\varphi V$ (arrasto de forma e de fricção do captador mergulhado, ondas geradas no canal — no referencial da Terra o dispositivo é um corpo rombudo avançando na água a $V$).

### 11.3 Arrastamento de ar e efeitos de superfície livre

O modelo supõe o tubo afogado e sem ar. Na prática, a alta velocidade relativa na superfície do canal gera **spray, ondas e emulsionamento ar-água** na boca C; bolhas arrastadas reduzem a densidade média da mistura e a vazão útil, e a agitação no reservatório (o jato de $\tfrac12\rho\varphi v^2$ dissipando) provoca respingos e perda de parte da água captada — historicamente, a eficiência de captação dos track pans reais era bem inferior a 100%, com nuvens de spray visíveis. Direção: $\varphi_{\text{útil}} < \varphi$; arrasto adicional; o balanço (19) ganha um canal extra de dissipação.

### 11.4 Cavitação

Há risco de cavitação onde a pressão absoluta local cair abaixo da pressão de vapor da água, $P_{\text{vap}} \approx 2{,}34\ \mathrm{kPa}$ a $20\ ^\circ\mathrm{C}$. No modelo ideal unidimensional isso nunca ocorre — a Eq. (10) mantém $P \ge P_0$ em todo o tubo. O perigo está nos pontos de **aceleração local** que o modelo 1-D não vê: o **intradorso do cotovelo B** (a curvatura impõe gradiente de pressão transversal, $\partial P/\partial n = \rho u^2 / R$; a face interna da curva é o mínimo de pressão) e bordas vivas na boca C. Uma queda local da ordem de $\tfrac12 \rho\, u_{\text{loc}}^2$ com coeficiente de pressão $C_p \sim -1$ a $-2$ pode levar $P$ de $\sim P_0$ a valores próximos de $P_{\text{vap}}$ quando $v$ ultrapassa $\sim 10$–$14\ \mathrm{m/s}$ — plenamente alcançável em velocidades ferroviárias. Direção do efeito: bolhas de vapor no cotovelo bloqueiam parcialmente a seção (queda de $\varphi$), causam ruído, vibração e erosão do material, e invalidam localmente a hipótese de fase única.

### 11.5 Outras idealizações

- **Regime transiente de imersão**: a entrada e a saída do captador no canal (comprimento finito do track pan) são fases transitórias violentas — golpes de aríete no enchimento do tubo — fora do alcance da análise permanente;
- **Nível do canal**: a retirada de água e as ondas rebaixam localmente o nível, aumentando o $H$ efetivo;
- **Compressibilidade**: irrelevante para a água nessas velocidades ($Ma \sim 10^{-2}$), exceto nos transientes de golpe de aríete, onde a celeridade acústica domina.

### 11.6 Síntese direcional

| Efeito real | Previsão deslocada | Direção |
|---|---|---|
| Perdas viscosas (tubo + cotovelo $K$) | $v,\ \varphi,\ h_{\text{jato}}$ | diminuem: $v_{\text{real}} = \sqrt{V^2 - 2g(H+h_f)}$ |
| Perdas viscosas | $V_{\min}$ | aumenta: $\sqrt{2g(H + h_f)}$ |
| Perdas a jusante de C | $P_C - P_0$ | aumenta: $\rho g H + \rho g\,h_{f,C\to A}$ |
| Arrasto de forma / ondas / spray | $F,\ \Pi$ | aumentam além de $\rho\varphi V$, $\rho\varphi V^2$ |
| Arrastamento de ar, respingos | $\varphi_{\text{útil}}$ | diminui (eficiência de captação $<1$) |
| Cavitação no cotovelo ($P < P_{\text{vap}} \approx 2{,}34$ kPa) | $\varphi$; integridade do tubo | vazão cai; erosão/vibração; limite superior prático de $V$ |

O modelo ideal fornece, assim, um **teto** para $v$, $\varphi$ e $h_{\text{jato}}$, um **piso** para $V_{\min}$, $F$, $\Pi$ e $P_C$, e a estrutura conceitual exata — referencial do trem, seleção da vazão pelo campo de pressão a montante, pressão em C hidrostática e balanço de energia com metade compulsoriamente cinética — sobre a qual as correções reais se penduram como termos aditivos.
