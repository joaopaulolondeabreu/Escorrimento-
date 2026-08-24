#!/usr/bin/env bash
# Escorrimento — inicialização com duplo clique (macOS)
# Instala as dependências se necessário, compila e abre o navegador.
set -e
cd "$(dirname "$0")"

echo "=============================================="
echo "  Escorrimento — simulador de captação de água"
echo "=============================================="

# O instalador oficial do Node costuma ficar em /usr/local/bin (Intel) ou
# /opt/homebrew/bin (Apple Silicon) — garante que estão no PATH do Finder.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "❌ O Node.js não está instalado neste computador."
  echo ""
  echo "   Para instalar:"
  echo "   1. Acesse https://nodejs.org"
  echo "   2. Baixe a versão LTS (botão verde)"
  echo "   3. Instale como qualquer programa e dê duplo clique aqui de novo."
  echo ""
  read -rp "Pressione Enter para sair..."
  exit 1
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo ""
  echo "❌ Seu Node.js é a versão $(node --version), mas é preciso a 18 ou mais nova."
  echo "   Baixe a versão LTS em https://nodejs.org e tente de novo."
  read -rp "Pressione Enter para sair..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "📦 Instalando dependências (só na primeira vez, ~1 minuto)..."
  npm install --no-audit --no-fund
fi

echo ""
echo "🚂 Abrindo o simulador no navegador..."
echo "   (para encerrar: feche esta janela ou pressione Ctrl+C)"
echo ""

( sleep 3; open "http://localhost:5173" ) &

npm run dev -- --port 5173
