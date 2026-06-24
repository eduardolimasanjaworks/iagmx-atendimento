# Debug Session: chat-no-response-8525
- **Status**: [OPEN]
- **Issue**: IA nao responde ao contato `5512997918525` e o monitor `/phone` nao reflete as mensagens inbound do usuario
- **Debug Server**: pending
- **Log File**: .dbg/trae-debug-log-chat-no-response-8525.ndjson

## Hypotheses
- O inbound do contato nao chega no webhook consumido pelo `iagmx-atendimento`.
- O inbound chega, mas e descartado antes de gravar historico/estado do monitor.
- O historico grava, mas o endpoint `/api/monitor/telefone` monta ou filtra errado este telefone.
- A IA processa o lote, mas o envio cai em fila, canal indisponivel ou instancia errada.

## Plan
- Coletar evidencia do estado do contato, do monitor e da trilha runtime atual.
- Instrumentar so os pontos minimos se os logs existentes nao bastarem.
- Reproduzir com o telefone `5512997918525`.
- Corrigir com a menor mudanca possivel.
- Validar no monitor e no envio real antes de encerrar.

## Findings
- `GET /api/atendimento/contato/5512997918525` mostrou `ia_ativa_efetiva=true`, logo o bloqueio nao era pausa local.
- `GET /api/monitor/telefone?telefone=5512997918525` mostrou apenas 1 linha `empresa`, sem `user`, trace ou fila.
- A reproducao real do usuario nao gerou nenhum evento de `webhook`, `historico`, `debounce` ou `envio` no debug server; so o monitor continuou lendo o mesmo snapshot antigo.
- A causa raiz confirmada foi a conexao `gmx-atendimento-v2` estar `open`, mas com `GET /webhook/find/gmx-atendimento-v2 => null`.
- Isso deixava o WhatsApp conectado sem entregar `MESSAGES_UPSERT` para `https://iagmx.sanjaworks.com/webhook/evolution`.

## Fix Applied
- O webhook do `gmx-atendimento-v2` foi criado manualmente com `HTTP 201` para `https://iagmx.sanjaworks.com/webhook/evolution`.
- Foi criado o modulo `evolution-webhook.ts` para validar e restaurar automaticamente esse webhook quando o painel consultar status, QR ou reconexao.
- A garantia do webhook foi ligada em `evolution-instancia.ts`.
- Foi adicionado teste deterministico em `evolution-webhook.test.ts`.
