/**
 * Junta os quadros renderizados num MP4 usando o próprio Blender — sem
 * precisar instalar ffmpeg.
 *
 * Uso:  npm run video:blender                        (exports/render, 24 fps)
 *       npm run video:blender -- exports/render 12   (pasta e taxa)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { acharBlender, avisoSemBlender } from './blender-caminho.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const blender = acharBlender();
if (!blender) {
  avisoSemBlender();
  console.log('     npm run video:blender -- exports/render 12\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const pasta = args[0] ?? 'exports/render';
const fps = args[1] ?? '24';
const saida = args[2];
if (!existsSync(join(RAIZ, pasta))) {
  console.log(`\n  ❌ A pasta "${pasta}" não existe — renderize os quadros antes:`);
  console.log('     npm run render:blender -- exports 1 96\n');
  process.exit(1);
}

console.log(`  Blender encontrado: ${blender}`);
console.log(`  Juntando ${pasta} a ${fps} quadros por segundo\n`);
const proc = spawn(blender,
  ['-b', '-P', join(RAIZ, 'blender', 'juntar_video.py'), '--',
    join(RAIZ, pasta), fps, ...(saida ? [saida] : [])],
  { cwd: RAIZ, stdio: 'inherit' });
proc.on('exit', (codigo) => process.exit(codigo ?? 0));
