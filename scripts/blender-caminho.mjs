/**
 * Descoberta do executável do Blender, compartilhada pelos scripts que
 * precisam dele (renderizar e juntar vídeo). O caminho varia demais entre
 * versões e formas de instalação para caber numa instrução fixa.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

/** Caminho do Blender (variável BLENDER tem prioridade), ou null. */
export function acharBlender() {
  const informado = process.env.BLENDER;
  if (informado && !existsSync(informado)) {
    console.log(`\n  ⚠  BLENDER aponta para um arquivo que não existe:\n     ${informado}\n`);
  }
  return (informado && existsSync(informado)) ? informado : (candidatos()[0] ?? null);
}

export function avisoSemBlender() {
  console.log(`
  ❌ Não encontrei o Blender neste computador.

     Ele é gratuito e é usado APENAS como renderizador — a física toda vem
     do solver deste projeto.

     1. Baixe em https://www.blender.org/download/ (versão 3.6 ou mais nova)
     2. Instale normalmente e rode este comando de novo.

     Se o Blender já estiver instalado num lugar fora do comum, informe o
     caminho assim (exemplo no Windows):

       $env:BLENDER = "D:\\Blender\\blender.exe"
`);
}
