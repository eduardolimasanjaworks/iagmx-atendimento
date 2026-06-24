/**
 * Acoes principais do /phone voltadas a jornada e navegacao.
 * Mantem a troca de paineis e o disparo de jornadas no mesmo lugar.
 * Treinamento e OCR ficam em modulos separados para manter o arquivo curto.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { json: null, jornadas: [], rotasOferta: [], previewSeq: 0 };

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

  function setScenarioStatus(texto) {
    const el = $('simScenarioStatus');
    if (!el) return;
    el.textContent = texto || '';
  }

  function toDatetimeLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDatetimeLocal(v) {
    const raw = String(v || '').trim();
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function jornadaAtual() {
    return state.jornadas.find((item) => item.id === $('jornada').value) || null;
  }

  function jornadaEhOferta() {
    return $('jornada')?.value === 'cenario_5_oferta';
  }

  function rotaOfertaAtual() {
    return state.rotasOferta.find((item) => String(item.id) === $('journeyOfferRoute')?.value) || null;
  }

  function descreverRotaOferta(rota) {
    if (!rota) return 'Selecione uma rota real para montar o convite.';
    return `#${rota.id} · ${rota.origem} -> ${rota.destino}${rota.operacao ? ` · ${rota.operacao}` : ''} · min ${Number(rota.valor_minimo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })} · max ${Number(rota.valor_maximo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}`;
  }

  function renderRotasOferta() {
    const select = $('journeyOfferRoute');
    if (!select) return;
    const atual = select.value;
    select.innerHTML = state.rotasOferta
      .map((item) => `<option value="${item.id}">#${item.id} · ${item.origem} -> ${item.destino}${item.operacao ? ` · ${item.operacao}` : ''}</option>`)
      .join('');
    if (atual && state.rotasOferta.some((item) => String(item.id) === atual)) {
      select.value = atual;
    }
  }

  async function atualizarPreviewOferta() {
    if (!jornadaEhOferta()) return;
    const rota = rotaOfertaAtual();
    if (!rota) {
      $('journeyOfferMeta').textContent = 'Nenhuma rota ativa encontrada em config_rotas.';
      return;
    }
    if (!$('journeyOfferValue').value) $('journeyOfferValue').value = String(Number(rota.valor_minimo || 0));
    const seq = ++state.previewSeq;
    $('journeyOfferMeta').textContent = 'Carregando rota e mensagem reais do backend...';
    try {
      const data = await state.json('/api/admin/jornadas-teste/oferta-preview', {
        method: 'POST',
        body: JSON.stringify({
          configRotaId: rota.id,
          valorOfertado: $('journeyOfferValue').value || rota.valor_minimo,
        }),
      });
      if (seq !== state.previewSeq) return;
      $('mensagemInicial').value = data.mensagem || '';
      $('journeyOfferMeta').textContent = descreverRotaOferta(data.rota || rota);
    } catch (error) {
      if (seq !== state.previewSeq) return;
      $('journeyOfferMeta').textContent = error.message || 'Falha ao montar a oferta da rota selecionada.';
    }
  }

  function atualizarMensagemPadrao() {
    const jornada = jornadaAtual();
    $('journeyOfferFields').hidden = !jornadaEhOferta();
    if (!jornada) return;
    if (!jornadaEhOferta()) {
      $('mensagemInicial').value = jornada.mensagemPadrao || '';
      $('journeyOfferMeta').textContent = 'Selecione uma rota real para montar o convite.';
      return;
    }
    if (!state.rotasOferta.length) {
      $('mensagemInicial').value = jornada.mensagemPadrao || '';
      $('journeyOfferMeta').textContent = 'Nenhuma rota ativa encontrada em config_rotas.';
      return;
    }
    if (!$('journeyOfferRoute').value) $('journeyOfferRoute').value = String(state.rotasOferta[0].id);
    const rota = rotaOfertaAtual();
    if (rota && !$('journeyOfferValue').value) $('journeyOfferValue').value = String(Number(rota.valor_minimo || 0));
    atualizarPreviewOferta().catch((error) => setBox('journeyStatus', error.message || 'Falha ao montar a oferta', 'warn'));
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
    state.rotasOferta = data.rotasOferta || [];
    $('jornada').innerHTML = state.jornadas.map((item) => `<option value="${item.id}">Cenario ${item.cenario} - ${item.titulo}</option>`).join('');
    renderRotasOferta();
    atualizarMensagemPadrao();
    setBox('journeyStatus', `Jornadas carregadas: ${state.jornadas.length}\n${data.observacaoCampoTeste || ''}`);
  }

  async function iniciarJornada() {
    const telefone = telefoneAtual();
    if (!telefone) return setBox('journeyStatus', 'Informe o telefone do topo antes de iniciar a jornada', 'warn');
    if (jornadaEhOferta() && !rotaOfertaAtual()) {
      return setBox('journeyStatus', 'Selecione uma rota real antes de iniciar a jornada C5', 'warn');
    }
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
          configRotaId: jornadaEhOferta() ? rotaOfertaAtual()?.id : undefined,
          valorOfertado: jornadaEhOferta() ? $('journeyOfferValue').value.trim() : undefined,
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
    ['journeyPanel', 'opsPanel', 'whatsappPanel', 'monitorPanel', 'pausePanel', 'trainingPanel', 'simulatorPanel', 'editorPanel'].forEach((id) => { $(id).hidden = id !== alvo; });
  }

  function painelInicial() {
    const painel = new URLSearchParams(window.location.search).get('painel');
    return ['journeyPanel', 'opsPanel', 'whatsappPanel', 'monitorPanel', 'pausePanel', 'trainingPanel', 'simulatorPanel', 'editorPanel'].includes(`${painel}Panel`) ? `${painel}Panel` : 'journeyPanel';
  }

  function conectarEventos() {
    document.querySelectorAll('[data-panel]').forEach((btn) => btn.addEventListener('click', () => ativarPainel(btn.dataset.panel)));
    $('jornada').addEventListener('change', atualizarMensagemPadrao);
    $('journeyOfferRoute').addEventListener('change', () => {
      const rota = rotaOfertaAtual();
      if (rota) $('journeyOfferValue').value = String(Number(rota.valor_minimo || 0));
      atualizarPreviewOferta().catch((error) => setBox('journeyStatus', error.message || 'Falha ao atualizar rota', 'warn'));
    });
    $('journeyOfferValue').addEventListener('input', () => {
      atualizarPreviewOferta().catch((error) => setBox('journeyStatus', error.message || 'Falha ao atualizar valor da oferta', 'warn'));
    });
    $('iniciarBtn').addEventListener('click', iniciarJornada);
    $('recarregarJornadasBtn').addEventListener('click', () => carregarJornadas().catch((error) => setBox('journeyStatus', error.message || 'Falha ao recarregar jornadas', 'warn')));
    $('trainingOpenEditorBtn').addEventListener('click', () => ativarPainel('editorPanel'));

    let clicks = 0;
    const reveal = $('simScenarioReveal');
    const controls = $('simScenarioControls');
    if (reveal && controls) {
      reveal.addEventListener('click', async () => {
        clicks++;
        if (clicks < 6) return;
        controls.hidden = false;
        reveal.hidden = true;
        try {
          const st = await state.json('/api/admin/simulacao/cenario/status');
          if (st?.cenario?.nowIso && $('simScenarioNow')) $('simScenarioNow').value = toDatetimeLocal(st.cenario.nowIso);
          if (st?.cenario?.advanceHoursPorTick && $('simScenarioAdvanceHours')) $('simScenarioAdvanceHours').value = String(st.cenario.advanceHoursPorTick);
          setScenarioStatus(st?.cenario?.ativo ? 'ativo' : 'inativo');
        } catch {
          setScenarioStatus('sem acesso');
        }
      });
    }

    const startBtn = $('simScenarioStartBtn');
    const reviewBtn = $('simScenarioReviewBtn');
    if (startBtn) startBtn.addEventListener('click', async () => {
      if (!state.json) return;
      startBtn.disabled = true;
      setScenarioStatus('iniciando...');
      try {
        const nowIso = fromDatetimeLocal($('simScenarioNow')?.value);
        const advanceHoursPorTick = Number($('simScenarioAdvanceHours')?.value || 6);
        await state.json('/api/admin/simulacao/cenario/start', {
          method: 'POST',
          body: JSON.stringify({ nowIso: nowIso || undefined, advanceHoursPorTick }),
        });
        const st = await state.json('/api/admin/simulacao/cenario/status');
        setScenarioStatus(st?.cenario?.ativo ? 'ativo' : 'inativo');
      } catch (error) {
        setScenarioStatus(error?.message || 'falhou');
      } finally {
        startBtn.disabled = false;
      }
    });

    if (reviewBtn) reviewBtn.addEventListener('click', async () => {
      if (!state.json) return;
      reviewBtn.disabled = true;
      setScenarioStatus('revisando...');
      try {
        const r = await state.json('/api/admin/simulacao/cenario/review', { method: 'POST' });
        const apag = r?.apagados || {};
        setScenarioStatus(`limpo: ${apag.motoristas || 0} motoristas, ${apag.embarques || 0} embarques`);
      } catch (error) {
        setScenarioStatus(error?.message || 'falhou');
      } finally {
        reviewBtn.disabled = false;
      }
    });
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
