/**
 * Editor compacto dos textos centrais da IA dentro do /phone.
 * Mantem prompt principal, estilo e mensagens operacionais na mesma tela.
 * Carrega um resumo tecnico curto sem reviver a antiga home do painel.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const FLOW_LABELS = {
    contato_proativo_localizacao_com_referencia: 'Contato proativo com ultimo local',
    contato_proativo_localizacao_sem_referencia: 'Contato proativo sem ultimo local',
    oferta_proativa_template: 'Oferta proativa',
    c7_pergunta_status: 'Disponibilidade - pergunta inicial',
    c7_duvida_status: 'Disponibilidade - status incerto',
    c7_pede_localizacao: 'Disponibilidade - pedir localizacao',
    c7_local_invalida: 'Disponibilidade - local invalido',
    c7_pergunta_local_atual_carregado: 'Disponibilidade - carregado pedir local atual',
    c7_pergunta_data: 'Disponibilidade - pedir data',
    c7_pergunta_local_disponibilidade: 'Disponibilidade - pedir local futuro',
    c7_data_vaga: 'Disponibilidade - data vaga',
    c7_fechamento: 'Disponibilidade - fechamento',
    c8_inicio: 'Cadastro - abertura',
    c8_fechamento: 'Cadastro - fechamento',
    c8_reprompt_cnh: 'Cadastro - reprompt CNH',
    c8_reprompt_crlv: 'Cadastro - reprompt CRLV',
    c8_reprompt_antt: 'Cadastro - reprompt ANTT',
    c8_reprompt_endereco: 'Cadastro - reprompt endereco',
    c8_reprompt_caminhao: 'Cadastro - reprompt caminhao',
    c8_confirmacao_cnh: 'Cadastro - confirmacao CNH',
    c8_confirmacao_crlv: 'Cadastro - confirmacao CRLV',
    c8_confirmacao_antt: 'Cadastro - confirmacao ANTT',
    c8_confirmacao_endereco: 'Cadastro - confirmacao endereco',
    c8_ocr_ilegivel: 'Cadastro - OCR ilegivel',
    c8_ocr_escalonar: 'Cadastro - escalar para humano',
    atualizacao_pedir_foto: 'Atualizacao - pedir foto',
    atualizacao_reprompt_cnh: 'Atualizacao - reprompt CNH',
    atualizacao_reprompt_crlv: 'Atualizacao - reprompt CRLV',
    atualizacao_reprompt_antt: 'Atualizacao - reprompt ANTT',
    atualizacao_reprompt_endereco: 'Atualizacao - reprompt endereco',
    atualizacao_reprompt_caminhao: 'Atualizacao - reprompt caminhao',
    atualizacao_ocr_recusa: 'Atualizacao - falha tecnica',
    atualizacao_foto_ilegivel: 'Atualizacao - foto ilegivel',
    atualizacao_tipo_incerto: 'Atualizacao - tipo incerto',
    atualizacao_tipo_incerto_com_texto: 'Atualizacao - tipo incerto com texto',
    atualizacao_confirmacao_negada: 'Atualizacao - confirmacao negada',
    canhoto_sem_embarque: 'Canhoto - sem embarque',
    canhoto_pedir_foto: 'Canhoto - pedir foto',
    canhoto_midia_sem_embarque: 'Canhoto - imagem sem embarque',
    canhoto_ok: 'Canhoto - confirmado',
    ocr_humano_aberturas: 'OCR humano - aberturas',
    ocr_humano_documento_salvo_com_detalhes: 'OCR humano - salvo com detalhes',
    ocr_humano_documento_salvo_sem_detalhes: 'OCR humano - salvo sem detalhes',
    ocr_humano_confirmacao_com_detalhes: 'OCR humano - confirmar com detalhes',
    ocr_humano_confirmacao_sem_detalhes: 'OCR humano - confirmar sem detalhes',
    ocr_humano_confirmada_com_detalhes: 'OCR humano - confirmada com detalhes',
    ocr_humano_confirmada_sem_detalhes: 'OCR humano - confirmada sem detalhes',
  };
  const state = {
    json: null,
    padroes: { prompt: '', orquestracao: null, mensagens: null },
    mensagens: {},
    contexto: null,
  };

  function fmtData(iso) {
    if (!iso) return 'Sem registro recente.';
    try {
      return `Atualizado ${new Date(iso).toLocaleString('pt-BR')}`;
    } catch {
      return 'Sem registro recente.';
    }
  }

  function setBox(id, text, kind = '') {
    const el = $(id);
    if (!el) return;
    el.className = `result-box${kind ? ` ${kind}` : ''}`;
    el.textContent = text;
  }

  function soAdmin() {
    return state.contexto?.usuario?.perfil === 'admin';
  }

  function aplicarPermissoes() {
    if (soAdmin()) return;
    [
      'editorPromptSalvarBtn',
      'editorPromptRestaurarBtn',
      'editorOrquestracaoSalvarBtn',
      'editorOrquestracaoRestaurarBtn',
      'editorMensagensSalvarBtn',
      'editorMensagensRestaurarBtn',
    ].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.disabled = true;
      el.title = 'Disponivel apenas para admin';
    });
  }

  function renderResumo(health) {
    const servicos = health?.servicos || {};
    $('editorBuildValue').textContent = health?.build || '-';
    $('editorProviderValue').textContent = servicos.provedorAtivo || '-';
    const chips = [
      ['redis', 'Redis'],
      ['postgres', 'Postgres'],
      ['evolution', 'WhatsApp'],
      ['qdrant', 'Qdrant'],
      ['openrouter', 'OpenRouter'],
      ['directus', 'Directus'],
    ];
    $('editorHealthChips').innerHTML = chips.map(([key, label]) => (
      `<span class="pill">${label}: ${servicos[key] ? 'ok' : 'off'}</span>`
    )).join('');
  }

  function humanizarMensagem(key) {
    return FLOW_LABELS[key] || key.replaceAll('_', ' ');
  }

  function renderMensagens() {
    const filtro = String($('editorMensagensFiltro').value || '').trim().toLowerCase();
    const entries = Object.entries(state.mensagens || {}).filter(([key, value]) => {
      if (!filtro) return true;
      const alvo = `${key} ${humanizarMensagem(key)} ${Array.isArray(value) ? value.join(' ') : value}`.toLowerCase();
      return alvo.includes(filtro);
    });
    if (!entries.length) {
      $('editorMensagensFluxo').innerHTML = '<div class="flow-item"><strong>Nenhum resultado</strong><small>Ajuste o filtro para localizar a mensagem desejada.</small></div>';
      return;
    }
    $('editorMensagensFluxo').innerHTML = entries.map(([key, value]) => `
      <div class="flow-item">
        <strong>${humanizarMensagem(key)}</strong>
        <small>${key}</small>
        <textarea data-flow-key="${key}" class="compact" spellcheck="false">${Array.isArray(value) ? value.join('\n') : value || ''}</textarea>
      </div>
    `).join('');
  }

  function coletarMensagens() {
    const payload = { ...state.mensagens };
    document.querySelectorAll('[data-flow-key]').forEach((el) => {
      const key = el.dataset.flowKey;
      const raw = el.value.trim();
      payload[key] = Array.isArray(state.mensagens[key])
        ? raw.split('\n').map((item) => item.trim()).filter(Boolean)
        : raw;
    });
    return payload;
  }

  async function carregarTudo() {
    const [prompt, orquestracao, mensagens, health] = await Promise.all([
      state.json('/api/prompt'),
      state.json('/api/config/orquestracao-texto'),
      state.json('/api/config/mensagens-fluxo'),
      fetch('/health').then((res) => res.json()),
    ]);
    state.padroes.prompt = prompt.prompt || '';
    state.padroes.orquestracao = orquestracao.padrao || {};
    state.padroes.mensagens = mensagens.padrao || {};
    state.mensagens = mensagens.config || {};
    $('editorPromptPrincipal').value = prompt.prompt || '';
    $('editorCamadaHumana').value = orquestracao.config?.camadaHumana || '';
    $('editorInstrucaoFormatacao').value = orquestracao.config?.instrucaoFormatacao || '';
    $('editorPromptMeta').textContent = fmtData(prompt.atualizadoEm);
    $('editorMensagensMeta').textContent = fmtData(mensagens.atualizadoEm);
    renderResumo(health);
    renderMensagens();
    setBox('editorCoreStatus', 'Textos centrais carregados.', 'ok');
    setBox('editorMensagensStatus', 'Mensagens operacionais carregadas.', 'ok');
  }

  async function salvarPrompt() {
    setBox('editorCoreStatus', 'Salvando prompt principal...');
    const data = await state.json('/api/prompt', {
      method: 'PUT',
      body: JSON.stringify({ prompt: $('editorPromptPrincipal').value.trim() }),
    });
    $('editorPromptMeta').textContent = fmtData(new Date().toISOString());
    setBox('editorCoreStatus', data.mensagem || 'Prompt principal salvo.', 'ok');
  }

  async function salvarOrquestracao() {
    setBox('editorCoreStatus', 'Salvando estilo e formatacao...');
    const data = await state.json('/api/config/orquestracao-texto', {
      method: 'PUT',
      body: JSON.stringify({
        camadaHumana: $('editorCamadaHumana').value.trim(),
        instrucaoFormatacao: $('editorInstrucaoFormatacao').value.trim(),
      }),
    });
    setBox('editorCoreStatus', data.mensagem || 'Estilo salvo.', 'ok');
  }

  async function salvarMensagens() {
    setBox('editorMensagensStatus', 'Salvando mensagens operacionais...');
    const payload = coletarMensagens();
    const data = await state.json('/api/config/mensagens-fluxo', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    state.mensagens = payload;
    $('editorMensagensMeta').textContent = fmtData(new Date().toISOString());
    setBox('editorMensagensStatus', data.mensagem || 'Mensagens salvas.', 'ok');
  }

  function restaurarPrompt() {
    $('editorPromptPrincipal').value = state.padroes.prompt || '';
    setBox('editorCoreStatus', 'Prompt restaurado para o texto carregado.', 'ok');
  }

  function restaurarOrquestracao() {
    const padrao = state.padroes.orquestracao || {};
    $('editorCamadaHumana').value = padrao.camadaHumana || '';
    $('editorInstrucaoFormatacao').value = padrao.instrucaoFormatacao || '';
    setBox('editorCoreStatus', 'Estilo restaurado para o padrao carregado.', 'ok');
  }

  function restaurarMensagens() {
    state.mensagens = JSON.parse(JSON.stringify(state.padroes.mensagens || {}));
    renderMensagens();
    setBox('editorMensagensStatus', 'Mensagens restauradas para o padrao.', 'ok');
  }

  function bind() {
    $('editorPromptSalvarBtn').addEventListener('click', () => salvarPrompt().catch((error) => setBox('editorCoreStatus', error.message || 'Falha ao salvar prompt.', 'warn')));
    $('editorOrquestracaoSalvarBtn').addEventListener('click', () => salvarOrquestracao().catch((error) => setBox('editorCoreStatus', error.message || 'Falha ao salvar estilo.', 'warn')));
    $('editorMensagensSalvarBtn').addEventListener('click', () => salvarMensagens().catch((error) => setBox('editorMensagensStatus', error.message || 'Falha ao salvar mensagens.', 'warn')));
    $('editorPromptRestaurarBtn').addEventListener('click', restaurarPrompt);
    $('editorOrquestracaoRestaurarBtn').addEventListener('click', restaurarOrquestracao);
    $('editorMensagensRestaurarBtn').addEventListener('click', restaurarMensagens);
    $('editorMensagensFiltro').addEventListener('input', renderMensagens);
  }

  function start() {
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    state.contexto = window.PhoneMonitorPage?.getContext?.() || null;
    if (!state.json) return;
    bind();
    aplicarPermissoes();
    carregarTudo().catch((error) => {
      setBox('editorCoreStatus', error.message || 'Falha ao carregar editor central.', 'warn');
      setBox('editorMensagensStatus', error.message || 'Falha ao carregar mensagens.', 'warn');
    });
  }

  let started = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (started) return;
    started = true;
    start();
  });
})();
