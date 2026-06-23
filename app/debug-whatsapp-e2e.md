# [OPEN] Debug Session: whatsapp-e2e

## Objetivo
- Validar o fluxo ponta a ponta do WhatsApp no `iagmx-atendimento`
- Confirmar se mensagens entram, passam pelo debounce, usam tools adequadas e saem pela Evolution
- Detectar pontos de falha antes do teste manual do usuario

## Sintoma
- O usuario quer testar no WhatsApp e prevenir erros de envio, recebimento e uso inadequado de tools

## Hipoteses Iniciais
1. A mensagem entra no webhook, mas falha antes de chegar ao pipeline por filtro, parse ou debounce
2. A inferencia responde texto, mas a extração ou execução das tools falha silenciosamente
3. A resposta é gerada, porém o envio pela Evolution falha ou fica pendente sem observabilidade suficiente
4. O fluxo usa a tool errada porque o contexto ERP ou o roteamento de intenção está incompleto no momento da inferência
5. Há perda de confiabilidade na transição entre mensagem recebida, histórico, tools e confirmação de envio

## Evidencias Coletadas
- Ainda não coletadas

## Instrumentacao Planejada
- Webhook de entrada WhatsApp
- Debounce e agrupamento
- Roteamento de intenção
- Extração e execução de tools
- Envio de resposta pela Evolution

## Status
- Aguardando instrumentação inicial
