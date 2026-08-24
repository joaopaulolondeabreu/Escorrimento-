/**
 * Validação física completa (§7) em modo headless: `npm run validate`.
 *
 * 1. Testes canônicos do solver (§7.1) — mesmos do vitest;
 * 2. Problema-alvo em 2D (relato honesto das distorções do corte 2D);
 * 3. Problema-alvo em 3D (§7.2) — pontos V = 5..15 m/s em processos
 *    paralelos (reutiliza JSONs já presentes em relatorios/);
 * 4. Gera docs/VALIDACAO.md com todas as tabelas medido × teoria.
 *
 * Flags: --skip3d (pula os pontos 3D), --quick (durações reduzidas — para
 * fumaça, NÃO para o relatório oficial).
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  hydrostaticTest, divergenceTest, massConservationTest,
  poiseuilleTest, taylorGreenTest, damBreakTest, determinismTest,
  TestResult,
} from './canonical';
import { makeIntakeSolver, defaultIntakeParams } from '../solver/intake2d';
import { measureIntake } from '../physics/probes2d';
import {
  tubeVelocity, captureFraction, vMin, G_STANDARD, RHO_WATER,
} from '../physics/analytic';

const args = process.argv.slice(2);
const skip3d = args.includes('--skip3d');
const quick = args.includes('--quick');

const V3D = [5, 6, 8, 10, 12, 15];
const NX3D = 96;

interface Point3D {
  V: number; vNozzle: number; flux: number; overpressureC: number;
  dragForce: number; captureFraction: number; tubeFilled: number;
  minPressureAbs: number; maxDivergence: number; dx: number;
  particles: number; steps: number; wallSeconds: number;
}

function fmt(x: number, d = 3): string {
  return Number.isFinite(x) ? x.toFixed(d) : '—';
}
function pct(med: number, teo: number): string {
  if (!Number.isFinite(med) || teo === 0) return '—';
  const e = (100 * (med - teo)) / Math.abs(teo);
  return `${e >= 0 ? '+' : ''}${e.toFixed(1)}%`;
}
function passMark(med: number, teo: number, tolPct: number): string {
  const e = Math.abs((med - teo) / teo) * 100;
  return e <= tolPct ? '✅' : '❌';
}

async function main(): Promise<void> {
  mkdirSync('relatorios', { recursive: true });
  mkdirSync('docs', { recursive: true });
  const lines: string[] = [];
  const t0 = Date.now();

  lines.push('# VALIDAÇÃO — resultados medidos × teoria');
  lines.push('');
  lines.push(`Gerado por \`npm run validate\` em ${new Date().toISOString()}.`);
  lines.push('Todos os números abaixo são MEDIDOS pelas execuções desta máquina —');
  lines.push('nenhum valor é copiado da teoria. Critérios da especificação §7.');
  lines.push('');

  // ------------------------------------------------------------- §7.1
  console.log('== §7.1 Testes canônicos ==');
  lines.push('## §7.1 Testes canônicos do solver');
  lines.push('');
  lines.push('| Teste | Critério | Resultado | Situação |');
  lines.push('|---|---|---|---|');

  const canonical: Array<() => TestResult> = quick
    ? [() => hydrostaticTest(2), divergenceTest, () => massConservationTest(5),
       poiseuilleTest, taylorGreenTest, damBreakTest, determinismTest]
    : [() => hydrostaticTest(10), divergenceTest, () => massConservationTest(30),
       poiseuilleTest, taylorGreenTest, damBreakTest, determinismTest];

  for (const fn of canonical) {
    const r = fn();
    const metrics = Object.entries(r.metrics)
      .map(([k, v]) => `${k} = ${typeof v === 'number' ? Number(v.toPrecision(4)) : v}`)
      .join('; ');
    lines.push(`| ${r.name} | ${r.criteria} | ${metrics} | ${r.pass ? '✅ PASSA' : '❌ FALHA'} |`);
    if (r.notes) lines.push(`| | _${r.notes}_ | | |`);
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}: ${metrics}`);
  }
  lines.push('');

  // ------------------------------------------------------------- alvo 2D
  console.log('== Problema-alvo 2D (relato honesto) ==');
  lines.push('## Problema-alvo em 2D (corte longitudinal)');
  lines.push('');
  lines.push('**Advertência (§4.1):** em 2D a água excedente não pode contornar o');
  lines.push('tubo lateralmente — com os padrões da especificação o tubo bloqueia');
  lines.push('D/profundidade = 83% do canal, forma-se onda de proa com galgamento e');
  lines.push('o escoamento oscila. Os números 2D abaixo (média dos últimos 2 s) são');
  lines.push('reportados para documentar essa distorção; a comparação quantitativa');
  lines.push('com a teoria é o modo 3D (§7.2).');
  lines.push('');
  {
    const p = defaultIntakeParams();
    const s = makeIntakeSolver(quick ? 192 : 256, p);
    const tEnd = quick ? 3 : 6;
    const acc = { v: 0, phi: 0, pc: 0, ac: 0, f: 0 };
    let n = 0;
    while (s.time < tEnd) {
      s.step(s.computeDt());
      if (s.time > tEnd - 2 && s.stepCount % 10 === 0) {
        const m = measureIntake(s, p);
        acc.v += m.vNozzle; acc.phi += m.flux; acc.pc += m.overpressureC;
        acc.ac += m.captureFraction; acc.f += Math.abs(m.dragForce);
        n++;
      }
    }
    const vT = tubeVelocity(p.V, p.H);
    const phiT = p.D * vT;
    const pcT = RHO_WATER * G_STANDARD * p.H;
    const acT = captureFraction(p.V, p.H);
    const fT = RHO_WATER * phiT * p.V;
    const g = (x: number) => x / Math.max(1, n);
    lines.push('| Grandeza (por metro de largura) | Medido 2D | Teoria | Desvio |');
    lines.push('|---|---|---|---|');
    lines.push(`| v no bocal [m/s] | ${fmt(g(acc.v), 2)} | ${fmt(vT, 2)} | ${pct(g(acc.v), vT)} |`);
    lines.push(`| φ [m²/s] | ${fmt(g(acc.phi))} | ${fmt(phiT)} | ${pct(g(acc.phi), phiT)} |`);
    lines.push(`| P_C − P₀ [kPa] | ${fmt(g(acc.pc) / 1000, 2)} | ${fmt(pcT / 1000, 2)} | ${pct(g(acc.pc), pcT)} |`);
    lines.push(`| A_c/A | ${fmt(g(acc.ac), 2)} | ${fmt(acT, 2)} | ${pct(g(acc.ac), acT)} |`);
    lines.push(`| F [kN/m] | ${fmt(g(acc.f) / 1000, 2)} | ${fmt(fT / 1000, 2)} | ${pct(g(acc.f), fT)} |`);
    lines.push('');
    console.log(`  2D: v=${fmt(g(acc.v), 2)} (teoria ${fmt(vT, 2)}), Pc=${fmt(g(acc.pc) / 1000, 1)} kPa (teoria ${fmt(pcT / 1000, 1)})`);
  }

  // ------------------------------------------------------------- §7.2 3D
  if (!skip3d) {
    console.log('== §7.2 Validação 3D ==');
    const points: Point3D[] = [];
    const missing = V3D.filter((v) => !existsSync(`relatorios/ponto3d-V${v}.json`));
    if (missing.length > 0) {
      console.log(`  rodando pontos 3D que faltam: ${missing.join(', ')} (paralelo 3)`);
      for (let i = 0; i < missing.length; i += 3) {
        const batch = missing.slice(i, i + 3);
        await Promise.all(batch.map((v) => new Promise<void>((resolve, reject) => {
          const child = spawn('npx', [
            'tsx', 'src/tests/validate3d-point.ts',
            `--V=${v}`, `--nx=${NX3D}`,
            `--settle=${quick ? 1.5 : 3}`, `--measure=${quick ? 1 : 2}`,
            `--out=relatorios/ponto3d-V${v}.json`,
          ], { stdio: 'inherit' });
          child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`V=${v} código ${code}`)));
        })));
      }
    }
    for (const v of V3D) {
      const f = `relatorios/ponto3d-V${v}.json`;
      if (existsSync(f)) points.push(JSON.parse(readFileSync(f, 'utf8')));
    }

    const p3 = defaultIntakeParams();
    const A = Math.PI * p3.D * p3.D / 4;
    const pcT = RHO_WATER * G_STANDARD * p3.H;

    lines.push('## §7.2 Problema-alvo em 3D (geometria cilíndrica, free-slip, ν nominal)');
    lines.push('');
    lines.push(`Grade ${NX3D} células no comprimento (Δx ≈ ${points[0] ? (points[0].dx * 100).toFixed(1) : '?'} cm ⇒ D/Δx ≈ ${points[0] ? (p3.D / points[0].dx).toFixed(1) : '?'} células no diâmetro);`);
    lines.push('média temporal em regime permanente com dreno no reservatório.');
    lines.push('');
    lines.push('| V [m/s] | v med | v teo | erro (tol ±3%) | φ med | φ teo | erro (±5%) | P_C−P₀ med [kPa] | teo | erro (±5%) | A_c/A med | teo | erro (±8%) | F med [N] | teo | erro (±8%) |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const pt of points) {
      const vT = tubeVelocity(pt.V, p3.H);
      const phiT = A * vT;
      const acT = captureFraction(pt.V, p3.H);
      const fT = RHO_WATER * phiT * pt.V;
      const fMed = Math.abs(pt.dragForce);
      lines.push(
        `| ${pt.V} | ${fmt(pt.vNozzle, 2)} | ${fmt(vT, 2)} | ${pct(pt.vNozzle, vT)} ${passMark(pt.vNozzle, vT, 3)} ` +
        `| ${fmt(pt.flux, 4)} | ${fmt(phiT, 4)} | ${pct(pt.flux, phiT)} ${passMark(pt.flux, phiT, 5)} ` +
        `| ${fmt(pt.overpressureC / 1000, 2)} | ${fmt(pcT / 1000, 2)} | ${pct(pt.overpressureC, pcT)} ${passMark(pt.overpressureC, pcT, 5)} ` +
        `| ${fmt(pt.captureFraction, 2)} | ${fmt(acT, 2)} | ${pct(pt.captureFraction, acT)} ${passMark(pt.captureFraction, acT, 8)} ` +
        `| ${fmt(fMed, 0)} | ${fmt(fT, 0)} | ${pct(fMed, fT)} ${passMark(fMed, fT, 8)} |`,
      );
      console.log(`  V=${pt.V}: v=${fmt(pt.vNozzle, 2)}/${fmt(vT, 2)} φ=${fmt(pt.flux, 4)}/${fmt(phiT, 4)} Pc=${fmt(pt.overpressureC / 1000, 1)}/${fmt(pcT / 1000, 1)} kPa`);
    }
    lines.push('');

    // Constância de P_C com V (desvio padrão relativo < 3%)
    if (points.length >= 3) {
      const pcs = points.map((pt) => pt.overpressureC);
      const mean = pcs.reduce((a, b) => a + b, 0) / pcs.length;
      const sd = Math.sqrt(pcs.reduce((a, b) => a + (b - mean) ** 2, 0) / pcs.length);
      const rsd = (100 * sd) / mean;
      lines.push(`**Constância de P_C − P₀ com V** (o teste conceitual central — §1.2): desvio`);
      lines.push(`padrão relativo medido = **${rsd.toFixed(1)}%** (critério < 3%) ${rsd < 3 ? '✅' : '❌'};`);
      lines.push(`média ${fmt(mean / 1000, 2)} kPa vs ρgH = ${fmt(pcT / 1000, 2)} kPa.`);
      lines.push('');
    }

    // V_min por ajuste φ² vs V² (φ = A·√(V²−V_min²) ⇒ φ² linear em V²)
    if (points.length >= 3) {
      const xs = points.map((pt) => pt.V * pt.V);
      const ys = points.map((pt) => pt.flux * pt.flux);
      const nn = xs.length;
      const sx = xs.reduce((a, b) => a + b, 0);
      const sy = ys.reduce((a, b) => a + b, 0);
      const sxx = xs.reduce((a, b) => a + b * b, 0);
      const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
      const slope = (nn * sxy - sx * sy) / (nn * sxx - sx * sx);
      const intercept = (sy - slope * sx) / nn;
      const vminMed = Math.sqrt(Math.max(0, -intercept / slope));
      const vminT = vMin(p3.H);
      lines.push(`**V_min** (por ajuste linear de φ² vs V², extrapolando φ → 0):`);
      lines.push(`medido **${fmt(vminMed, 2)} m/s** vs teoria √(2gH) = ${fmt(vminT, 2)} m/s`);
      lines.push(`(erro ${pct(vminMed, vminT)}, critério ±5%) ${passMark(vminMed, vminT, 5)}.`);
      lines.push('');
    }

    lines.push('| Diagnóstico | Valor |');
    lines.push('|---|---|');
    for (const pt of points) {
      lines.push(`| V=${pt.V}: divergência máx normalizada | ${pt.maxDivergence.toExponential(1)} |`);
      lines.push(`| V=${pt.V}: tubo vertical cheio | ${(pt.tubeFilled * 100).toFixed(0)}% |`);
      lines.push(`| V=${pt.V}: pressão mínima absoluta | ${(pt.minPressureAbs / 1000).toFixed(1)} kPa ${pt.minPressureAbs < 2339 ? '⚠ cavitação (não modelada)' : ''} |`);
    }
    lines.push('');
  } else {
    lines.push('## §7.2 — PULADO (`--skip3d`)');
    lines.push('');
  }

  lines.push('## Notas de honestidade científica (§7.3)');
  lines.push('');
  lines.push('1. **LES, não DNS**: Re ≈ 2×10⁶; a turbulência de submalha é modelada');
  lines.push('   (Smagorinsky) e a dissipação numérica de transporte do FLIP/APIC é');
  lines.push('   mensurável (ver teste de Taylor–Green: com ν nominal da água o');
  lines.push('   decaimento numérico domina o físico em qualquer resolução viável).');
  lines.push('2. **2D ≠ 3D** para a fração captada (bloqueio lateral) — tabela 2D acima.');
  lines.push('3. **Sem arrastamento de ar** (fase gasosa = vazio a pressão constante);');
  lines.push('   a espuma real é subestimada.');
  lines.push('4. **No-slip** reduz v abaixo de √(V²−2gH) por perdas viscosas e do');
  lines.push('   cotovelo — esperado; a fórmula analítica é o limite invíscido.');
  lines.push('5. **Cavitação não modelada** — apenas aviso quando P < 2.34 kPa.');
  lines.push('6. Dam break: dados de Martin & Moyce digitalizados da Fig. 3 do paper');
  lines.push('   original (PySPH); incerteza da comporta ΔT ≈ 0.15–0.25 tratada com o');
  lines.push('   deslocamento fixo do projeto Lethe (0.175). Fontes em dambreak-data.ts.');
  lines.push('');
  lines.push(`_Tempo total de validação: ${((Date.now() - t0) / 60000).toFixed(1)} min._`);

  writeFileSync('docs/VALIDACAO.md', lines.join('\n') + '\n');
  console.log(`\nRelatório: docs/VALIDACAO.md (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
