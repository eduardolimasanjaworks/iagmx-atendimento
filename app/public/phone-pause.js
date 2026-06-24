/**
 * Controles de pausa por contato dentro do monitor /phone.
 * Usa os endpoints de atendimento ja existentes para pausar ou retomar a IA.
 * Mantem o foco sempre no contato atualmente selecionado na tela.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { json: null, timer: null, ultimoTelefone: '', bloqueado: false };

  function telefoneAtual() {
    return window.PhoneMonitorPage?.getPhone?.() || '';
  }

  function setStatus(texto, classe = '') {
    const box = $('pauseStatus');
    if (!box) return;
    box.className = `result-box${classe ? ` ${classe}` : ''}`;
    box.textContent = texto;
  }

  async function carregarEstado() {
    if (state.bloqueado) return;
    const telefone = telefoneAtual();
    $('pausePhoneView').value = telefone || '';
    if (!telefone) {
      state.ultimoTelefone = '';
      return setStatus('Selecione um contato em foco para pausar ou retomar a conversa.', 'warn');
    }
    try {
      const data = await state.json(`/api/atendimento/contato/${encodeURIComponent(telefone)}`);
      state.ultimoTelefone = telefone;
      setStatus(
        [
          `Telefone: ${data.telefone}`,
          `IA ativa efetivamente: ${data.ia_ativa_efetiva ? 'sim' : 'nao'}`,
          `Modo global: ${data.ia_modo_global === 'default_off' ? 'desligada por padrao' : 'liberada por padrao'}`,
          `Liberada individualmente: ${data.ia_liberada_contato ? 'sim' : 'nao'}`,
          `IA pausada: ${data.ia_pausada ? 'sim' : 'nao'}`,
          `Motivo: ${data.ia_pausa_motivo || 'sem motivo registrado'}`,
          `Precisa atendimento: ${data.precisa_atendimento ? 'sim' : 'nao'}`,
          `Ultima intencao: ${data.ultima_intencao_whatsapp || 'nao informada'}`,
        ].join('\n'),
        data.ia_pausada ? 'warn' : 'ok',
      );
      $('resumeContactBtn').textContent =
        data.ia_modo_global === 'default_off'
          ? 'Liberar este contato'
          : 'Retomar este contato';
    } catch (error) {
      if (/autentic|autoriz|admin/i.test(String(error?.message || ''))) {
        state.bloqueado = true;
        if (state.timer) clearInterval(state.timer);
        return setStatus('Seu login atual nao pode consultar a pausa deste contato.', 'warn');
      }
      setStatus(error.message || 'Falha ao consultar estado de pausa do contato.', 'warn');
    }
  }

  async function pausar() {
    if (state.bloqueado) return;
    const telefone = telefoneAtual();
    if (!telefone) return setStatus('Selecione um contato em foco antes de pausar.', 'warn');
    $('pauseContactBtn').disabled = true;
    setStatus('Pausando este contato...');
    try {
      await state.json(`/api/atendimento/contato/${encodeURIComponent(telefone)}/pausar`, {
        method: 'POST',
        body: JSON.stringify({ motivo: $('pauseReason').value.trim() || 'pausado_pelo_monitor_phone' }),
      });
      await carregarEstado();
    } catch (error) {
      setStatus(error.message || 'Falha ao pausar este contato.', 'warn');
    } finally {
      $('pauseContactBtn').disabled = false;
    }
  }

  async function retomar() {
    if (state.bloqueado) return;
    const telefone = telefoneAtual();
    if (!telefone) return setStatus('Selecione um contato em foco antes de retomar.', 'warn');
    $('resumeContactBtn').disabled = true;
    setStatus('Retomando este contato...');
    try {
      await state.json(`/api/atendimento/contato/${encodeURIComponent(telefone)}/pausar`, {
        method: 'DELETE',
      });
      await carregarEstado();
    } catch (error) {
      setStatus(error.message || 'Falha ao retomar este contato.', 'warn');
    } finally {
      $('resumeContactBtn').disabled = false;
    }
  }

  function iniciarPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => {
      const telefone = telefoneAtual();
      if (!telefone) return;
      carregarEstado().catch(() => undefined);
    }, 2000);
  }

  function iniciar() {
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    if (!state.json) return;
    $('pauseContactBtn').addEventListener('click', pausar);
    $('resumeContactBtn').addEventListener('click', retomar);
    $('refreshPauseBtn').addEventListener('click', () => carregarEstado());
    carregarEstado().catch(() => undefined);
    iniciarPolling();
  }

  let iniciado = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (iniciado) return;
    iniciado = true;
    iniciar();
  });
})();
