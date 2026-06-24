# Debug Session: oferta-aumento-pausa
- **Status**: [OPEN]
- **Issue**: na oferta proativa, a mensagem `o quanto voce pode aumentar pra mim?` cai em resposta vaga e pausa humana, em vez de consultar a faixa negociavel e responder objetivamente
- **Debug Server**: pending
- **Log File**: .dbg/trae-debug-log-oferta-aumento-pausa.ndjson

## Hypotheses
1. A pergunta de aumento nao e reconhecida pelo motor de negociacao C9 e cai no LLM.
2. A faixa negociavel da rota nao chega ao fluxo, entao a IA nao sabe o maximo permitido.
3. A oferta ativa no historico nao preserva contexto suficiente para consultar a rota/valor.
4. O fallback do LLM gera texto considerado vago e aciona pausa humana.
5. O bug e correlato ao outro caso porque ambos escapam do fluxo programatico antes da resposta final.

## Evidence Plan
- Reproduzir o caso com historico de oferta real e mensagem de pedido de aumento
- Inspecionar logs e saidas do fluxo de negociacao
- Verificar se ha faixa negociavel calculada para a rota no contexto atual
- Confirmar se o fallback do LLM esta sendo atingido antes do handoff

## Notes
- Nenhuma logica de negocio alterada ate coletar evidencia suficiente.

## Runtime Evidence
- O motor C9 reproduziu `sem_faixa_erp` para a oferta `Ball - Cabo De Santo Agostinho -> F. Belém`.
- A rota existe no `config_rotas` com `id=23`, `valor_minimo=11200` e `valor_maximo=11800`.
- `buscarConfigRota()` retornou `null` porque a chave operacional exigia `capacidade=25`, ausente na mensagem disparada.
- `escalonarNegociacao()` executou e pausou o contato, mas `verificarHistoricoOfertaNoErp()` falhou e isso detonou o fallback `preciso confirmar uma informacao interna...`.

## Fix Applied
- `buscarConfigRota()` agora faz fallback deterministico por `origem + destino + operacao` quando existir um unico candidato e a diferenca for apenas `capacidade` ausente na mensagem.
- `escalonar_negociacao` nao converte mais um escalonamento ja executado em erro fatal so porque `historico_ofertas` nao confirmou o `evento_id` a tempo.

- Apos o fix, a mesma pergunta passou a casar a rota `id=23` e o motor C9 respondeu de forma programatica, sem handoff.
- O pedido `o quanto voce pode aumentar pra mim?` agora consulta a faixa e informa o teto da rota quando houver margem acima da oferta inicial.
