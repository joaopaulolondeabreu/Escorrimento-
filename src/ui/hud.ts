/**
 * HUD de medição (§6.2): tabela "medido × teoria × erro" ao vivo, com
 * suavização exponencial (as medições instantâneas oscilam com as ondas).
 * Inclui diagnósticos do solver e avisos de honestidade científica (§7.3).
 */

import type { FrameMsg, GeometryInfo } from '../app/protocol';
import type { IntakeParams } from '../solver/intake2d';
import {
  tubeVelocity, captureFraction, jetHeight, G_STANDARD,
} from '../physics/analytic';

const EMA_ALPHA = 0.06;

export class Hud {
  private root: HTMLElement;
  private ema = new Map<string, number>();
  private warned = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  private smooth(key: string, v: number): number {
    if (!Number.isFinite(v)) return this.ema.get(key) ?? 0;
    const prev = this.ema.get(key);
    const next = prev === undefined ? v : prev + EMA_ALPHA * (v - prev);
    this.ema.set(key, next);
    return next;
  }

  reset(): void {
    this.ema.clear();
  }

  update(frame: FrameMsg, p: IntakeParams, rho: number, geo: GeometryInfo | null): void {
    const m = frame.measurement;
    if (!m) return;
    const vT = tubeVelocity(p.V, p.H);
    const phiT = p.D * vT;                    // 2D: por metro de largura
    // P_C: a teoria é comparada NA POSIÇÃO DA SONDA. A fórmula ρgH vale no
    // limite de submersão rasa (§FISICA, hipótese 3); a sonda está a
    // d_C = (profundidade do canal − y_C) abaixo da superfície, onde
    // P(z) = P₀ + ρg(H − z) prevê ρg(H + d_C). Comparar contra ρgH puro
    // exibia um viés de +11–30% como se fosse erro do solver.
    const dC = geo ? Math.max(0, p.waterDepth - geo.yC) : 0;
    const pcT = rho * G_STANDARD * (p.H + dC);
    const acT = captureFraction(p.V, p.H);
    const fT = rho * phiT * p.V;
    const piT = fT * p.V;
    const hjT = jetHeight(p.V, p.H);

    const v = this.smooth('v', m.vNozzle);
    const phi = this.smooth('phi', m.flux);
    const pc = this.smooth('pc', m.overpressureC);
    const ac = this.smooth('ac', m.captureFraction);
    const f = this.smooth('f', Math.abs(m.dragForce));
    const pi = this.smooth('pi', Math.abs(m.power));
    const hj = this.smooth('hj', m.jetHeight);

    const row = (nome: string, med: number, teo: number, un: string, digits = 2, nota = ''): string => {
      if (nota) {
        return `<tr><td>${nome}</td><td>${med.toFixed(digits)}</td>` +
          `<td>${teo.toFixed(digits)}</td><td class="warn">${nota}</td><td class="un">${un}</td></tr>`;
      }
      const err = teo !== 0 ? (100 * (med - teo)) / Math.abs(teo) : 0;
      const errCls = Math.abs(err) < 8 ? 'ok' : Math.abs(err) < 20 ? 'warn' : 'bad';
      return `<tr><td>${nome}</td><td>${med.toFixed(digits)}</td>` +
        `<td>${teo.toFixed(digits)}</td><td class="${errCls}">${err >= 0 ? '+' : ''}${err.toFixed(1)}%</td><td class="un">${un}</td></tr>`;
    };

    const d = frame.diag;
    const cav = m.minPressureAbs < 2339;
    const jetTrunc = frame.diag.lostTop > 0;

    this.root.innerHTML = `
      <table class="hud-table">
        <tr><th>Grandeza</th><th>Medido</th><th>Teoria</th><th>Erro</th><th></th></tr>
        ${row('v no bocal', v, vT, 'm/s')}
        ${row('φ (vazão/largura)', phi, phiT, 'm²/s', 3)}
        ${row('P_C − P₀ (na sonda)', pc / 1000, pcT / 1000, 'kPa')}
        ${row('A_c/A', ac, acT, '—')}
        ${row('F (arrasto/largura)', f / 1000, fT / 1000, 'kN/m')}
        ${row('Π (potência/largura)', pi / 1000, piT / 1000, 'kW/m')}
        ${row('h do jato', hj, hjT, 'm', 2,
          hjT > p.domainH - (p.waterDepth + p.H) - 0.1 ? 'truncado pelo teto' : '')}
        <tr title="Coeficiente de perda de carga medido (duto + cotovelo + entrada): K = 2·(P_C − P₀ − ρg(H+d_C))/(ρv²). A teoria ideal supõe K = 0; um K > 0 é físico (e cresce com a difusão numérica em grades grossas) — reportado em vez de escondido (§7.3).">
          <td>K de perda (medido)</td>
          <td>${(v > 0.5 ? (2 * (pc - pcT)) / (rho * v * v) : 0).toFixed(2)}</td>
          <td>0 (ideal)</td><td class="un">—</td><td class="un"></td>
        </tr>
      </table>
      <div class="hud-diag">
        <span title="máx |∇·u|·Δx/|u|max após a projeção — deve ficar ≈ 0">div: ${d.maxDivergence.toExponential(1)}</span>
        <span title="variação de massa causada pela reamostragem">massa: ${d.massDriftPct.toFixed(2)}%</span>
        <span title="fração do tubo vertical ocupada por água">tubo cheio: ${(m.tubeFilled * 100).toFixed(0)}%</span>
        <span title="nível de água acumulada no reservatório">reserv.: ${(m.reservoirLevel * 100).toFixed(1)} cm</span>
        <span title="segundos simulados por segundo real">sim: ${frame.simRate.toFixed(3)}×</span>
        <span title="passo de tempo atual (CFL)">Δt: ${(d.dt * 1000).toFixed(2)} ms</span>
        <span title="partículas ativas">n: ${(d.particleCount / 1000).toFixed(0)}k</span>
        <span title="iterações do gradiente conjugado pré-condicionado">PCG: ${d.pressureIterations}</span>
      </div>
      ${cav ? `<div class="hud-warn">⚠ Pressão mínima ${(m.minPressureAbs / 1000).toFixed(1)} kPa &lt; pressão de vapor (2.3 kPa): haveria CAVITAÇÃO — não modelada (§7.3).</div>` : ''}
      ${jetTrunc ? `<div class="hud-note">ℹ O jato ultrapassa o teto do domínio: ${d.lostTop} partículas perdidas (contabilizadas). Use um V menor ou o preset "domínio alto".</div>` : ''}
      <div class="hud-note">Modo 2D: grandezas POR METRO DE LARGURA. O bloqueio do canal pelo tubo (D/profundidade = ${(p.D / p.waterDepth * 100).toFixed(0)}%) distorce as medições — a comparação fiel com a teoria exige o modo 3D (§4.1).</div>
    `;
    this.warned = cav || this.warned;
  }
}
