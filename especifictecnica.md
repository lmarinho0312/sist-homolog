# ESPECIFICAÇÃO TÉCNICA DO PROJETO E ESTRUTURA DO BANCO DE DADOS

## 1. MODELAGEM DO BANCO DE DADOS (SQLite / PostgreSQL)

### Tabela: `motoboys`
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT / UUID
- `nome`: TEXT NOT NULL
- `telefone`: TEXT UNIQUE NOT NULL  -- Usado como login
- `senha`: TEXT NOT NULL             -- Hash da senha
- `traccar_device_id`: TEXT UNIQUE NOT NULL -- Identificador cadastrado no app Traccar Client
- `criado_em`: DATETIME DEFAULT CURRENT_TIMESTAMP

### Tabela: `pedidos`
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT / UUID
- `numero_pedido`: TEXT NOT NULL
- `motoboy_id`: INTEGER, FOREIGN KEY REFERENCES `motoboys(id)`
- `status`: TEXT NOT NULL DEFAULT 'em_rota' -- Enum: 'em_rota', 'entregue', 'cancelado'
- `data_inicio`: DATETIME DEFAULT CURRENT_TIMESTAMP
- `data_fim`: DATETIME NULL

---

## 2. INTEGRANDO COM A API DO TRACCAR

O Traccar Server disponibiliza uma API REST na porta local `8282` ou `8082`. 
O backend do nosso sistema deve consultar periodicamente (ou sob demanda) o estado dos dispositivos:

1. **Obter Última Posição dos Motoboys:**
   - **Endpoint Traccar:** `GET http://localhost:8082/api/positions`
   - **Cabeçalho:** `Authorization: Basic [CREDENCIAIS_BASE64_DO_TRACCAR]`
   - **Retorno:** JSON com `deviceId`, `latitude`, `longitude`, `speed`, `fixTime`.

2. **Cruzamento de Dados (Lógica da API do nosso Backend):**
   - Rota customizada do nosso backend: `GET /api/admin/mapa-data`
   - O backend busca todos os `pedidos` com `status = 'em_rota'`.
   - Consulta a API do Traccar para obter a latitude e longitude correspondentes ao `traccar_device_id` de cada motoboy.
   - Retorna um JSON consolidado para o Frontend do Admin:
```json
[
  {
    "motoboy_nome": "João Silva",
    "motoboy_telefone": "11999998888",
    "latitude": -23.55052,
    "longitude": -46.633308,
    "pedidos": ["1042", "1043"],
    "ultima_atualizacao": "2026-08-11T12:00:00Z"
  }
]