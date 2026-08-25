@echo off
rem Escorrimento - abrir no CELULAR (Windows)
rem Sobe o simulador na rede local e mostra um QR Code para escanear.
setlocal
cd /d "%~dp0"
chcp 65001 >nul 2>&1

echo ==============================================
echo   Escorrimento - abrir no celular
echo ==============================================

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [X] O Node.js nao esta instalado neste computador.
  echo     Baixe a versao LTS em https://nodejs.org, instale e tente de novo.
  pause
  exit /b 1
)

for /f "delims=v. tokens=1" %%v in ('node --version') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo.
  echo [X] Seu Node.js e antigo demais - e preciso a versao 18 ou mais nova.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo [*] Instalando dependencias ^(so na primeira vez, ~1 minuto^)...
  call npm install --no-audit --no-fund
)

echo.
echo [*] Preparando o endereco para o celular...
echo     Se o Windows perguntar, PERMITA o acesso do Node.js a rede privada.
echo.
call npm run celular
