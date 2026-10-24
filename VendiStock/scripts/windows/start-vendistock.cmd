@echo off
REM Ručno pokretanje VendiStocka (bez Windows servisa) – za testiranje.
REM Za trajni rad koristite Windows servis: npm run service:install
cd /d "%~dp0\..\.."
node server\dist\index.js
