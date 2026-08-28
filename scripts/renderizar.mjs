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
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Caminhos candidatos por sistema, do mais provável para o menos. */
function candidatos() {
  const lista = [];
  const naPath = spawnSync(process.platform === 'win32' ? 'where' : 'which',
    ['blender'], { encoding: 'utf8' });
  if (naPath.status === 0) {
    for (const linha of naPath.stdout.split(/\r?\n/)) {
      if (linha.trim()) lista.push(linha.trim());
    }
  }

  if (process.platform === 'win32') {
    const bases = [
      'C:\\Program Files\\Blender Foundation',
      'C:\\Program Files (x86)\\Blender Foundation',
      'C:\\Program Files\\Steam\\steamapps\\common',
      'C:\\Program Files (x86)\\Steam\\steamapps\\common',
      join(process.env.LOCALAPPDATA ?? '', 'Programs'),
      join(process.env.PROGRAMFILES ?? '', 'Blender Foundation'),
    ];
    for (const base of bases) {
      if (!base || !existsSync(base)) continue;
      for (const pasta of readdirSync(base)) {
        if (!/blender/i.test(pasta)) continue;
        const exe = join(base, pasta, 'blender.exe');
        if (existsSync(exe)) lista.push(exe);
      }
    }
  } else if (process.platform === 'darwin') {
    lista.push('/Applications/Blender.app/Contents/MacOS/Blender');
    lista.push(join(process.env.HOME ?? '', 'Applications/Blender.app/Contents/MacOS/Blender'));
  } else {
    lista.push('/usr/bin/blender', '/usr/local/bin/blender',
      '/snap/bin/blender', '/var/lib/flatpak/exports/bin/org.blender.Blender');
  }
  return lista.filter((c, i) => existsSync(c) && lista.indexOf(c) === i);
}

const informado = process.env.BLENDER;
if (informado && !existsSync(informado)) {
  console.log(`\n  ⚠  BLENDER aponta para um arquivo que não existe:\n     ${informado}\n`);
}
const blender = (informado && existsSync(informado)) ? informado : candidatos()[0];

if (!blender) {
  console.log(`
  ❌ Não encontrei o Blender neste computador.

     Ele é gratuito e é usado APENAS como renderizador — a física toda vem
     do solver deste projeto.

     1. Baixe em https://www.blender.org/download/ (versão 3.6 ou mais nova)
     2. Instale normalmente e rode este comando de novo.

     Se o Blender já estiver instalado num lugar fora do comum, informe o
     caminho assim (exemplo no Windows):

       $env:BLENDER = "D:\\Blender\\blender.exe"
       npm run render:blender -- exports 1 96
`);
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
