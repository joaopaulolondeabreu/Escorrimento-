/**
 * Um ponto da validação 3D (§7.2): roda a cena de captação em uma
 * velocidade V até o regime permanente, mede com média temporal e grava
 * JSON. Executado como processo filho pelo validate.ts (paralelismo).
 *
 * Uso: tsx src/tests/validate3d-point.ts --V=8 --nx=96 --settle=3 --measure=2 --out=arquivo.json
 */

import { writeFileSync } from 'node:fs';
import { makeIntake3dSolver, defaultIntake3DParams, measureIntake3d } from '../solver/intake3d';

function arg(name: string, def: number): number {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? parseFloat(m.split('=')[1]) : def;
}
function argStr(name: string, def: string): string {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1] : def;
}

const V = arg('V', 8);
const nx = arg('nx', 96);
const settle = arg('settle', 3.0);
const measure = arg('measure', 2.0);
const out = argStr('out', `relatorios/ponto3d-V${V}.json`);

const p = defaultIntake3DParams();
p.V = V;

const t0 = Date.now();
const s = makeIntake3dSolver(nx, p);
console.log(`[V=${V}] grade ${s.nx}x${s.ny}x${s.nz} dx=${(s.dx * 100).toFixed(2)}cm particulas=${s.count}`);

// fase de acomodação
while (s.time < settle) {
  s.step(s.computeDt());
  if (s.stepCount % 200 === 0) {
    console.log(`[V=${V}] t=${s.time.toFixed(2)}s n=${s.count} pIt=${s.lastPressureIters}`);
  }
}
// fase de medição (média temporal)
const acc = { vNozzle: 0, flux: 0, overpressureC: 0, dragForce: 0, captureFraction: 0, tubeFilled: 0, minP: Infinity };
let nAcc = 0;
let maxDiv = 0;
const tEnd = settle + measure;
while (s.time < tEnd) {
  s.step(s.computeDt());
  maxDiv = Math.max(maxDiv, s.lastMaxDiv);
  if (s.stepCount % 10 === 0) {
    const m = measureIntake3d(s, p);
    acc.vNozzle += m.vNozzle;
    acc.flux += m.flux;
    acc.overpressureC += m.overpressureC;
    acc.dragForce += m.dragForce;
    acc.captureFraction += m.captureFraction;
    acc.tubeFilled += m.tubeFilled;
    acc.minP = Math.min(acc.minP, m.minPressureAbs);
    nAcc++;
  }
}
const n = Math.max(1, nAcc);
const result = {
  V,
  nx,
  dx: s.dx,
  settle,
  measure,
  vNozzle: acc.vNozzle / n,
  flux: acc.flux / n,
  overpressureC: acc.overpressureC / n,
  dragForce: acc.dragForce / n,
  captureFraction: acc.captureFraction / n,
  tubeFilled: acc.tubeFilled / n,
  minPressureAbs: acc.minP,
  maxDivergence: maxDiv,
  particles: s.count,
  steps: s.stepCount,
  wallSeconds: (Date.now() - t0) / 1000,
};
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`[V=${V}] concluído em ${result.wallSeconds.toFixed(0)}s → ${out}`);
