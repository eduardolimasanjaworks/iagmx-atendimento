[OPEN] Debug session: whatsapp-delay-response

## Sintoma
- O usuario relata delay alto no WhatsApp da i.a.
- Conversa informada:
  - `ola`
  - `ola`
  - `ola`
  - resposta da i.a: `Oi`
  - depois: `quem e voce?`

## Objetivo
- Confirmar se o fluxo esta realmente operacional.
- Medir onde o atraso acontece: webhook, debounce, geracao, ferramenta ou envio.
- Confirmar se a mensagem mais recente entrou no pipeline.

## Hipoteses
1. O atraso principal esta no tempo de debounce/humanizacao e nao em erro funcional.
2. A mensagem entra no webhook, mas fica represada em fila ou lote antes de gerar resposta.
3. A geracao da resposta esta lenta por dependencia externa ou ferramenta interna.
4. A resposta fica pronta, mas o envio ao WhatsApp demora ou falha antes de chegar.
5. A mensagem `quem e voce?` nao foi processada ou caiu em um fluxo diferente do esperado.

## Evidencias
- O atraso configurado nao e a causa principal:
  - `debounceMs: 800`
  - `delayMinMs: 200`
  - `delayMaxMs: 600`
  - `digitandoMinMs: 300`
  - `digitandoMaxMs: 800`
- O contato `551236002518` entrou no pipeline e recebeu resposta quando a sessao estava aberta.
- O trace mostrou geracao em cerca de 6,9s e falha no envio com `Connection Closed`.
- Os logs da Evolution mostraram a sequencia:
  - QR lido e sessao `open`
  - `stream:error` com codigo `515`
  - reconexao curta
  - primeiro envio
  - `401 conflict / device_removed`
  - `LOGOUT`
- A instancia persiste em volume e banco; nao e perda de sessao por falta de persistencia.
- Nao foi encontrada outra instância local disputando o mesmo numero neste servidor.
- A versao atual da Evolution no stack e `v2.3.7` (imagem de 2025-12-05).
- Existe uma imagem mais nova no mesmo repositório (`latest`, criada em 2026-05-06), candidata a conter correcoes posteriores na pilha Baileys/Evolution.

## Hipoteses revisadas
1. Atraso por configuracao interna: rejeitada.
2. Mensagem presa no debounce: rejeitada.
3. Geracao travando como causa principal: rejeitada.
4. Falha de envio por sessao derrubada: confirmada.
5. Sessao derrubada por conflito externo certo: inconclusiva.
6. Sessao derrubada por bug conhecido da versao atual Evolution/Baileys apos `515 -> 401`: fortemente suportada pela evidencia.

## Proximo passo
- Corrigir a UX dos botoes e da mensagem de status para refletir o comportamento real.
- Atualizar a imagem da Evolution para a build mais nova disponivel no mesmo repositório, mantendo persistencia e mesma configuracao do stack.
