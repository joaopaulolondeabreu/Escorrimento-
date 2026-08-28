/**
 * Exportador de partículas 3D para renderização fotorrealista externa
 * (Blender/Cycles — ver blender/importar_escorrimento.py e README).
 *
 * Roda a simulação 3D do problema-alvo e grava:
 *  - exports/quadro_0001.ply, quadro_0002.ply, ... — nuvens de pontos PLY
 *    (binário little-endian) com posição + |velocidade| por partícula;
 *  - exports/cena.json — geometria da cena (tubo em L, canal, reservatório,
 *    nível d'água) para o script do Blender reconstruir os sólidos.
 *
 * Uso:  npx tsx src/tests/export3d.ts [--V=8] [--nx=92] [--t=4] [--fps=24]
 *                                     [--out=exports]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  makeIntake3dSolver, defaultIntake3DParams, intake3dGeometry,
} from '../solver/intake3d';

function arg(name: string, def: number): number {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? parseFloat(a.split('=')[1]) : def;
}
function argStr(name: string, def: string): string {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}

/** Grava uma nuvem de pontos PLY binário (x,y,z float32 + speed float32). */
function writePly(path: string, s: { count: number; px: Float64Array; py: Float64Array; pz: Float64Array; pu: Float64Array; pv: Float64Array; pw: Float64Array }): void {
  const n = s.count;
  const header =
    'ply\n' +
    'format binary_little_endian 1.0\n' +
    'comment Escorrimento — particulas FLIP/APIC (metros; +Y para cima)\n' +
    `element vertex ${n}\n` +
    'property float x\n' +
    'property float y\n' +
    'property float z\n' +
    'property float speed\n' +
    'end_header\n';
  const head = Buffer.from(header, 'ascii');
  const body = Buffer.allocUnsafe(n * 16);
  for (let k = 0; k < n; k++) {
    body.writeFloatLE(s.px[k], 16 * k);
    body.writeFloatLE(s.py[k], 16 * k + 4);
    body.writeFloatLE(s.pz[k], 16 * k + 8);
    body.writeFloatLE(
      Math.hypot(s.pu[k], s.pv[k], s.pw[k]), 16 * k + 12,
    );
  }
  writeFileSync(path, Buffer.concat([head, body]));
}

async function main(): Promise<void> {
  const V = arg('V', 8);
  const nx = arg('nx', 92);
  const tEnd = arg('t', 4);
  const fps = arg('fps', 24);
  const outDir = argStr('out', 'exports');
  mkdirSync(outDir, { recursive: true });

  const p = defaultIntake3DParams();
  p.V = V;
  const s = makeIntake3dSolver(nx, p);
  const geo = intake3dGeometry(p, s.dx);

  // Metadados da cena para o Blender reconstruir os sólidos
  writeFileSync(join(outDir, 'cena.json'), JSON.stringify({
    unidades: 'metros; eixo +Y para cima (converter para +Z no Blender)',
    V, fps,
    dominio: { L: s.width, H: s.height, W: s.depth },
    nivel_agua: p.waterDepth,
    tubo: {
      D: p.D,
      parede: geo.tEff,
      raio_cotovelo: p.elbowR,
      xC: geo.xC, yC: geo.yC, yA: geo.yA,
      xTube: geo.xTube, zC: geo.zC,
    },
    reservatorio: {
      x0: geo.xTube - p.resW / 2, x1: geo.xTube + p.resW / 2,
      z0: geo.zC - p.resW / 2, z1: geo.zC + p.resW / 2,
      piso_y: geo.resFloorY, altura: 0.8,
    },
    raio_particula: s.particleRadius,
  }, null, 2));

  const frameDt = 1 / fps;
  let frame = 0;
  let nextT = 0;
  const t0 = Date.now();
  while (s.time < tEnd) {
    s.step(Math.min(s.computeDt(), nextT + frameDt - s.time));
    if (s.time >= nextT + frameDt - 1e-9) {
      frame++;
      nextT = s.time;
      const name = join(outDir, `quadro_${String(frame).padStart(4, '0')}.ply`);
      writePly(name, s);
      console.log(`quadro ${frame} (t=${s.time.toFixed(3)}s, ${s.count} particulas) → ${name}`);
    }
  }
  console.log(`Exportação concluída: ${frame} quadros em ${outDir}/ ` +
    `(${((Date.now() - t0) / 60000).toFixed(1)} min). ` +
    'Renderize com: blender -b -P blender/importar_escorrimento.py -- exports');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
