/**
 * Simulador compacto embutido no /phone.
 * Mostra conversas, prompt completo e efeito operacional sem abrir a visual.html.
 * Mantem a auditoria clicavel por mensagem da IA.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const convs = [
    mk('Disponibilidade com localizacao', 'Cenario 7 · fluxo-disponibilidade.ts', 'Joao Martins', '5511988881101', 'A GMX inicia, confirma status e so fecha quando tem cidade e UF', 'Motorista marcado como disponivel em Betim MG', [
      ai('a1', '09:12:00', 'Bom dia parceiro, estou atualizando a agenda da GMX aqui e preciso confirmar se voce esta vazio agora ou se ainda esta carregado', 'Fluxo C7 proativo com a GMX iniciando a conversa', [], []),
      dr('d1', '09:12:03', 'Bom dia, to vazio agora', 'Joao Martins'),
      ai('a2', '09:12:04', 'Perfeito parceiro, para eu atualizar sua agenda e te priorizar certo nas cargas de hoje me manda sua cidade e estado agora', 'Motorista confirmou status vazio, ainda falta localizacao atual', [], []),
      dr('d2', '09:12:07', 'Betim MG', 'Joao Martins'),
      ai('a3', '09:12:09', 'Fechado parceiro, atualizei sua disponibilidade em Betim MG aqui na agenda da GMX e se entrar carga no seu perfil eu te aciono', 'Com status e local validos, a IA pode registrar a disponibilidade', 'PROMPT COMPLETO\n- confirmar status\n- pedir localizacao atual\n- registrar_disponibilidade quando status e localizacao estiverem validos', [
        act('motorista_disponibilidade', 'insert', '09:12:09', { telefone: '5511988881101', cidade: 'Betim', uf: 'MG', status: 'vazio' }, 'registro id disp_1042 criado'),
      ], ['Motivo', 'Condicao SE', 'Prompt', 'Tool', 'ERP']),
    ]),
    mk('Negociacao de frete com limite', 'Cenario 8 · fluxo-negociacao.ts', 'Carlos Nogueira', '5511977773302', 'A IA tenta negociar dentro da faixa e escala quando sai do teto', 'Negociacao escalonada para humano', [
      dr('n1', '10:05:00', 'Quanto paga a rota Guarulhos para Curitiba', 'Carlos Nogueira'),
      ai('n2', '10:05:02', 'Tenho essa rota em carreta seca pagando de sete mil e cem ate sete mil e quatrocentos, se fizer sentido pra voce eu sigo com a reserva', 'Faixa autorizada consultada antes de abrir valor', '', [], ['Motivo', 'Prompt']),
      dr('n3', '10:05:09', 'Menos que oito nao fecho', 'Carlos Nogueira'),
      ai('n4', '10:05:12', 'Fechado parceiro, como seu valor saiu da minha autonomia eu vou escalar pro comercial continuar com voce', 'Motorista insistiu acima do teto e a IA saiu do limite permitido', 'PROMPT COMPLETO\n- consultar faixa\n- negociar dentro do teto\n- escalar humano acima do teto final', [
        act('negociacao_alerta', 'insert', '10:05:12', { telefone: '5511977773302', rota: 'Guarulhos SP -> Curitiba PR', pedido: 8000 }, 'alerta neg_331 criado'),
      ], ['Motivo', 'Prompt', 'ERP']),
    ]),
    mk('Onboarding com OCR', 'Cadastro OCR · config-ocr.ts', 'Paulo Vilela', '5511966662210', 'Documento entra, OCR sugere e a IA confirma sem sobrescrever no escuro', 'CNH processada e confirmada', [
      dr('o1', '11:20:00', 'Vou mandar minha CNH agora', 'Paulo Vilela'),
      ai('o2', '11:20:01', 'Perfeito parceiro, pode mandar a foto da frente da CNH que eu leio e te confirmo na sequencia', 'A IA prepara o OCR antes do anexo', '', [], ['Motivo']),
      dr('o3', '11:20:06', '[imagem_cnh_frente.jpg]', 'Paulo Vilela'),
      ai('o4', '11:20:10', 'Li sua CNH aqui e ja extrai nome, numero e validade, so confirma pra mim se seu endereco continua o mesmo do cadastro', 'OCR reconheceu a CNH e abriu confirmacao complementar', 'PROMPT COMPLETO\n- identificar documento\n- sugerir campos OCR\n- pedir confirmacao antes de gravar', [
        act('motorista_documento', 'upsert', '11:20:10', { telefone: '5511966662210', tipo: 'CNH', validade: '2029-04-11' }, 'CNH atualizada no cadastro'),
      ], ['Motivo', 'Prompt', 'ERP']),
    ]),
    mk('Canhoto da entrega', 'Canhoto · fluxo-canhoto.ts', 'Marcio Tavares', '5511955554408', 'A IA cruza o motorista com embarque ativo e vincula o comprovante correto', 'Canhoto salvo no embarque #8451', [
      dr('c1', '14:08:00', 'Cheguei na entrega, posso mandar o canhoto agora', 'Marcio Tavares'),
      ai('c2', '14:08:02', 'Pode sim parceiro, me manda a foto do canhoto dessa entrega que eu vinculo no embarque oito quatro cinco um aqui pra voce', 'Embarque ativo identificado antes de pedir o anexo', '', [], ['Motivo']),
      dr('c3', '14:08:07', '[foto_canhoto_entrega.jpg]', 'Marcio Tavares'),
      ai('c4', '14:08:10', 'Recebi parceiro, ja vinculei seu canhoto no embarque oito quatro cinco um e deixei a equipe atualizada aqui', 'Imagem valida mais embarque ativo liberam a gravacao final', 'PROMPT COMPLETO\n- validar embarque ativo\n- coletar canhoto\n- gravar comprovante vinculado ao embarque', [
        act('embarque_anexo', 'insert', '14:08:10', { embarque_id: 8451, tipo: 'canhoto', telefone: '5511955554408' }, 'anexo cmp_8451 criado'),
      ], ['Motivo', 'Prompt', 'ERP']),
    ]),
    mk('Treinamento via WhatsApp', 'Treinamento · whatsapp autorizado', 'Ana Operacoes', '5511944442211', 'Telefone autorizado vira proposta e so aplica depois da confirmacao', 'Proposta confirmada e regra ativa', [
      dr('t1', '16:22:00', 'A partir de agora, quando o motorista falar que esta vazio, sempre pergunte cidade e estado antes de qualquer oferta', 'Ana Operacoes'),
      ai('t2', '16:22:03', 'Proposta #18 preparada, resumo da mudanca: perguntar cidade e estado antes de qualquer oferta quando o motorista estiver vazio, se quiser aplicar responda Confirmar #18', 'Instrucao administrativa convertida em proposta pendente', '', [], ['Motivo']),
      dr('t3', '16:22:06', 'Confirmar #18', 'Ana Operacoes'),
      ai('t4', '16:22:09', 'Proposta #18 confirmada, a IA ja passou a usar esta nova regra: perguntar cidade e estado antes de qualquer oferta quando o motorista estiver vazio', 'A regra so entra depois da confirmacao segura', 'PROMPT COMPLETO\n- identificar telefone treinador\n- gerar proposta pendente\n- aplicar regra apenas com confirmacao', [
        act('whatsapp_aprendizados', 'insert', '16:22:09', { telefone_autor: '5511944442211', origem: 'whatsapp', status: 'ativo' }, 'regra ativa registrada no banco'),
      ], ['Motivo', 'Prompt', 'ERP']),
    ]),
  ];
  const state = { idx: 0, msg: {} };

  function mk(title, meta, nome, phone, resumo, esperado, messages) {
    return { title, meta, nome, phone, resumo, esperado, messages };
  }
  function dr(id, time, text, name) { return { id, role: 'driver', time, text, name }; }
  function ai(id, time, text, reason, prompt, erp, tags) {
    return { id, role: 'assistant', time, text, audit: { reason, prompt, erp, tags: tags || ['Motivo'] } };
  }
  function act(entity, action, time, fields, result) { return { entity, action, time, fields, result }; }
  function current() { return convs[state.idx]; }
  function selected(conv) {
    const chosen = conv.messages.find((m) => m.id === state.msg[conv.title] && m.audit);
    return chosen || [...conv.messages].reverse().find((m) => m.audit) || null;
  }
  function renderTabs() {
    $('simConversationTabs').innerHTML = convs.map((c, idx) => `
      <button class="pill ${idx === state.idx ? 'active' : ''}" data-sim-tab="${idx}">
        <span>${esc(c.title)}</span>
        <strong>100%</strong>
      </button>
    `).join('');
    document.querySelectorAll('[data-sim-tab]').forEach((btn) => btn.addEventListener('click', () => {
      state.idx = Number(btn.dataset.simTab);
      render();
    }));
  }
  function renderMessages(conv, chosen) {
    $('simMessages').innerHTML = conv.messages.map((m) => `
      <div class="message-row ${m.role}">
        <button type="button" class="bubble ${m.role === 'assistant' ? 'assistant' : ''} ${chosen?.id === m.id ? 'selected' : ''}" data-sim-msg="${m.id}">
          <div class="bubble-head"><span>${esc(m.role === 'assistant' ? 'IA GMX' : m.name)}</span><span>${esc(m.time)}</span></div>
          <div class="bubble-body">${esc(m.text)}</div>
          ${m.audit ? `<div class="bubble-tags">${m.audit.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </button>
      </div>
    `).join('');
    document.querySelectorAll('[data-sim-msg]').forEach((btn) => btn.addEventListener('click', () => {
      const msg = conv.messages.find((m) => m.id === btn.dataset.simMsg);
      if (!msg?.audit) return;
      state.msg[conv.title] = msg.id;
      render();
    }));
  }
  function renderAudit(chosen) {
    if (!chosen?.audit) {
      $('simAuditPanel').innerHTML = '<div class="audit-box"><div class="audit-label">Auditoria</div><div class="audit-value">Selecione uma mensagem da IA.</div></div>';
      return;
    }
    $('simAuditPanel').innerHTML = `
      <div class="audit-box">
        <div class="audit-label">Motivo da resposta</div>
        <div class="audit-value">${esc(chosen.audit.reason)}</div>
      </div>
      <div class="audit-box">
        <div class="audit-label">Prompt completo usado nesta simulacao</div>
        <pre class="code-block">${esc(chosen.audit.prompt || 'Mensagem operacional direta sem bloco adicional de prompt nesta etapa')}</pre>
      </div>
      <div class="audit-box">
        <div class="audit-label">O que seria gravado ou atualizado no ERP</div>
        <span class="section-copy">Cada acao mostra quando aconteceu e quais campos operacionais seriam enviados.</span>
        ${chosen.audit.erp?.length ? `<div class="object-list">${chosen.audit.erp.map((item) => `
          <div class="mini-card">
            <strong>${esc(item.entity)} · ${esc(item.action)}</strong>
            <p>${esc(item.time)}</p>
            <div class="structured-grid">${Object.entries(item.fields).map(([k, v]) => `
              <div class="structured-card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>
            `).join('')}</div>
            <span class="helper-line">Resultado: ${esc(item.result)}</span>
          </div>`).join('')}</div>` : '<div class="audit-value">Nenhuma escrita no ERP nesta etapa.</div>'}
      </div>
    `;
  }
  function renderMeta(conv) {
    $('simCurrentConversationMeta').textContent = conv.meta;
    $('simConversationMeta').innerHTML = `
      <div><strong>${esc(conv.nome)}</strong> · ${esc(conv.phone)}</div>
      <div>Resumo: ${esc(conv.resumo)}</div>
      <div>Resultado esperado: ${esc(conv.esperado)}</div>
      <div>Fluxo concluido no simulador</div>
    `;
    $('simConversationProgressLabel').textContent = '100%';
    $('simConversationProgressBar').style.width = '100%';
  }
  function render() {
    const conv = current();
    const chosen = selected(conv);
    renderTabs();
    renderMeta(conv);
    renderMessages(conv, chosen);
    renderAudit(chosen);
  }
  window.addEventListener('phone-monitor-ready', render);
})();
