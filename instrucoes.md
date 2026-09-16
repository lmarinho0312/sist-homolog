# PROMPT MESTRE DE EXECUÇÃO EM ETAPAS (ANTIGRAVITY)

## INSTRUÇÕES INICIAIS
Você atuará como um Engenheiro de Software Full-Stack encarregado de construir o MVP do **Sistema de Rastreamento Interno de Entregas**.

Sua prioridade máxima é **manter o contexto de todo o projeto** e **não avançar de etapa sem a validação e conclusão da etapa anterior**.

---

## CONTEXTO E DOCUMENTAÇÃO DE REFERÊNCIA
Antes de gerar qualquer código, você deve ler, absorver e considerar o conteúdo de todos os arquivos de especificação técnica presentes neste projeto:

1. `PROMPT_INICIAL_ANTIGRAVITY.md` (Visão geral e requisitos da aplicação)
2. `ESPECIFICACAO_TECNICA_E_BANCO.md` (Estrutura do banco de dados, API REST e integração com o Traccar)
3. `GUIA_PASSO_A_PASSO_DE_INSTALACAO.md` (Arquitetura da rede, túnel ngrok e porta do Traccar)

---

## REGRAS DE EXECUÇÃO DA IA

1. **Abordagem Etapa por Etapa:** Você executará apenas **UMA ETAPA DE CADA VEZ**.
2. **Sem Atalhos:** Não pule partes do código e não use comentários como `// adicione o restante aqui`. Entregue os arquivos completos.
3. **Ponto de Parada:** Ao final de cada etapa, você deve solicitar minha aprovação para avançar para a próxima etapa.
4. **Contexto Permanente:** Mantenha a coerência entre a modelagem de dados e as telas geradas.

---

## PLANO DE DESENVOLVIMENTO (PLANO DE VOO)

### ETAPA 1: Estrutura Base e Banco de Dados
- Configurar o projeto no ambiente (Node.js/Express ou Python/FastAPI - escolha a melhor opção leve).
- Criar os scripts de criação do banco de dados (SQLite/PostgreSQL) com as tabelas `motoboys` e `pedidos`.
- Criar script de seed/povoamento inicial para testes de dev.
*Entregável:* Estrutura de pastas, arquivo de configuração do servidor e scripts de banco executáveis.

### ETAPA 2: Módulo de Autenticação e API do Motoboy
- Criar a rota de Login do Motoboy (`POST /api/auth/login`) usando telefone e senha.
- Criar rotas para gerenciar entregas do motoboy (`POST /api/pedidos/iniciar` e `POST /api/pedidos/finalizar`).
- Criar interface Web Mobile (HTML/JS/Tailwind CSS) simples e otimizada para o motoboy logar e registrar pedidos no celular.
*Entregável:* API funcional + Tela Mobile do Motoboy.

### ETAPA 3: Integração do Backend com a API REST do Traccar
- Criar o serviço backend para consumir a API REST local do Traccar (porta `8082`, endpoint `/api/positions`).
- Desenvolver o mecanismo que cruza as posições do Traccar com os pedidos que estão com status `em_rota` no nosso banco de dados.
- Criar a rota da API da cozinha/admin (`GET /api/admin/posicoes-mapa`).
*Entregável:* Serviço de consulta de GPS consolidado com os pedidos ativos.

### ETAPA 4: Painel Admin/Cozinha (Mapa + Lista de Pedidos)
- Criar a interface Desktop para a cozinha/restaurante.
- Implementar a tabela lateral com busca por número de pedido e status em tempo real.
- Implementar o mapa interativo usando **Leaflet.js** e **OpenStreetMap** exibindo os pinos dos motoboys, nomes e pedidos que estão carregando.
- Configurar o polling automático de atualização do mapa a cada 5 segundos.
*Entregável:* Painel Web da Cozinha 100% integrado ao mapa.

---

## COMANDO DE INICIALIZAÇÃO

Por favor, confirme que leu os arquivos de referência (`PROMPT_INICIAL_ANTIGRAVITY.md`, `ESPECIFICACAO_TECNICA_E_BANCO.md` e `GUIA_PASSO_A_PASSO_DE_INSTALACAO.md`), apresente um resumo da stack escolhida e **inicie imediatamente o desenvolvimento da ETAPA 1**. 

Não avance para a Etapa 2 até que eu revise e aprove a Etapa 1.