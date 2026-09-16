@echo off
title Agente Spooler Balcao - Epson TM-T20
cls
echo ==============================================================
echo    INICIANDO AGENTE SPOOLER BALCAO (EPSON TM-T20)
echo ==============================================================
echo.
cd /d "%~dp0"
node spooler-monitor.js
pause
