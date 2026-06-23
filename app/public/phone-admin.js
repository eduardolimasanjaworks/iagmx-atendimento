/**
 * Acoes admin embutidas no monitor por telefone.
 * Unifica jornada, operacao, pausa, treinamento e editor na mesma tela.
 * Reaproveita as APIs admin existentes para evitar logica paralela.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { json: null, jornadas: [] };

  function normalizarTelefone(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  function telefoneAtual() {
    return window.PhoneMonitorPage?.getPhone?.() || normalizarTelefone($('phoneInput')?.value);
  }

  function setBox(id, texto, classe = '') {
    const el = $(id);
    if (!el) return;
    el.className = `result-box${classe ? ` ${classe}` : ''}`;
    el.textContent = texto;
  }

  function jornadaAtual() {
    return state.jornadas.find((item) => item.id === $('jornada').value) || null;
  }

  function renderInfo(jornada) {
    $('jornadaInfo').innerHTML = jornada
      ? `
        <span class="pill">Cenario ${jornada.cenario}</span>
        <span class="pill">${jornada.titulo}</span>
        <span class="pill">${jornada.origemMensagem}</span>
      `
      : '';
  }

  function atualizarMensagemPadrao() {
    const jornada = jornadaAtual();
    renderInfo(jornada);
    if (jornada) $('mensagemInicial').value = jornada.mensagemPadrao || '';
  }

  function moverJornada(delta) {
    if (!state.jornadas.length) return;
    const atual = Math.max(0, state.jornadas.findIndex((item) => item.id === $('jornada').value));
    const proximo = (atual + delta + state.jornadas.length) % state.jornadas.length;
    $('jornada').value = state.jornadas[proximo].id;
    atualizarMensagemPadrao();
  }

  function resumoResultado(resultado) {
    return [
      `Telefone: ${resultado.telefone}`,
      `Motorista ID: ${resultado.motoristaId}`,
      `Criado agora: ${resultado.motoristaCriado ? 'sim' : 'nao'}`,
      `Jornada: cenario ${resultado.jornada.cenario} - ${resultado.jornada.titulo}`,
      `Mensagem enviada: ${resultado.enviado ? 'sim' : 'nao'}`,
      `Fragmentos: ${resultado.fragmentos}`,
      `Observacao teste: ${resultado.observacaoMotorista || 'sem tag adicional'}`,
      '',
      resultado.mensagemInicial,
    ].join('\n');
  }

  async function carregarJornadas() {
    const data = await state.json('/api/admin/jornadas-teste');
    state.jornadas = data.jornadas || [];
    $('jornada').innerHTML = state.jornadas
      .map((item) => `<option value="${item.id}">Cenario ${item.cenario} - ${item.titulo}</option>`)
      .join('');
    atualizarMensagemPadrao();
    setBox('journeyStatus', `Jornadas carregadas: ${state.jornadas.length}\n${data.observacaoCampoTeste || ''}`);
  }

  async function iniciarJornada() {
    const telefone = telefoneAtual();
    if (!telefone) return setBox('journeyStatus', 'Informe o telefone do topo antes de iniciar a jornada', 'warn');
    const btn = $('iniciarBtn');
    btn.disabled = true;
    setBox('journeyStatus', 'Iniciando jornada com envio imediato no WhatsApp...');
    try {
      const data = await state.json('/api/admin/jornadas-teste/iniciar', {
        method: 'POST',
        body: JSON.stringify({
          telefone,
          jornadaId: $('jornada').value,
          nomeMotorista: $('nomeMotorista').value.trim() || undefined,
          mensagemInicial: $('mensagemInicial').value.trim(),
          resetarHistorico: $('resetarHistorico').checked,
          marcarComoTeste: $('marcarComoTeste').checked,
        }),
      });
      await window.PhoneMonitorPage?.abrirTelefone?.(telefone);
      setBox('journeyStatus', `${data.mensagem || 'Jornada iniciada'}\n\n${resumoResultado(data.resultado)}`, 'ok');
    } catch (error) {
      const resultado = error?.data?.resultado;
      setBox(
        'journeyStatus',
        resultado
          ? `${error.message || 'Falha ao iniciar jornada'}\n\n${resumoResultado(resultado)}`
          : error.message || 'Falha ao iniciar jornada',
        'warn',
      );
    } finally {
      btn.disabled = false;
    }
  }

  function renderPendencias(itens) {
    const root = $('trainingPendencias');
    if (!itens.length) {
      root.textContent = 'Nenhuma pendencia de treinamento agora.';
      return;
    }
    root.innerHTML = itens.slice(0, 5).map((item) => `
      <div class="pending-item">
        <strong>Proposta #${item.id}</strong>
        <div>${String(item.resumo_sugerido || item.instrucao_sugerida || '').replace(/</g, '&lt;')}</div>
        <div class="admin-help" style="margin-top:.45rem">autor: ${item.nome_autor || item.telefone_autor || 'nao informado'}</div>
        <div class="pending-actions">
          <button type="button" data-approve="${item.id}">Aprovar</button>
          <button type="button" data-cancel="${item.id}">Cancelar</button>
        </div>
      </div>
    `).join('');
  }

  async function carregarTreinamento() {
    const [telefones, pendencias, aprendizados] = await Promise.all([
      state.json('/api/admin/treinamento/telefones'),
      state.json('/api/admin/treinamento/pendencias'),
      state.json('/api/admin/treinamento/aprendizados'),
    ]);
    $('statTrainers').textContent = String((telefones.itens || []).filter((item) => item.ativo).length);
    $('statPending').textContent = String((pendencias.itens || []).filter((item) => item.status === 'pendente').length);
    $('statLearned').textContent = String((aprendizados.itens || []).filter((item) => item.ativo).length);
    renderPendencias((pendencias.itens || []).filter((item) => item.status === 'pendente'));
    setBox(
      'trainingStatus',
      'Modo treinador revisado por API.\nUse os botoes abaixo para criar proposta, aplicar regra ou aprovar uma pendencia.',
      'ok',
    );
  }

  async function enviarInstrucao(aplicarAgora) {
    const texto = $('trainingInstruction').value.trim();
    if (texto.length < 10) return setBox('trainingStatus', 'Escreva uma instrucao mais completa antes de enviar', 'warn');
    const btn = aplicarAgora ? $('trainingApplyBtn') : $('trainingProposalBtn');
    btn.disabled = true;
    setBox('trainingStatus', aplicarAgora ? 'Aplicando regra diretamente...' : 'Criando proposta de treinamento...');
    try {
      const data = await state.json('/api/admin/treinamento/instrucao-direta', {
        method: 'POST',
        body: JSON.stringify({
          telefoneAutor: $('trainerPhone').value.trim() || undefined,
          nomeAutor: $('trainerName').value.trim() || undefined,
          texto,
          aplicarAgora,
        }),
      });
      $('trainingInstruction').value = '';
      await carregarTreinamento();
      setBox(
        'trainingStatus',
        data.modo === 'aplicado'
          ? `Regra aplicada agora.\n\n${data.item.resumo || data.item.instrucao}`
          : `Proposta criada com sucesso.\n\n${data.item.resumo_sugerido || data.item.instrucao_sugerida}`,
        'ok',
      );
    } catch (error) {
      setBox('trainingStatus', error.message || 'Falha ao processar instrucao', 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  async function aprovarOuCancelar(id, acao) {
    setBox('trainingStatus', `${acao === 'aprovar' ? 'Aprovando' : 'Cancelando'} proposta #${id}...`);
    try {
      await state.json(`/api/admin/treinamento/pendencias/${id}/${acao}`, {
        method: 'POST',
        body: JSON.stringify({ autor: 'dashboard' }),
      });
      await carregarTreinamento();
      setBox('trainingStatus', `Proposta #${id} ${acao === 'aprovar' ? 'aprovada' : 'cancelada'} com sucesso`, 'ok');
    } catch (error) {
      setBox('trainingStatus', error.message || 'Falha ao atualizar pendencia', 'warn');
    }
  }

  function ativarPainel(alvo) {
    document.querySelectorAll('[data-panel]').forEach((item) => {
      item.classList.toggle('active', item.dataset.panel === alvo);
    });
    ['journeyPanel', 'opsPanel', 'whatsappPanel', 'pausePanel', 'trainingPanel', 'simulatorPanel', 'editorPanel'].forEach((id) => {
      $(id).hidden = id !== alvo;
    });
  }

  function painelInicial() {
    const painel = new URLSearchParams(window.location.search).get('painel');
    return ['journeyPanel', 'opsPanel', 'whatsappPanel', 'pausePanel', 'trainingPanel', 'simulatorPanel', 'editorPanel'].includes(`${painel}Panel`)
      ? `${painel}Panel`
      : 'journeyPanel';
  }

  function conectarEventos() {
    document.querySelectorAll('[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ativarPainel(btn.dataset.panel);
      });
    });
    $('jornada').addEventListener('change', atualizarMensagemPadrao);
    $('journeyPrevBtn').addEventListener('click', () => moverJornada(-1));
    $('journeyNextBtn').addEventListener('click', () => moverJornada(1));
    $('iniciarBtn').addEventListener('click', iniciarJornada);
    $('recarregarJornadasBtn').addEventListener('click', () => carregarJornadas().catch((error) => {
      setBox('journeyStatus', error.message || 'Falha ao recarregar jornadas', 'warn');
    }));
    $('trainingProposalBtn').addEventListener('click', () => enviarInstrucao(false));
    $('trainingApplyBtn').addEventListener('click', () => enviarInstrucao(true));
    $('trainingOpenEditorBtn').addEventListener('click', () => ativarPainel('editorPanel'));
    $('trainingPendencias').addEventListener('click', (event) => {
      const btn = event.target.closest('button');
      if (!btn) return;
      if (btn.dataset.approve) aprovarOuCancelar(btn.dataset.approve, 'aprovar');
      if (btn.dataset.cancel) aprovarOuCancelar(btn.dataset.cancel, 'cancelar');
    });
  }

  async function iniciar() {
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    if (!state.json) return;
    conectarEventos();
    ativarPainel(painelInicial());
    await Promise.all([carregarJornadas(), carregarTreinamento()]);
  }

  let iniciado = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (iniciado) return;
    iniciado = true;
    iniciar().catch((error) => {
      setBox('journeyStatus', error.message || 'Falha ao iniciar a bancada do telefone', 'warn');
      setBox('trainingStatus', error.message || 'Falha ao carregar treinamento', 'warn');
    });
  });

  window.addEventListener('phone-journeys-updated', () => {
    if (!state.json) return;
    carregarJornadas().catch((error) => {
      setBox('journeyStatus', error.message || 'Falha ao sincronizar jornadas', 'warn');
    });
  });
})();
