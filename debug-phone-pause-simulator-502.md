# Debug Session: phone-pause-simulator-502
- **Status**: [OPEN]
- **Issue**: `/phone` mostra erro de pausa global, endpoints do monitor retornam `502`, inicio de jornada retorna `400` e o simulador atual nao representa uma conversa operacional convincente
- **Debug Server**: pending
- **Log File**: .dbg/trae-debug-log-phone-pause-simulator-502.ndjson

## Hypotheses
1. `502` acontece por falha do `iagmx_app` ao acessar dependencias runtime (Directus, Redis ou servicos ERP).
2. A mensagem de restricao da pausa global ainda vem de frontend antigo em cache ou de deploy parcial.
3. O `400` de iniciar jornada e validacao de payload/rota, nao erro sistemico.
4. O simulador atual e uma auditoria estatica montada no backend, nao pipeline realtime.
5. As jornadas ainda estao curtas em alguns cenarios por fallback generico de simulacao.

## Evidence Plan
- Consultar health e logs do container `iagmx_app`
- Reproduzir `/api/pausa`, `/api/monitor/telefone`, `/api/atendimento/contato` e `/api/admin/jornadas-teste/iniciar`
- Confirmar se os assets servidos do `/phone` ainda carregam a mensagem de restricao antiga
- Mapear se o simulador depende so de `/api/admin/simulador/auditoria`

## Notes
- Nenhuma logica de negocio alterada ate coletar evidencia runtime suficiente.

## Runtime Evidence
- `/api/pausa` respondeu `200` com `modoGlobal=default_off` no runtime local apos o deploy.
- `/api/monitor/telefone?telefone=5512997918525` respondeu `200` e mostrou `IA pausada para ajuda humana`.
- `/api/atendimento/contato/5512997918525` respondeu `200` com `precisa_atendimento=true`.
- O asset servido `phone-global-pause.js` ainda continha a mensagem de restricao antiga antes do patch.
- `/api/admin/simulador/auditoria` respondeu `200` e confirmou que o simulador atual e um payload de auditoria do backend, nao replay realtime do pipeline.
