/**
 * Renderiza os quadros exportados no Blender, encontrando o executável
 * sozinho. O caminho do Blender varia demais entre instalações (versão,
 * Program Files, Steam, snap/flatpak) para caber numa instrução fixa no
 * README — este script procura nos lugares conhecidos e, se não achar,
 * explica em português o que instalar.
 *
 * Uso:  npm run render:blender -- [pasta] [quadroInicial] [quadroFinal] [--samples=N]
 *       npm run render:blender                    (último quadro de exports/)
 *       npm run render:blender -- exports 1 96    (intervalo)
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
  console.log('     npm run render:blender -- exports 1 96\n');
  process.exit(1);
}

const passados = process.argv.slice(2);
const args = passados.length > 0 ? passados : ['exports'];
const pasta = args[0];
if (!existsSync(join(RAIZ, pasta))) {
  console.log(`
  ❌ A pasta "${pasta}" não existe.
     Rode antes a simulação 3D:  npm run export:blender
`);
  process.exit(1);
}

console.log(`  Blender encontrado: ${blender}`);
console.log(`  Renderizando ${args.join(' ')} → ${pasta}/render/\n`);

const proc = spawn(blender,
  ['-b', '-P', join(RAIZ, 'blender', 'importar_escorrimento.py'), '--', ...args],
  { cwd: RAIZ, stdio: 'inherit' });
proc.on('exit', (codigo) => {
  if (codigo === 0) {
    console.log(`\n  ✅ Pronto: imagens em ${pasta}/render/`);
    console.log('     Para juntar num vídeo (se tiver ffmpeg):');
    console.log(`     ffmpeg -framerate 24 -i ${pasta}/render/quadro_%04d.png `
      + '-c:v libx264 -pix_fmt yuv420p captacao.mp4');
  }
  process.exit(codigo ?? 0);
});
