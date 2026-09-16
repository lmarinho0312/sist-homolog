const { parseComandaTexto } = require('./comanda-parser');
const { decodeEscPosBuffer } = require('./escpos-decoder');

console.log('🧪 TESTANDO EXTRATOR DE COMANDAS (iFood, 99Food, Cardápio Web)...\n');

// 1. Exemplo de Comanda iFood
const comandaIfoodTexto = `
------------------------------------------------
               IFOOD ENTREGA                    
------------------------------------------------
PEDIDO: #4512
Data: 10/09/2026 12:45
Cliente: Carlos Eduardo Silva
Tel: (21) 98765-4321

ENTREGA:
Rua Carmela Dutra, 120 - Apto 302
Bairro: Agriões - Teresópolis / RJ

ITENS:
1x X-Tudo Artesanal com Bacon ....... R$ 38,00
1x Coca-Cola Lata 350ml ............. R$ 7,00

Subtotal: ........................... R$ 45,00
Taxa de entrega: .................... R$ 8,50
TOTAL: .............................. R$ 53,50
------------------------------------------------
`;

// 2. Exemplo de Comanda 99 Food
const comanda99FoodTexto = `
================================================
               99 FOOD DELIVERY                 
================================================
Pedido #9923
Cliente: Juliana Mendes
Telefone: (21) 99123-9876
Endereço: Avenida Lúcio Meira, 450 - Loja 2
Bairro: Várzea
Frete: R$ 6,00
Total: R$ 62,00
================================================
`;

// 3. Exemplo de Comanda Cardápio Web
const comandaCardapioWebTexto = `
************************************************
              CARDÁPIO WEB                      
************************************************
Pedido nº: #8801
Data: 10/09/2026
Nome: Roberto de Alencar
WhatsApp: (21) 99887-1122
Entregar em: Rua Djalma Monteiro, 88
Bairro: Fátima
Taxa: R$ 7,00
Valor Total: R$ 79,90
************************************************
`;

console.log('--- 1. PARSING IFOOD ---');
const p1 = parseComandaTexto(comandaIfoodTexto);
console.log(p1);

console.log('\n--- 2. PARSING 99 FOOD ---');
const p2 = parseComandaTexto(comanda99FoodTexto);
console.log(p2);

console.log('\n--- 3. PARSING CARDÁPIO WEB ---');
const p3 = parseComandaTexto(comandaCardapioWebTexto);
console.log(p3);

// 4. Teste de decodificação ESC/POS binária simulada
console.log('\n--- 4. DECODIFICAÇÃO RAW ESC/POS ---');
const rawEscPosBuffer = Buffer.concat([
  Buffer.from([0x1B, 0x40]), // ESC @ (Init)
  Buffer.from([0x1B, 0x61, 0x01]), // ESC a 1 (Center)
  Buffer.from('IFOOD RESTAURANTE\n'),
  Buffer.from('Pedido #5520\nCliente: Marcelo Araujo\n'),
  Buffer.from('Entrega: Rua Paranapanema, 55 - Bairro: Centro\n'),
  Buffer.from('Taxa de entrega: R$ 9,00\n'),
  Buffer.from([0x1D, 0x56, 0x41, 0x00]) // GS V (Cut)
]);

const textoDecodificado = decodeEscPosBuffer(rawEscPosBuffer);
console.log('Texto Decodificado:\n', textoDecodificado);
const p4 = parseComandaTexto(textoDecodificado);
console.log('\nParsed da comanda binária:', p4);

if (p1 && p1.pedidoId === '4512' && p1.origem === 'IFOOD' &&
    p2 && p2.pedidoId === '9923' && p2.origem === '99FOOD' &&
    p3 && p3.pedidoId === '8801' && p3.origem === 'CARDAPIO_WEB' &&
    p4 && p4.pedidoId === '5520') {
  console.log('\n✅ TODOS OS TESTES DE PARSING PASSARAM COM 100% DE SUCESSO!');
} else {
  console.error('\n❌ Falha em algum dos testes de parsing.');
  process.exit(1);
}
