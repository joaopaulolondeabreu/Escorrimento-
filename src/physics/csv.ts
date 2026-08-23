/** Exportação CSV do modo varredura (§6.3). */

import type { SweepPoint } from '../app/protocol';
import {
  tubeVelocity, captureFraction, G_STANDARD,
} from './analytic';

export function sweepToCsv(
  points: SweepPoint[], H: number, D: number, rho: number,
): string {
  const lines = [
    // Cabeçalho: grandezas por metro de largura (2D)
    'V[m/s],v_medido[m/s],v_teorico[m/s],phi_medido[m2/s],phi_teorico[m2/s],' +
    'Pc_medido[Pa],Pc_teorico[Pa],AcA_medido,AcA_teorico,F_medido[N/m],' +
    'F_teorico[N/m],Pi_medido[W/m],Pi_teorico[W/m]',
  ];
  for (const p of points) {
    const vT = tubeVelocity(p.V, H);
    const phiT = D * vT;
    const pcT = rho * G_STANDARD * H;
    const acT = captureFraction(p.V, H);
    const fT = rho * phiT * p.V;
    lines.push([
      p.V, p.vNozzle, vT, p.flux, phiT,
      p.overpressureC, pcT, p.captureFraction, acT,
      Math.abs(p.dragForce), fT, Math.abs(p.power), fT * p.V,
    ].map((x) => (typeof x === 'number' ? x.toPrecision(6) : x)).join(','));
  }
  return lines.join('\n');
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
