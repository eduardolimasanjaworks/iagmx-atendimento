# Debug Session: whatsapp-auxiliar-qr
- **Status**: [OPEN]
- **Issue**: Painel do `/phone` mostra alvo auxiliar com sessao inconsistente, mas `Abrir QR da conexao atual` retorna `503` e depois `429`, impedindo recuperar o pareamento esperado.
- **Expected**: Ao pedir QR do `auxiliar_teste`, o painel deve exibir um QR utilizavel ou uma mensagem operacional deterministica que nao dependa de tentativa repetida cega.
- **Observed**: `GET /api/whatsapp/alvos/auxiliar_teste/qrcode` retorna `503` e chamadas subsequentes entram em `429`; o alvo fica preso em `stale_open`.
- **Scope**: `iagmx-atendimento` rotas WhatsApp e integracao com Evolution do alvo auxiliar.
- **Started At**: 2026-06-24T16:09:00Z

## Hypotheses
1. O endpoint `/instance/connect/:instancia` do auxiliar esta respondendo sem `base64` quando a sessao entra em `stale_open`, e o backend devolve `503` sem acao operacional suficiente.
2. O cooldown global de `qrcode` esta mascarando a reproduçao e piorando a UX porque vale para todos os alvos/consultas em vez de ser por alvo+acao.
3. A Evolution do auxiliar exige `logout` antes de gerar QR novo nesse estado, mas a UI bloqueia essa recuperaçao porque `permiteReconectar=false`.
4. O frontend do `/phone` esta acionando `status` e `qrcode` em sequencia curta e consumindo o cooldown mesmo quando a primeira tentativa falha.
5. O contrato atual do auxiliar esta semanticamente errado: “abrir QR da conexao atual” promete algo impossivel quando o estado real e `stale_open`.

## Evidence Log
- A coletar via Debug Server, logs do app e requests reproduzidos manualmente.

## Next Steps
1. Subir Debug Server da sessao.
2. Confirmar hipoteses com logs de `status`, `qrcode` e chamadas Evolution do auxiliar.
3. So depois aplicar a menor correcao possivel.
