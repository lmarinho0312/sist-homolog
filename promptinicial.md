# PROJETO: Sistema de Rastreamento de Entregas Interno (MVP)

## CONTEXTO E OBJETIVO
Estamos desenvolvendo uma solução de baixo custo / custo zero para resolver o problema de visibilidade de entregas em um restaurante. 
Atualmente, quando um pedido atrasa, não há como saber onde o motoboy está ou se ele desviou da rota.

A arquitetura do projeto utiliza o **Traccar Server** (instalado localmente no computador do restaurante) como o motor silencioso de GPS em segundo plano através do app mobile *Traccar Client*.
Nossa tarefa é construir a **Aplicação Web Customizada** que faz a ponte entre os Pedidos e as Posições do GPS do Traccar.

---

## REQUISITOS DO SISTEMA

### 1. PERFIS E AUTENTICAÇÃO
- **Motoboy:** Autentica-se usando Telefone e Senha.
- **Admin / Restaurante:** Autentica-se usando Usuário/Senha corporativo ou acesso direto via rede local.

### 2. APLICAÇÃO MOBILE (MOTOBOY - WEB APP / PWA)
- Interface limpa e otimizada para uso em smartphones.
- Tela de Login rápida (Telefone/Senha).
- Tela Principal:
  - Campo simples para digitar o **Número do Pedido** (ex: 1042).
  - Botão **"Iniciar Entrega"** (associa o pedido ao motoboy no banco).
  - Lista de pedidos atualmente "Em Rota" sob responsabilidade daquele motoboy.
  - Botão **"Finalizar Entrega"** para cada pedido concluído.

### 3. PAINEL DA COZINHA / ADMIN (DESKTOP)
- **Visualização em Lista:**
  - Tabela com Pedidos Ativos, Nome do Motoboy, Telefone e Tempo decorrido.
  - Campo de busca rápida por Número do Pedido.
- **Visualização em Mapa:**
  - Mapa interativo usando **Leaflet.js + OpenStreetMap** (Custo R$ 0).
  - Marcadores (pinos) indicando a posição exata em tempo real de cada motoboy ativo.
  - Ao clicar no pino, exibe o Nome do Motoboy, Telefone e os Pedidos que ele está carregando no momento.
  - Atualização automática das posições via Polling/WebSockets a cada 5 segundos.

---

## STACK TECNOLÓGICA RECOMENDADA
- **Frontend Admin & Mobile:** HTML5, Tailwind CSS, JavaScript (Vanilla ou React/Vite), Leaflet.js (para o Mapa).
- **Backend / API:** Node.js (Express) ou Python (FastAPI/Flask).
- **Banco de Dados:** SQLite (local e sem custo, para salvar credenciais, pedidos e vinculações) ou PostgreSQL.
- **Integração GPS:** API REST nativa do Traccar (consultando os endpoints `/api/positions` e `/api/devices`).

---

## TAREFA DA IA (ANTI-GRAVITY)
Por favor, gere a estrutura completa do projeto, com os arquivos backend, frontend (Visão do Motoboy e Visão Admin) e scripts de banco de dados conforme as especificações detalhadas no guia de arquitetura.