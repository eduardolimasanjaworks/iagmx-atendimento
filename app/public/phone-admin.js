/**
 * Acoes principais do /phone voltadas a jornada e navegacao.
 * Mantem a troca de paineis e o disparo de jornadas no mesmo lugar.
 * Treinamento e OCR ficam em modulos separados para manter o arquivo curto.
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
    $('jornadaInfo').innerHTML = jornada ? `
      <span class="pill">Cenario ${jornada.cenario}</span>
      <span class="pill">${jornada.titulo}</span>
      <span class="pill">${jornada.origemMensagem}</span>` : '';
  }

  function atualizarMensagemPadrao() {
    const jornada = jornadaAtual();
    renderInfo(jornada);
    if (jornada) $('mensagemInicial').value = jornada.mensagemPadrao || '';
  }

  function moverJornada(delta) {
    if (!state.jornadas.length) return;
    const atual = Math.max(0, state.jornadas.findIndex((item) => item.id === $('jornada').value));
    $('jornada').value = state.jornadas[(atual + delta + state.jornadas.length) % state.jornadas.length].id;
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
    $('jornada').innerHTML = state.jornadas.map((item) => `<option value="${item.id}">Cenario ${item.cenario} - ${item.titulo}</option>`).join('');
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
      setBox('journeyStatus', resultado ? `${error.message || 'Falha ao iniciar jornada'}\n\n${resumoResultado(resultado)}` : error.message || 'Falha ao iniciar jornada', 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  function ativarPainel(alvo) {
    document.querySelectorAll('[data-panel]').forEach((item) => item.classList.toggle('active', item.dataset.panel === alvo));
    ['journeyPanel', 'opsPanel', 'whatsappPanel', 'pausePanel', 'trainingPanel', 'simulatorPanel', 'editorPanel'].forEach((id) => { $(id).hidden = id !== alvo; });
  }

  function painelInicial() {
    const painel = new URLSearchParams(window.location.search).get('painel');
    return ['journeyPanel', 'opsPanel', 'whatsappPanel', 'pausePanel', 'trainingPanel', 'simulatorPanel', 'editorPanel'].includes(`${painel}Panel`) ? `${painel}Panel` : 'journeyPanel';
  }

  function conectarEventos() {
    document.querySelectorAll('[data-panel]').forEach((btn) => btn.addEventListener('click', () => ativarPainel(btn.dataset.panel)));
    $('jornada').addEventListener('change', atualizarMensagemPadrao);
    $('journeyPrevBtn').addEventListener('click', () => moverJornada(-1));
    $('journeyNextBtn').addEventListener('click', () => moverJornada(1));
    $('iniciarBtn').addEventListener('click', iniciarJornada);
    $('recarregarJornadasBtn').addEventListener('click', () => carregarJornadas().catch((error) => setBox('journeyStatus', error.message || 'Falha ao recarregar jornadas', 'warn')));
    $('trainingOpenEditorBtn').addEventListener('click', () => ativarPainel('editorPanel'));
  }

  async function iniciar() {
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    if (!state.json) return;
    conectarEventos();
    ativarPainel(painelInicial());
    await carregarJornadas();
  }

  let iniciado = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (iniciado) return;
    iniciado = true;
    iniciar().catch((error) => setBox('journeyStatus', error.message || 'Falha ao iniciar a bancada do telefone', 'warn'));
  });

  window.addEventListener('phone-journeys-updated', () => {
    if (!state.json) return;
    carregarJornadas().catch((error) => setBox('journeyStatus', error.message || 'Falha ao sincronizar jornadas', 'warn'));
  });
})();
