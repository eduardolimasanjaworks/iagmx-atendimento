# Plano de correcao - auditoria multimotoristas

**Criado:** 2026-06-24  
**Objetivo:** fechar os riscos criticos encontrados na auditoria do fluxo `embarque -> ranking -> disparo -> negociacao -> humano`.  
**Escopo:** iagmx + gmx + Directus, sem gambiarra, com trilha auditavel e comportamento deterministico.

## Execucao desta sessao

- Backend:
  - estado real do embarque atualizado em aceite, recusa e escalonamento
  - lock real por telefone no disparo
  - fila humana real criada e exposta por API admin
  - match operacional exato no backend
  - geocodificacao futura persistida na disponibilidade
- Frontend:
  - regras operacionais migradas para campos reais com fallback legado
  - painel de fila humana adicionado ao quadro de embarques
  - correlacao de rota ajustada para match exato
  - ranking e mapa preparados para usar coordenadas futuras persistidas
- Directus:
  - `config_rotas`: campos reais de regras operacionais aplicados
  - `ofertas_intervencao_humana`: colecao criada
  - `disponivel`: campos de coordenadas futuras e `gps_timestamp` aplicados
  - `embarques`: campos de aceite/manual review aplicados

## Decisoes de arquitetura

1. **Estado real do embarque vira fonte de verdade operacional**
   - `historico_ofertas` continua sendo trilha de auditoria.
   - `embarques` passa a refletir o estado vivo da oferta:
     - `ofertado`
     - `aceito`
     - `recusado`
     - `aguardando_humano`
   - Flags de revisao humana deixam de ser apenas cosmeticas.

2. **Trava por motorista e por telefone entra no fluxo real**
   - O bloqueio deixa de existir so na simulacao.
   - Abertura de oferta usa lock Redis por `telefone`.
   - Aceite, recusa e cancelamento liberam o lock.
   - Escalonamento humano mantem o lock ate resolucao explicita.

3. **Fila humana passa a existir como entidade real**
   - Nao basta notificar operador por WhatsApp.
   - Cada escalonamento cria ou atualiza um item auditavel de fila.
   - A fila precisa ser consultavel e resolvivel por API e UI.

4. **Match de rota vira exato e normalizado**
   - Nada de `includes`.
   - A chave operacional passa a ser derivada de:
     - origem normalizada
     - destino normalizado
     - operacao normalizada
     - capacidade normalizada

5. **Regras operacionais saem do campo `evidencia`**
   - `evidencia` volta a ser campo de negocio livre.
   - Regras passam para colunas reais em `config_rotas`.
   - Leitura antiga continua aceitando legado enquanto houver dado antigo.

6. **Geocodificacao fica auditavel**
   - GPS atual continua prioritario.
   - Local futuro passa a guardar lat/lng, fonte e timestamp.
   - O backend tenta resolver texto para coordenada de forma deterministica e reaproveitavel.

## Ordem de implementacao

### Bloco A - Corrigir o que quebra a demo

1. Atualizar `embarques` no fluxo real de aceite, recusa e escalonamento.
2. Adicionar lock real por motorista.
3. Criar fila humana real.
4. Expor fila humana por endpoint admin.

### Bloco B - Corrigir o que torna o matching superficial

1. Trocar match frouxo por chave exata.
2. Persistir regras operacionais em campos reais.
3. Persistir geocodificacao da localizacao futura.
4. Fazer ranking preferir coordenadas persistidas.

### Bloco C - Fechar o circuito no portal

1. Atualizar hooks de rotas.
2. Atualizar CRUD de rotas para novos campos.
3. Exibir fila humana no GMX.
4. Refletir novos estados no embarque e na oferta.

### Bloco D - Garantia de nao esquecimento

1. Atualizar plano mestre desta base.
2. Adicionar testes focados nos servicos novos.
3. Rodar diagnosticos nos arquivos alterados.
4. Registrar no handoff final o que foi executado e o que ficou como legado compativel.

## Campos a criar ou consolidar

### `embarques`

- `needs_manual_review`
- `manual_review_completed`
- `manual_review_owner`
- `manual_review_at`
- `manual_review_note`
- `accepted_motorista_id`
- `ultimo_evento_oferta_em`

### `config_rotas`

- `preferencia_proximidade`
- `gps_max_horas`
- `passo_negociacao_modo`
- `passo_negociacao_valor`
- `escalar_humano_no_teto`

### `disponivel`

- `local_liberacao_prevista_latitude`
- `local_liberacao_prevista_longitude`
- `local_liberacao_prevista_fonte`
- `local_liberacao_prevista_geocoded_at`
- `gps_timestamp`

### `ofertas_intervencao_humana`

- `embarque_id`
- `motorista_id`
- `telefone`
- `status`
- `motivo`
- `valor_ofertado`
- `valor_pedido_motorista`
- `valor_minimo`
- `valor_maximo`
- `origem`
- `destino`
- `assumido_por`
- `assumido_em`
- `resolvido_em`
- `resolucao`
- `observacao`

## Regras operacionais decididas

- Ao disparar oferta, o sistema recusa novo disparo se outro embarque ja estiver usando o mesmo motorista.
- Ao aceitar:
  - grava historico
  - atualiza `embarques`
  - limpa fila humana pendente
  - libera lock
- Ao recusar:
  - grava historico
  - atualiza `embarques`
  - libera lock
- Ao escalonar:
  - grava historico
  - atualiza `embarques`
  - cria fila humana
  - mantem lock
- Ao resolver manualmente:
  - conclui fila
  - limpa flag humana do embarque
  - libera lock

## Compatibilidade legado

- Leitura antiga de `GMX_RULES::` continua ativa durante a transicao.
- `local_disponibilidade` continua espelhado para nao quebrar leitura antiga.
- Fallback estatico de cidades continua como ultima linha de defesa, mas deixa de ser a base principal.

## Critério de pronto

- Um embarque nao fica mais sem estado apos a resposta do motorista.
- Um motorista nao recebe duas ofertas simultaneas.
- Um escalonamento gera caso humano rastreavel.
- O ranking nao depende apenas de `includes` e de mapa fixo de cidades.
- O portal consegue enxergar regras reais e fila humana.
