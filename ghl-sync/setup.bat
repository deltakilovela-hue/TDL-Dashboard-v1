@echo off
echo ============================================
echo   TDL Dashboard - GHL Sync Server Setup
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Instalando dependencias Node.js...
call npm install
if %errorlevel% neq 0 (
  echo ERROR: Fallo al instalar dependencias. Asegurate de tener Node.js instalado.
  pause
  exit /b 1
)

echo.
echo [2/3] Primera sincronizacion con GoHighLevel...
node export-contacts.js
if %errorlevel% neq 0 (
  echo ERROR: Fallo la sincronizacion inicial. Verifica tu API key en el archivo .env
  pause
  exit /b 1
)

echo.
echo [3/3] Iniciando servidor...
echo El servidor correra en: http://localhost:3001
echo Presiona Ctrl+C para detenerlo.
echo.
node server.js
