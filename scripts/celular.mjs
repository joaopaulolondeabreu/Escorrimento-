/**
 * Modo celular: sobe o simulador acessível na rede local (Wi-Fi) e mostra o
 * endereço em texto e como QR Code, para abrir no telefone apontando a câmera.
 *
 * O computador e o celular precisam estar na MESMA rede. Nada sai para a
 * internet: o servidor é o próprio Vite, escutando na rede local.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { qrTerminal } from './qr.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Endereços IPv4 da máquina na rede local, do mais provável para o menos:
 * faixas domésticas (192.168) antes de 10.x e 172.16–31.x.
 */
function enderecosLocais() {
  const encontrados = [];
  for (const [nome, lista] of Object.entries(networkInterfaces())) {
    for (const item of lista ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const p = item.address.startsWith('192.168.') ? 0
        : item.address.startsWith('10.') ? 1
          : /^172\.(1[6-9]|2\d|3[01])\./.test(item.address) ? 2 : 3;
      encontrados.push({ nome, endereco: item.address, prioridade: p });
    }
  }
  return encontrados.sort((a, b) => a.prioridade - b.prioridade);
}

/** Primeira porta livre a partir de `inicial` (o QR precisa da porta certa). */
function portaLivre(inicial) {
  return new Promise((resolve) => {
    const tenta = (porta) => {
      const s = createServer();
      s.once('error', () => (porta < inicial + 20 ? tenta(porta + 1) : resolve(inicial)));
      s.once('listening', () => s.close(() => resolve(porta)));
      s.listen(porta, '0.0.0.0');
    };
    tenta(inicial);
  });
}

const enderecos = enderecosLocais();
const porta = await portaLivre(5173);

if (enderecos.length === 0) {
  console.log(`
  ⚠  Não encontrei nenhuma rede local neste computador.
     Conecte-o ao Wi-Fi (o mesmo do celular) e rode de novo.
     Enquanto isso, o simulador abre normalmente aqui em
     http://localhost:${porta}
`);
}

const principal = enderecos[0]?.endereco;
const url = principal ? `http://${principal}:${porta}/` : `http://localhost:${porta}/`;

const vite = spawn(
  process.execPath,
  [join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '--port', String(porta), '--strictPort'],
  { cwd: RAIZ, stdio: ['inherit', 'pipe', 'inherit'] },
);

let jaMostrou = false;
function mostrarConvite() {
  if (jaMostrou) return;
  jaMostrou = true;
  const qr = principal ? qrTerminal(url) : null;
  console.log(`
  ┌──────────────────────────────────────────────┐
  │  Escorrimento — abrir no celular             │
  └──────────────────────────────────────────────┘

  1. Deixe o celular na MESMA rede Wi-Fi deste computador.
  2. Aponte a câmera para o quadrado abaixo (ou digite o endereço).
  3. Para encerrar, feche esta janela ou pressione Ctrl+C.
`);
  if (qr) console.log(qr);
  console.log(`
  Endereço:  ${url}
  No próprio computador:  http://localhost:${porta}/
`);
  if (enderecos.length > 1) {
    console.log('  Se não abrir, tente um destes outros endereços desta máquina:');
    for (const e of enderecos.slice(1)) {
      console.log(`    http://${e.endereco}:${porta}/   (${e.nome})`);
    }
    console.log('');
  }
  console.log('  Observação: o celular roda a simulação no próprio aparelho —');
  console.log('  ela começa em resolução menor e o painel vira abas. O desvio');
  console.log('  em relação à teoria aparece no HUD, como no computador.\n');
}

vite.stdout.on('data', (bloco) => {
  process.stdout.write(bloco);
  if (/ready in|Local:/i.test(String(bloco))) setTimeout(mostrarConvite, 150);
});
// rede lenta ou saída inesperada: mostra o convite assim mesmo
setTimeout(mostrarConvite, 8000);

const encerrar = () => { vite.kill('SIGINT'); process.exit(0); };
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
vite.on('exit', (codigo) => process.exit(codigo ?? 0));
