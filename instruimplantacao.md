# GUIA DE INSTALAÇÃO E CONFIGURAÇÃO (PASSO A PASSO)

## PASSO 1: CONFIGURAÇÃO DO COMPUTADOR DO RESTAURANTE (SERVIDOR)

1. **Instalar o Traccar Server (Gratuito):**
   - Acesse o site oficial do Traccar em traccar.org e baixe o instalador correspondente ao seu sistema operacional (Windows, Linux ou Mac).
   - Execute o instalador padrão. O serviço rodará automaticamente em segundo plano.
   - Acesse no navegador do computador da loja: http://localhost:8082
   - Crie a conta de administrador do Traccar na primeira inicialização.

2. **Expor o Servidor para a Internet (Custo Zero - Cloudflare Tunnel / Ngrok):**
   - Como o celular do motoboy estará no 4G/5G na rua, ele precisa alcançar a máquina do restaurante.
   - Baixe e execute o ngrok ou Cloudflare Tunnel (cloudflared).
   - Comando exemplo via ngrok para liberar a porta de comunicação do GPS:
     ngrok http 5055
   - Guarde a URL pública gerada (exemplo: http://3a1b-189-0-0-1.ngrok-free.app).

---

## PASSO 2: CONFIGURAÇÃO DO CELULAR DO MOTOBOY

1. Instale o app "Traccar Client" na Google Play Store ou Apple App Store (100% Gratuito).
2. Abra o aplicativo no celular do entregador e configure apenas 3 campos:
   - URL do Servidor: Insira a URL gerada pelo Ngrok/Cloudflare (exemplo: http://3a1b-189-0-0-1.ngrok-free.app).
   - Identificador do Dispositivo: Digite o número do telefone do motoboy (exemplo: 11999998888).
   - Frequência / Intervalo: Configure para 5 segundos.
3. Ative a chave "Serviço de Rastreamento".
4. Nas configurações de aplicativos do Android/iOS no celular do motoboy, garanta a permissão de "Localização: Permitir sempre (em segundo plano)" e desative a otimização de bateria para o app Traccar Client.

---

## PASSO 3: VINCULAR DISPOSITIVOS NO PAINEL TRACCAR

1. Abra http://localhost:8082 no computador do restaurante.
2. Vá no menu "Dispositivos" e clique no botão (+).
3. Cadastre o Nome do Motoboy (exemplo: "João Silva") e no campo Identificador, coloque exatamente o mesmo número digitado no celular dele (exemplo: 11999998888).

---

## PASSO 4: EXECUTAR A APLICAÇÃO WEB CUSTOMIZADA

1. Suba a aplicação construída pelo Anti-Gravity no computador do restaurante.
2. Os motoboys acessarão a Web App criada para registrar os números de pedidos ao sair para entrega.
3. O painel da cozinha exibirá o mapa unificado (Leaflet + OpenStreetMap) rodando em tempo real no monitor do restaurante.