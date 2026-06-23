[OPEN] Debug session: whatsapp-no-response

# Sintoma
- A i.a no WhatsApp "parou" e nao esta respondendo direito.
- Objetivo desta sessao: descobrir, com evidencia de runtime, em qual etapa o fluxo quebra.

# Hipoteses Iniciais
1. O webhook da Evolution esta recebendo a mensagem, mas o app nao esta processando o evento corretamente.
2. O app esta processando a mensagem, mas a sessao WhatsApp caiu ou ficou invalida na hora de enviar a resposta.
3. O pipeline da i.a travou em debounce, fila pendente ou ferramenta interna e a resposta nao chegou ao envio.
4. A Evolution esta conectada, mas a instabilidade da sessao reapareceu e o envio falha logo apos gerar a resposta.
5. Alguma regressao recente no deploy deixou a rota, credencial ou integracao externa indisponivel.

# Plano
1. Confirmar saude dos containers e rotas principais.
2. Coletar logs recentes de runtime do app e da Evolution.
3. Reproduzir ou localizar a ultima mensagem recebida e seguir o rastro ate o envio.
4. So depois da evidencia, aplicar a menor correcao necessaria.

# Evidencias
- Containers principais em pe:
  - `iagmx_app` up
  - `iagmx_evolution` up
  - `GET /health` do app respondeu `200`
- A mensagem entra no app e a i.a gera resposta:
  - `Mensagem enfileirada no debounce`
  - `Processando lote`
  - `Conversa rapida (1 passada LLM)`
  - texto gerado: `E ai, tudo certo? O que voce precisa hoje?`
- A falha ocorre no envio pelo canal WhatsApp:
  - `sendPresence falhou (400)` com `Error: Connection Closed`
  - `Falha no envio Evolution — enfileirando` com timeout
  - a resposta pendente expira sem ser entregue
- Estado atual da instancia na Evolution:
  - `connectionState/gmx-atendimento-v2` retornou `state: "close"`
  - `fetchInstances` retornou `disconnectionReasonCode: 401`
  - `disconnectionObject` indica `conflict` com `type: "device_removed"`
  - `disconnectionAt: 2026-06-19T20:54:42.919Z`
- Investigacao de disputa paralela:
  - `docker ps` nao mostrou outra Evolution local rodando para esta stack
  - o banco `evolution` tem apenas uma instancia persistida: `gmx-atendimento-v2`
  - existe apenas um webhook configurado, apontando para `https://iagmx.sanjaworks.com/webhook/evolution`
  - nao ha `Session` ou `IntegrationSession` paralelas registradas na Evolution
  - existe um bootstrap legado ainda referenciando `gmx-atendimento` em scripts antigos, mas sem evidencia de execucao ativa nesta rodada
- Instrumentacao adicionada na rota `/api/whatsapp/*`:
  - agora a sessao registra `origin`, `referer`, `user-agent`, `hasCookie`, `hasAdminKey` e `ip`
  - validacao manual confirmou que chamadas vindas do contexto do `GMX` chegam com `origin=https://gmx.sanjaworks.com` e `hasAdminKey=true`

# Hipoteses Avaliadas
- Hipotese 1: webhook nao processa evento
  - Rejeitada. O app recebeu a mensagem e processou o lote.
- Hipotese 2: sessao caiu na hora de enviar
  - Confirmada. O envio falha com `Connection Closed`.
- Hipotese 3: pipeline travou em debounce ou fila
  - Rejeitada como causa primaria. A fila so entrou depois da falha no canal.
- Hipotese 4: a instabilidade da sessao reapareceu
  - Confirmada. A instancia esta `close` com `device_removed`.
- Hipotese 5: regressao geral de deploy/configuracao
  - Sem evidencia como causa primaria nesta rodada.
- Hipotese 6: outra instancia local da Evolution esta disputando a sessao
  - Rejeitada ate aqui. Nao apareceu segundo container, segunda instancia no banco ou segundo webhook local.
- Hipotese 7: outra interface legitima do proprio sistema dispara reconnect alem da pagina publica
  - Confirmada parcialmente. O `GMX` tambem consegue chamar as rotas da conexao via `x-iagmx-key`, entao os reconnects podem vir de mais de um painel do proprio ecossistema.

# Resultado
- Causa operacional identificada: a IA continua funcionando ate gerar a resposta, mas a sessao WhatsApp ativa foi removida e o envio nao consegue concluir.
- Estado atual da investigacao de disputa:
  - sem evidencia de segunda instancia local ativa
  - com evidencia de mais de uma superficie de controle do mesmo fluxo (`GMX` e painel/pagina do `iagmx`)
  - pronta para capturar a proxima tentativa real de `reconectar` e identificar sua origem exata
