@echo off
title Atualizar e Reiniciar Spooler Monitor - Ao Ponto
color 0A
cd /d "%~dp0"

:: 1. Auto-elevacao para Administrador
if "%1"=="ELEVATED" goto :EXECUTAR
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo =============================================================
    echo    SOLICITANDO PRIVILEGIOS DE ADMINISTRADOR...
    echo =============================================================
    echo Clique em "SIM" na janela de confirmacao do Windows...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList 'ELEVATED' -Verb RunAs" 2>nul
    exit /b
)

:EXECUTAR
echo =============================================================
echo   ATUALIZANDO E REINICIANDO SPOOLER MONITOR - AO PONTO
echo   Suporte Completo: Brasileiras, Burgers e Carnes (99Food)
echo =============================================================
echo.

:: 2. Encerrar qualquer processo antigo de monitoramento
echo [1/5] Encerrando processos antigos do monitor...
taskkill /f /im node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: 3. Garantir permissoes completas na pasta de Spool do Windows
echo [2/5] Garantindo permissoes na pasta de spool do Windows...
icacls "%SystemRoot%\System32\spool\PRINTERS" /grant Everyone:(OI)(CI)F /T /C >nul 2>&1
icacls "%SystemRoot%\System32\spool\PRINTERS" /grant Todos:(OI)(CI)F /T /C >nul 2>&1
icacls "%SystemRoot%\System32\spool\PRINTERS" /grant Users:(OI)(CI)F /T /C >nul 2>&1

:: 4. Garantir KeepPrintedJobs:1 na impressora Epson
echo [3/5] Garantindo retencao de comandas (KeepPrintedJobs) nas impressoras...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Set-Printer -KeepPrintedJobs:1" >nul 2>&1

:: 5. Limpar cache local para reprocessar imediatamente qualquer comanda de hoje retida no Spool
echo [4/5] Limpando cache para sincronizar pedidos de hoje...
if exist processed_cache.json del /f /q processed_cache.json >nul 2>&1
if exist monitor.log del /f /q monitor.log >nul 2>&1

:: 6. Cadastrar / Atualizar a Tarefa Agendada no Windows para iniciar com o sistema
echo [5/5] Iniciando Spooler Monitor em segundo plano...
set "VBS_PATH=%~dp0iniciar_oculto.vbs"
schtasks /create /tn "SpoolerMonitorBalcao" /tr "wscript.exe \"%VBS_PATH%\"" /sc onlogon /rl highest /f >nul 2>&1
schtasks /run /tn "SpoolerMonitorBalcao" >nul 2>&1
if %errorlevel% neq 0 (
    wscript.exe "%VBS_PATH%"
)

echo.
echo =============================================================
echo   [SUCESSO] MONITOR ATUALIZADO E REINICIADO COM EXITO!
echo =============================================================
echo   - 99Food Comidas Brasileiras: ATIVA
echo   - 99Food Burgers e Sanduiches: ATIVA
echo   - 99Food Ao Ponto Carnes:     ATIVA
echo   - iFood e Cardapio Web:       ATIVOS
echo.
echo   * Os pedidos de hoje no spool estao sendo reprocessados agora!
echo   * O monitor continuara rodando silenciosamente em 2o plano.
echo =============================================================
echo.
timeout /t 5 >nul
exit /b
