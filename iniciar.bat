@echo off
rem Escorrimento - inicializacao com duplo clique (Windows)
rem Instala as dependencias se necessario, compila e abre o navegador.
setlocal
cd /d "%~dp0"
chcp 65001 >nul 2>&1

echo ==============================================
echo   Escorrimento - simulador de captacao de agua
echo ==============================================

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [X] O Node.js nao esta instalado neste computador.
  echo.
  echo     Para instalar:
  echo     1. Acesse https://nodejs.org
  echo     2. Baixe a versao LTS ^(botao verde^)
  echo     3. Instale como qualquer programa e de duplo clique aqui de novo.
  echo.
  pause
  exit /b 1
)

for /f "delims=v. tokens=1" %%v in ('node --version') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo.
  echo [X] Seu Node.js e antigo demais - e preciso a versao 18 ou mais nova.
  echo     Baixe a versao LTS em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo [*] Instalando dependencias ^(so na primeira vez, ~1 minuto^)...
  call npm install --no-audit --no-fund
)

echo.
echo [*] Abrindo o simulador no navegador...
echo     ^(para encerrar: feche esta janela^)
echo.

start "" /b cmd /c "timeout /t 4 >nul & start http://localhost:5173"
call npm run dev -- --port 5173
