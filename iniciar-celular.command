#!/usr/bin/env bash
# Escorrimento — abrir no CELULAR (macOS)
# Sobe o simulador na rede local e mostra um QR Code para escanear.
set -e
cd "$(dirname "$0")"

echo "=============================================="
echo "  Escorrimento — abrir no celular"
echo "=============================================="

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "❌ O Node.js não está instalado neste computador."
  echo "   Baixe a versão LTS em https://nodejs.org, instale e rode de novo."
  read -rp "Pressione Enter para sair..."
  exit 1
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo ""
  echo "❌ Seu Node.js é a versão $(node --version), mas é preciso a 18 ou mais nova."
  read -rp "Pressione Enter para sair..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "📦 Instalando dependências (só na primeira vez, ~1 minuto)..."
  npm install --no-audit --no-fund
fi

echo ""
echo "📱 Preparando o endereço para o celular..."
echo ""
npm run celular
