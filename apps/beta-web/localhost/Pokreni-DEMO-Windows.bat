@echo off
rem Renvara s DEMO podacima (zasebna mapa podaci-demo): za isprobavanje.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Renvara treba Node.js. Instalirajte verziju LTS s https://nodejs.org
  echo   ^(otvaram stranicu^), zatim ponovno pokrenite ovu datoteku.
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
node "program\start.mjs" --demo %*
echo.
pause
