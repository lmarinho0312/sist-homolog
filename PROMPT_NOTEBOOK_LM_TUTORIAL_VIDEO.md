# 🎬 ROTEIRO E PROMPT PARA CRIAÇÃO DE VÍDEO TUTORIAL NO NOTEBOOK LM

> **Instruções de Uso**:
> 1. No **NotebookLM** (https://notebooklm.google.com), crie um novo Notebook chamado **"Tutorial do Entregador — Ao Ponto Carnes"**.
> 2. Faça o upload do arquivo `MANUAL_DO_MOTOBOY.md` como **Fonte principal**.
> 3. Cole o prompt abaixo no campo de geração de Roteiro de Vídeo ou na caixa de chat do NotebookLM para gerar o roteiro completo de locução e cenas, ou gere o "Áudio Overview / Deep Dive".

---

## 📋 PROMPT COMPLETO PARA COPIAR E COLAR NO NOTEBOOK LM:

```text
Você é um diretor de produção audiovisual e instrutor operacional sênior especializado em treinamento de equipes de delivery e logística.

Com base exclusivamente no manual técnico do sistema "Ao Ponto Entregas" fornecido como fonte, crie um Roteiro Completo para Vídeo Tutorial (passo a passo) voltado para os entregadores (motoboys) do restaurante Ao Ponto Carnes (Teresópolis/RJ).

### OBJETIVOS DO VÍDEO:
1. Ensinar os novos entregadores a utilizarem 100% dos recursos do aplicativo web no dia a dia.
2. Tirar todas as dúvidas operacionais sobre cadastro, aprovação de conta, GPS, retirada de pedidos, contato com clientes e fechamento de taxas.
3. Transmitir profissionalismo, agilidade e incentivar a equipe a usar a tecnologia para ganhar mais dinheiro com mais organização.

### TOM E LINGUAGEM:
- Tom: Dinâmico, prático, motivador, amigável e direto ao ponto.
- Linguagem: Português brasileiro coloquial e natural (ex: "Fala pessoal", "direto na palma da mão", "sem complicação", "partiu entrega"). Evite termos excessivamente acadêmicos ou robóticos.

### ESTRUTURA DO ROTEIRO:
Divida o roteiro em Cenas cronológicas, informando para cada cena:
- [TEMPO ESTIMADO] (Ex: 00:00 - 00:30)
- [TELA / IMAGEM EXIBIDA]: Indique qual tela do aplicativo deve aparecer na tela (use como referência os prints: 01_rota_ativa, 02_localizador_central, 03_proximos_pedidos, 04_balcao_pedidos, 05_perfil_historico).
- [LOCUÇÃO / NARRADOR]: O texto exato que o narrador deve falar (ou o diálogo caso opte por dois apresentadores).
- [ELEMENTOS VISUAIS E ANOTAÇÕES]: Destaques na tela (setas, círculos nos botões, zoom no PIN, etc.).

---

### TÓPICOS OBRIGATÓRIOS QUE DEVEM SER COBERTOS NO ROTEIRO:

1. **Abertura & Apresentação**:
   - Boas-vindas à equipe de entregadores da Ao Ponto Carnes.
   - Apresentação rápida do novo aplicativo "Ao Ponto Entregas" e seus benefícios (rota no GPS com um toque, taxas calculadas automaticamente pela tabela de bairros, controle de corridas).

2. **Primeiro Acesso, Cadastro e Aprovação**:
   - Como se cadastrar com Nome, WhatsApp e Senha.
   - Explicação da Trava de Aprovação: o cadastro fica aguardando liberação da administração para definir a equipe (VELOZ ou SPEED) e garantir a segurança do grupo.
   - Permissão de GPS: explicar por que o entregador DEVE sempre clicar em "Permitir durante o uso do app" (sem GPS ativo a cozinha não sabe onde ele está e a corrida não é monitorada). Mostrar o selo verde do GPS ativo no topo da tela.

3. **Tela Início & Rota Ativa (Print 01)**:
   - Visualização do cabeçalho com a identificação do entregador e sua equipe (VELOZ / SPEED).
   - Apresentação do Cartão de Pedido: número (#6370), tempo em rota, nome do cliente e endereço completo.
   - Destaque para o valor em verde da "Taxa oficial de repasse", calculada automaticamente pelo bairro.

4. **Contato com o Cliente sem Sobrecarga na Cozinha (Print 02)**:
   - Explicar o que é o **LOCALIZADOR / PIN** e o botão Copiar.
   - **O botão verde "LIGAR CENTRAL" (iFood / 99Food)**: Instruir como agir caso chegue ao endereço e o cliente não atenda ao interfone. O motoboy clica em "Ligar Central", a discagem 0800 abre na hora no discador, ele digita o PIN e a plataforma liga para o cliente gratuitamente e sem expor dados. Ressaltar que NÃO é necessário ligar para a cozinha.

5. **Navegação com GPS e Finalização da Entrega (Print 02)**:
   - Botão amarelo **"VER ROTA NO MAPA"**: abre direto o Google Maps ou Waze no celular com o endereço preenchido.
   - Botão vermelho **"FINALIZAR ENTREGA"**: tocar assim que entregar o pedido nas mãos do cliente para registrar o horário de chegada e somar a taxa no fechamento.

6. **Múltiplas Entregas e Fila de Pedidos (Print 01 e Print 03)**:
   - Explicar as abas no topo da tela quando o entregador está com 2 ou mais entregas na bag (ex: Entrega 2, Entrega 3).
   - Explicar a seção **"Próximos Pedidos"** e o botão **"Alternar para esta Rota"**: se o entregador conhece a cidade e percebe que uma entrega da fila fica antes no trajeto, ele pode inverter a ordem com um toque!

7. **Aba Balcão — Retirada no Balcão e Tripla Conferência Obrigatória (Print 04)**:
   - REGRA FUNDAMENTAL E OBRIGATÓRIA: Enfatizar fortemente que o motoboy NUNCA deve retirar pedidos no aplicativo antes da cozinha ter atribuído/organizado a saída. Ele NÃO pode puxar pedidos por conta própria.
   - O motoboy só clica em "RETIRAR PEDIDO" no aplicativo no EXATO MOMENTO físico em que for até o balcão retirar a sacola e a comanda.
   - PROCEDIMENTO DE TRIPLA CONFERÊNCIA OBRIGATÓRIA: Antes de tocar em "Retirar Pedido", o motoboy DEVE conferir 3 itens na comanda física comparando com a tela:
     1. O **Número do Pedido** (ex: #4773);
     2. O **Nome do Cliente**;
     3. O **Endereço de Entrega**.
   - Somente após conferir os 3 dados, ele toca em "RETIRAR PEDIDO" e sai para a entrega.

8. **Aba Perfil — Transparência e Fechamento Financeiro (Print 05)**:
   - Mostrar os filtros "Hoje", "Esta Semana" e "Este Mês".
   - Exibir o painel de ganhos: quantidade de entregas e o **Total a Receber em R$**.
   - Mostrar o histórico auditado com cada corrida, cliente, bairro atendido e o valor certinho creditado (+R$ 7,00, +R$ 8,00, +R$ 10,00, +R$ 13,00, etc.).

9. **Encerramento & Boas Práticas**:
   - Resumo das regras de ouro: GPS sempre ativo, tripla conferência no balcão (número, nome e endereço), uso do PIN e central telefônica se o cliente não atender, e finalização imediata da entrega no ato da entrega.
   - Mensagem de incentivo e boas corridas a todos!
```
