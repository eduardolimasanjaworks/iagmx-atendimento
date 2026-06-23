/**
 * Painel de conexao do WhatsApp embutido no /phone.
 * Reaproveita as rotas de QR e status ja existentes, sem tela paralela.
 * Esconde a aba quando o perfil nao tem acesso ao bloco da conexao da IA.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    json: null,
    contexto: null,
    pollTimer: null,
    cooldownTimer: null,
    conectado: false,
    cooldownMs: { atualizar: 3000, qr: 8000, reconectar: 15000 },
    cooldownAte: { atualizar: 0, qr: 0, reconectar: 0 },
  };

  function podeVer() {
    return state.contexto?.usuario?.perfil === 'admin'
      || Boolean(state.contexto?.equipe?.blocosVisiveis?.includes('conexao_numero_ia'));
  }

  function esconderPainel() {
    document.querySelector('[data-panel="whatsappPanel"]')?.remove();
    $('whatsappPanel')?.remove();
  }

  function segundosRestantes(acao) {
    return Math.max(0, Math.ceil((state.cooldownAte[acao] - Date.now()) / 1000));
  }

  function iniciarCooldown(acao, ateIso, fallbackMs) {
    const alvo = ateIso ? new Date(ateIso).getTime() : Date.now() + (fallbackMs || 0);
    if (!Number.isFinite(alvo)) return;
    state.cooldownAte[acao] = Math.max(state.cooldownAte[acao] || 0, alvo);
    atualizarAcoes();
    if (state.cooldownTimer) return;
    state.cooldownTimer = setInterval(() => {
      atualizarAcoes();
      if (Object.values(state.cooldownAte).every((valor) => valor <= Date.now())) {
        clearInterval(state.cooldownTimer);
        state.cooldownTimer = null;
      }
    }, 1000);
  }

  function setLinha(msg, kind = '') {
    $('waStatusText').textContent = msg;
    $('waPanelStatus').className = `result-box${kind ? ` ${kind}` : ''}`;
    $('waPanelStatus').textContent = msg;
  }

  function atualizarBadge(estado, conectado) {
    const badge = $('waBadge');
    if (conectado) {
      badge.textContent = 'conectado';
      badge.className = 'badge open';
      return;
    }
    if (estado === 'connecting') {
      badge.textContent = 'aguardando QR';
      badge.className = 'badge connecting';
      return;
    }
    badge.textContent = estado || 'desconectado';
    badge.className = 'badge';
  }

  function mostrarQr(base64) {
    if (!base64) return;
    const img = $('waQrImg');
    const src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64.replace(/^data:image\/png;base64,/, '')}`;
    img.src = src;
    img.hidden = false;
    $('waQrPlaceholder').hidden = true;
  }

  function atualizarAcoes() {
    const restanteAtualizar = segundosRestantes('atualizar');
    const restanteQr = segundosRestantes('qr');
    const restanteReconectar = segundosRestantes('reconectar');
    const btnAtualizar = $('waBtnAtualizar');
    const btnGerar = $('waBtnGerar');
    const btnReconectar = $('waBtnReconectar');
    btnAtualizar.textContent = restanteAtualizar > 0 ? `Verificar em ${restanteAtualizar}s` : 'Verificar agora';
    btnGerar.textContent = restanteQr > 0 ? `Abrir QR em ${restanteQr}s` : 'Abrir QR';
    btnReconectar.textContent = restanteReconectar > 0 ? `Reconectar em ${restanteReconectar}s` : 'Reconectar sessao';
    if (!btnAtualizar.dataset.loading) btnAtualizar.disabled = restanteAtualizar > 0;
    if (!btnGerar.dataset.loading) btnGerar.disabled = restanteQr > 0;
    if (!btnReconectar.dataset.loading) btnReconectar.disabled = restanteReconectar > 0;

    const acaoAtiva = restanteReconectar > 0 ? 'reconectar' : (restanteQr > 0 ? 'qr' : (restanteAtualizar > 0 ? 'atualizar' : null));
    if (!acaoAtiva) {
      $('waCooldownBox').classList.remove('visible');
      $('waCooldownBar').style.width = '0%';
      return;
    }
    const restante = segundosRestantes(acaoAtiva);
    const total = state.cooldownMs[acaoAtiva];
    const restanteMs = Math.max(0, state.cooldownAte[acaoAtiva] - Date.now());
    const progresso = Math.max(6, Math.min(100, ((total - restanteMs) / total) * 100));
    $('waCooldownBox').classList.add('visible');
    $('waCooldownTitle').textContent = 'Calma, estou cuidando disso por aqui.';
    $('waCooldownCopy').textContent =
      acaoAtiva === 'reconectar'
        ? `Estou segurando ${restante}s antes de reiniciar tudo para proteger a sessao.`
        : acaoAtiva === 'qr'
          ? `Estou segurando ${restante}s antes de pedir outro QR para nao fazer spam na instancia.`
          : `Estou esperando ${restante}s para consultar de novo sem bater na conexao toda hora.`;
    $('waCooldownBar').style.width = `${progresso}%`;
  }

  async function verificarStatus() {
    const data = await state.json('/api/whatsapp/status');
    if (data.cooldownAte) iniciarCooldown('atualizar', data.cooldownAte, data.cooldownMs || state.cooldownMs.atualizar);
    state.conectado = Boolean(data.conectado);
    atualizarBadge(data.state, state.conectado);
    if (state.conectado) {
      $('waQrImg').hidden = true;
      $('waQrPlaceholder').hidden = false;
      $('waQrPlaceholder').textContent = 'Conectado com sucesso.';
      setLinha('Pronto, o numero esta conectado e pode responder.', 'ok');
      pararPoll();
      return true;
    }
    setLinha(data.motivoDesconexao || 'Ainda aguardando leitura do QR ou nova conexao.');
    return false;
  }

  async function carregarQr() {
    if (segundosRestantes('qr') > 0) return setLinha(`So mais ${segundosRestantes('qr')}s e eu libero um novo QR.`);
    $('waBtnGerar').dataset.loading = '1';
    $('waBtnAtualizar').dataset.loading = '1';
    $('waBtnGerar').disabled = true;
    $('waBtnAtualizar').disabled = true;
    try {
      const ok = await verificarStatus();
      if (ok) return;
      const data = await state.json('/api/whatsapp/qrcode');
      if (data.cooldownAte) iniciarCooldown('qr', data.cooldownAte, data.cooldownMs || state.cooldownMs.qr);
      if (data.conectado) return setLinha('Esse numero ja aparece conectado por aqui.', 'ok');
      mostrarQr(data.base64);
      setLinha('QR pronto. Pode escanear que eu acompanho daqui.', 'ok');
      iniciarPoll();
    } catch (error) {
      setLinha(error.message || 'Falha ao abrir QR.', 'warn');
    } finally {
      delete $('waBtnGerar').dataset.loading;
      delete $('waBtnAtualizar').dataset.loading;
      atualizarAcoes();
    }
  }

  async function reconectar() {
    if (segundosRestantes('reconectar') > 0) return setLinha(`So mais ${segundosRestantes('reconectar')}s para reconectar com seguranca.`);
    $('waBtnReconectar').dataset.loading = '1';
    $('waBtnReconectar').disabled = true;
    try {
      const data = await state.json('/api/whatsapp/reconectar', { method: 'POST' });
      if (data.cooldownAte) iniciarCooldown('reconectar', data.cooldownAte, data.cooldownMs || state.cooldownMs.reconectar);
      mostrarQr(data.base64);
      state.conectado = false;
      setLinha('Sessao reiniciada. QR novo gerado.', 'ok');
      iniciarPoll();
    } catch (error) {
      setLinha(error.message || 'Falha ao reconectar a sessao.', 'warn');
    } finally {
      delete $('waBtnReconectar').dataset.loading;
      atualizarAcoes();
    }
  }

  function iniciarPoll() {
    pararPoll();
    state.pollTimer = setInterval(() => {
      verificarStatus().catch(() => undefined);
    }, 3000);
  }

  function pararPoll() {
    if (!state.pollTimer) return;
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function bind() {
    $('waBtnGerar').addEventListener('click', () => carregarQr());
    $('waBtnAtualizar').addEventListener('click', () => verificarStatus().catch((error) => setLinha(error.message || 'Falha ao consultar status.', 'warn')));
    $('waBtnReconectar').addEventListener('click', () => reconectar());
  }

  function start() {
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    state.contexto = window.PhoneMonitorPage?.getContext?.() || null;
    if (!state.json) return;
    if (!podeVer()) {
      esconderPainel();
      return;
    }
    if (state.contexto?.usuario?.perfil !== 'admin') $('waBtnReconectar').hidden = true;
    bind();
    atualizarAcoes();
    verificarStatus()
      .then((ok) => { if (!ok) return carregarQr(); return null; })
      .catch((error) => setLinha(error.message || 'Falha ao iniciar painel do WhatsApp.', 'warn'));
  }

  let started = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (started) return;
    started = true;
    start();
  });
})();
