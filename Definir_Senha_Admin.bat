@echo off
title Definir Usuario e Senha do Admin / Cozinha
color 0A
cd /d "%~dp0"

echo =============================================================
echo     DEFINIR USUARIO E SENHA DO PAINEL DA COZINHA (ADMIN)
echo =============================================================
echo.
set /p user="Digite o nome de USUARIO desejado (ex: admin ou cozinha): "
set /p pass="Digite a SENHA desejada (minimo 4 caracteres): "

if "%user%"=="" (
    echo Usuario nao pode ser vazio.
    pause
    exit /b
)

if "%pass%"=="" (
    echo Senha nao pode ser vazia.
    pause
    exit /b
)

echo.
echo Gravando no banco de dados com criptografia segura...
node -e "const { getDb } = require('./src/database/db'); const { hashPassword } = require('./src/utils/password'); async function setAdmin() { const db = getDb(); const u = '%user%'.trim().toLowerCase(); const p = hashPassword('%pass%'); await db.execute('CREATE TABLE IF NOT EXISTS usuarios_admin (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, senha TEXT NOT NULL, cargo TEXT DEFAULT \'cozinha\', criado_em TEXT DEFAULT CURRENT_TIMESTAMP)'); const existe = await db.queryOne('SELECT id FROM usuarios_admin WHERE LOWER(usuario) = ?', [u]); if (existe) { await db.execute('UPDATE usuarios_admin SET senha = ? WHERE id = ?', [p, existe.id]); console.log('✅ Senha do usuario [%user%] atualizada com sucesso!'); } else { await db.execute('INSERT INTO usuarios_admin (usuario, nome, senha, cargo) VALUES (?, ?, ?, ?)', [u, '%user%', p, 'admin']); console.log('✅ Novo usuario [%user%] criado com sucesso!'); } } setAdmin().catch(console.error);"

echo.
echo =============================================================
pause
