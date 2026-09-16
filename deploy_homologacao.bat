@echo off
title Publicar Projeto de Homologacao iFood na Vercel
color 0C
cd /d "%~dp0"

echo =============================================================
echo      PUBLICAR AMBIENTE DE HOMOLOGACAO IFOOD NA VERCEL
echo =============================================================
echo.
echo ATENCAO: Este script publica EXCLUSIVAMENTE o ambiente de testes
echo e homologacao do iFood (sistrastreamento-homologacao).
echo.
echo [1] Fazer primeiro deploy (Vercel interativo para criar novo projeto)
echo [2] Fazer deploy rapido em producao (npx vercel --prod)
echo [3] Fazer deploy usando Token da Vercel
echo [4] Iniciar servidor localmente (http://localhost:3000)
echo [5] Sair
echo.
set /p opcao="Digite a opcao (1-5): "

if "%opcao%"=="1" (
    echo.
    echo Iniciando configuracao na Vercel...
    echo Quando perguntado se deseja vincular a um projeto existente, digite 'N' (para criar um novo projeto).
    echo Nome sugerido para o projeto: sistrastreamento-homologacao
    echo.
    cmd /c npx vercel
)

if "%opcao%"=="2" (
    echo.
    echo Publicando na Vercel em producao...
    cmd /c npx vercel --prod --yes
)

if "%opcao%"=="3" (
    echo.
    set /p vtoken="Cole seu Token da Vercel aqui: "
    cmd /c npx vercel --prod --yes --token %vtoken%
)

if "%opcao%"=="4" (
    echo.
    echo Iniciando servidor local...
    cmd /c node server.js
)

echo.
echo =============================================================
pause
