/**
 * Painel de conexao WhatsApp com dois alvos: auxiliar e oficial.
 * Renderiza QR inline por alvo e compartilha o mesmo contrato do GMX.
 * Reflete pausa global inicial e bloqueio de reconexao no numero auxiliar.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    json: null,
    contexto: null,
    alvos: [],
    qr: {},
    feedback: {},
    cooldown: {},
    loading: {},
    timer: null,
    pauseDefaultOff: true,
  };

  function podeVer() {
    return state.contexto?.usuario?.perfil === 'admin'
      || Boolean(state.contexto?.equipe?.blocosVisiveis?.includes('conexao_numero_ia'));
  }

  function esconderPainel() {
    document.querySelector('[data-panel="whatsappPanel"]')?.remove();
    $('whatsappPanel')?.remove();
  }

  function formatarNumero(valor) {
    const digits = String(valor || '').replace(/\D/g, '');
    if (!digits) return 'Aguardando conexao';
    if (digits.length <= 2) return `+${digits}`;
    if (digits.length <= 4) return `+${digits.slice(0, 2)} ${digits.slice(2)}`;
    if (digits.length <= 9) return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`;
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }

  function formatarData(valor) {
    if (!valor) return 'Sem registro ainda';
    const date = new Date(valor);
    return Number.isNaN(date.getTime()) ? 'Sem registro ainda' : date.toLocaleString('pt-BR');
  }

  function traduzirStatus(item) {
    if (item?.conectado) return 'Conectado';
    if (item?.state === 'stale_open') return 'Sessao inconsistente';
    if (item?.state === 'connecting') return 'Conectando';
    if (item?.state === 'not_found') return 'Instancia ainda nao criada';
    if (item?.state === 'close' || item?.state === 'closed') return 'Desconectado';
    return item?.state || 'Status desconhecido';
  }

  function badgeClass(item) {
    if (item?.conectado) return 'badge open';
    if (item?.state === 'stale_open') return 'badge stale';
    if (item?.state === 'connecting') return 'badge connecting';
    return 'badge';
  }

  function cooldownKey(alvo, acao) {
    return `${alvo}:${acao}`;
  }

  function segundosRestantes(alvo, acao) {
    return Math.max(0, Math.ceil(((state.cooldown[cooldownKey(alvo, acao)] || 0) - Date.now()) / 1000));
  }

  function aplicarCooldown(alvo, acao, ateIso, fallbackMs) {
    const limite = ateIso ? new Date(ateIso).getTime() : Date.now() + (fallbackMs || 0);
    if (Number.isFinite(limite)) state.cooldown[cooldownKey(alvo, acao)] = limite;
  }

  function qrBloqueadoNoPainel(item) {
    return item?.state === 'stale_open' && item?.permiteReconectar === false;
  }

  function dadosResiduais(item) {
    return !item?.conectado && (item?.state === 'stale_open' || item?.podeEnviar === false);
  }

  function htmlQr(item) {
    const qr = state.qr[item.alvo];
    if (item.conectado && !qr?.base64) return '<div class="qr-placeholder">Conectado nesta instancia.</div>';
    if (qrBloqueadoNoPainel(item)) {
      return '<div class="qr-placeholder">Este alvo auxiliar ficou preso em uma sessao residual da Evolution. Voce ainda pode clicar para ver a explicacao operacional, mas estes dados nao valem como conexao ativa.</div>';
    }
    if (qr?.base64) {
      const src = qr.base64.startsWith('data:') ? qr.base64 : `data:image/png;base64,${qr.base64}`;
      return `<img alt="QR ${item.titulo}" src="${src}" />`;
    }
    return '<div class="qr-placeholder">Clique em "Abrir QR da conexao atual" para carregar o pareamento deste alvo.</div>';
  }

  function textoBotao(alvo, acao) {
    const restante = segundosRestantes(alvo, acao);
    if (acao === 'atualizar') return restante > 0 ? `Ja ja eu confiro de novo (${restante}s)` : 'Verificar agora se conectou';
    if (acao === 'qr') return restante > 0 ? `Seguro mais um instante (${restante}s)` : 'Abrir QR da conexao atual';
    return restante > 0 ? `Calma, vou reiniciar em ${restante}s` : 'Desconectar e gerar novo QR';
  }

  function render() {
    const notice = $('waGlobalNotice');
    const root = $('waTargets');
    if (!root || !notice) return;
    notice.className = 'result-box warn';
    notice.textContent = state.pauseDefaultOff
      ? 'A IA começa desligada por padrão para todos os contatos nos dois numeros. Libere individualmente os contatos que podem voltar a responder.'
      : 'A IA está em modo global liberado. Ainda é possível pausar ou liberar contatos individualmente.';

    root.innerHTML = state.alvos.map((item) => `
      <div class="whatsapp-box" data-wa-target="${item.alvo}">
        <div class="whatsapp-head">
          <div>
            <div class="table-title">${item.titulo}</div>
            <div class="muted">${item.descricao}</div>
          </div>
          <span class="${badgeClass(item)}">${traduzirStatus(item)}</span>
        </div>
        <div class="wa-meta-grid">
          <div class="wa-meta-card"><div class="wa-meta-label">${dadosResiduais(item) ? 'Ultimo numero visto' : 'Numero conectado'}</div><div class="wa-meta-value">${dadosResiduais(item) && !item.numeroConectado ? 'Sem conexao valida' : formatarNumero(item.numeroConectado)}</div></div>
          <div class="wa-meta-card"><div class="wa-meta-label">Instancia atual</div><div class="wa-meta-value">${item.instance || 'Aguardando leitura'}</div></div>
          <div class="wa-meta-card"><div class="wa-meta-label">${dadosResiduais(item) ? 'Ultimo registro residual' : 'Ultima atualizacao'}</div><div class="wa-meta-value">${formatarData(item.atualizadoEm)}</div></div>
        </div>
        <div class="wa-note-box">
          <div class="wa-note-line">${item.nomePerfil ? `${dadosResiduais(item) ? 'Ultimo perfil visto' : 'Perfil conectado'}: ${item.nomePerfil}` : 'O nome do perfil ainda nao foi informado por esta conexao.'}</div>
          <div class="wa-note-line">Ultima verificacao feita no painel: ${new Date().toLocaleString('pt-BR')}</div>
          <div class="wa-note-line">${item.motivoDesconexao || item.aviso || 'Sem observacoes adicionais para este alvo.'}</div>
          ${state.feedback[item.alvo] ? `<div class="wa-note-line"><strong>Aviso operacional:</strong> ${state.feedback[item.alvo]}</div>` : ''}
        </div>
        <div class="qr-box">
          <div class="qr-frame">${htmlQr(item)}</div>
          <div class="actions">
            <button type="button" data-wa-action="atualizar" data-wa-target="${item.alvo}" ${state.loading[cooldownKey(item.alvo, 'atualizar')] || segundosRestantes(item.alvo, 'atualizar') > 0 ? 'disabled' : ''}>${textoBotao(item.alvo, 'atualizar')}</button>
            <button type="button" class="primary" data-wa-action="qr" data-wa-target="${item.alvo}" ${state.loading[cooldownKey(item.alvo, 'qr')] || segundosRestantes(item.alvo, 'qr') > 0 || item.permiteQr === false ? 'disabled' : ''}>${textoBotao(item.alvo, 'qr')}</button>
            <button type="button" data-wa-action="reconectar" data-wa-target="${item.alvo}" ${state.loading[cooldownKey(item.alvo, 'reconectar')] || segundosRestantes(item.alvo, 'reconectar') > 0 || item.permiteReconectar === false || state.contexto?.usuario?.perfil !== 'admin' ? 'disabled' : ''}>${item.permiteReconectar ? textoBotao(item.alvo, 'reconectar') : 'Reconexao bloqueada neste alvo'}</button>
          </div>
          <div class="wa-help-box">
            <div><code>Verificar agora se conectou</code> so confere o estado atual deste alvo.</div>
            <div><code>Abrir QR da conexao atual</code> tenta abrir o pareamento sem derrubar a sessao. Se a Evolution travar o auxiliar, o painel responde com aviso operacional em vez de fingir sucesso.</div>
            <div><code>Desconectar e gerar novo QR</code> ${item.permiteReconectar ? 'fica liberado neste alvo.' : 'nao fica liberado neste alvo.'}</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  async function carregarAlvos() {
    const data = await state.json('/api/whatsapp/alvos');
    state.alvos = Array.isArray(data.itens) ? data.itens : [];
    state.pauseDefaultOff = Boolean(data.pausaGlobalInicial);
    render();
  }

  async function atualizarAlvo(alvo) {
    state.loading[cooldownKey(alvo, 'atualizar')] = true;
    try {
      const data = await state.json(`/api/whatsapp/alvos/${alvo}/status`);
      delete state.feedback[alvo];
      aplicarCooldown(alvo, 'atualizar', data.cooldownAte, data.cooldownMs || 3000);
      state.alvos = state.alvos.map((item) => item.alvo === alvo ? data : item);
    } finally {
      delete state.loading[cooldownKey(alvo, 'atualizar')];
      render();
    }
  }

  async function abrirQr(alvo) {
    state.loading[cooldownKey(alvo, 'qr')] = true;
    try {
      const data = await state.json(`/api/whatsapp/alvos/${alvo}/qrcode`);
      state.qr[alvo] = data;
      delete state.feedback[alvo];
      aplicarCooldown(alvo, 'qr', data.cooldownAte, data.cooldownMs || 8000);
      await atualizarAlvo(alvo);
    } catch (error) {
      state.qr[alvo] = null;
      state.feedback[alvo] = error?.message || 'Nao foi possivel abrir o QR deste alvo.';
    } finally {
      delete state.loading[cooldownKey(alvo, 'qr')];
      render();
    }
  }

  async function reconectar(alvo) {
    state.loading[cooldownKey(alvo, 'reconectar')] = true;
    try {
      const data = await state.json(`/api/whatsapp/alvos/${alvo}/reconectar`, { method: 'POST' });
      state.qr[alvo] = data;
      delete state.feedback[alvo];
      aplicarCooldown(alvo, 'reconectar', data.cooldownAte, data.cooldownMs || 15000);
      await atualizarAlvo(alvo);
    } catch (error) {
      state.feedback[alvo] = error?.message || 'Nao foi possivel reconectar este alvo.';
    } finally {
      delete state.loading[cooldownKey(alvo, 'reconectar')];
      render();
    }
  }

  function bind() {
    $('waTargets').addEventListener('click', (event) => {
      const button = event.target.closest('[data-wa-action]');
      if (!button) return;
      const alvo = button.getAttribute('data-wa-target');
      const acao = button.getAttribute('data-wa-action');
      if (!alvo || !acao) return;
      if (acao === 'atualizar') return atualizarAlvo(alvo);
      if (acao === 'qr') return abrirQr(alvo);
      if (acao === 'reconectar') return reconectar(alvo);
      return undefined;
    });
  }

  function startPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (Object.keys(state.loading).length > 0) return;
      carregarAlvos().catch(() => undefined);
    }, 30000);
  }

  function start() {
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    state.contexto = window.PhoneMonitorPage?.getContext?.() || null;
    if (!state.json) return;
    if (!podeVer()) return esconderPainel();
    bind();
    carregarAlvos().catch((error) => {
      const box = $('waGlobalNotice');
      if (!box) return;
      box.className = 'result-box warn';
      box.textContent = error?.message || 'Falha ao carregar os alvos WhatsApp.';
    });
    startPolling();
  }

  let started = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (started) return;
    started = true;
    start();
  });
})();
