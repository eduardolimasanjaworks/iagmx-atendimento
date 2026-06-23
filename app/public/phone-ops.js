/**
 * Operacao avancada embutida no /phone.
 * Controla humanizacao, atraso inicial, debounce e reload do app.
 * Usa as APIs admin existentes para manter efeito imediato e centralizado.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { json: null, envioPadrao: null, tempoPadrao: null };

  function setStatus(texto, classe = '') {
    const box = $('opsStatus');
    if (!box) return;
    box.className = `result-box${classe ? ` ${classe}` : ''}`;
    box.textContent = texto;
  }

  function preencherEnvio(cfg) {
    $('opsAtrasoInicialMin').value = cfg.atrasoInicialMinMs ?? 300000;
    $('opsAtrasoInicialMax').value = cfg.atrasoInicialMaxMs ?? 600000;
    $('opsDelayMin').value = cfg.delayMinMs ?? 1800;
    $('opsDelayMax').value = cfg.delayMaxMs ?? 4200;
    $('opsDigMin').value = cfg.digitandoMinMs ?? 1200;
    $('opsDigMax').value = cfg.digitandoMaxMs ?? 3200;
    $('opsDigAtivo').checked = cfg.digitandoAtivo !== false;
  }

  function preencherTempo(cfg) {
    $('opsDebounceMs').value = cfg.debounceMs ?? 2200;
    $('opsDebounceWorker').value = cfg.debounceWorkerMs ?? 300;
  }

  async function carregar() {
    try {
      const [envio, tempo] = await Promise.all([
        state.json('/api/config/envio'),
        state.json('/api/config/tempo'),
      ]);
      state.envioPadrao = envio.padrao || envio.config || null;
      state.tempoPadrao = tempo.padrao || tempo.config || null;
      preencherEnvio(envio.config || {});
      preencherTempo(tempo.config || {});
      setStatus(
        [
          'Humanizacao e debounce carregados.',
          '',
          `Atraso inicial atual: ${envio.config?.atrasoInicialMinMs ?? '-'} a ${envio.config?.atrasoInicialMaxMs ?? '-'} ms`,
          `Delay entre bolhas: ${envio.config?.delayMinMs ?? '-'} a ${envio.config?.delayMaxMs ?? '-'} ms`,
          `Debounce atual: ${tempo.config?.debounceMs ?? '-'} ms`,
          `Worker poll: ${tempo.config?.debounceWorkerMs ?? '-'} ms`,
        ].join('\n'),
        'ok',
      );
    } catch (error) {
      setStatus(error.message || 'Falha ao carregar configuracao operacional.', 'warn');
    }
  }

  async function salvarEnvio() {
    const btn = $('opsSalvarEnvioBtn');
    btn.disabled = true;
    setStatus('Salvando humanizacao e atraso inicial...');
    try {
      const data = await state.json('/api/config/envio', {
        method: 'PUT',
        body: JSON.stringify({
          atrasoInicialMinMs: Number($('opsAtrasoInicialMin').value),
          atrasoInicialMaxMs: Number($('opsAtrasoInicialMax').value),
          delayMinMs: Number($('opsDelayMin').value),
          delayMaxMs: Number($('opsDelayMax').value),
          digitandoMinMs: Number($('opsDigMin').value),
          digitandoMaxMs: Number($('opsDigMax').value),
          digitandoAtivo: $('opsDigAtivo').checked,
        }),
      });
      preencherEnvio(data.config || {});
      setStatus('Humanizacao salva com efeito imediato no envio do WhatsApp.', 'ok');
    } catch (error) {
      setStatus(error.message || 'Falha ao salvar humanizacao.', 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  async function salvarTempo() {
    const btn = $('opsSalvarTempoBtn');
    btn.disabled = true;
    setStatus('Salvando debounce...');
    try {
      const data = await state.json('/api/config/tempo', {
        method: 'PUT',
        body: JSON.stringify({
          debounceMs: Number($('opsDebounceMs').value),
          debounceWorkerMs: Number($('opsDebounceWorker').value),
        }),
      });
      preencherTempo(data.config || {});
      setStatus(data.mensagem || 'Debounce salvo com efeito imediato.', 'ok');
    } catch (error) {
      setStatus(error.message || 'Falha ao salvar debounce.', 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  function restaurarEnvio() {
    preencherEnvio(state.envioPadrao || {});
    setStatus('Os campos de envio voltaram para os valores padrao que estavam carregados nesta tela.', 'ok');
  }

  function restaurarTempo() {
    preencherTempo(state.tempoPadrao || {});
    setStatus('Os campos de tempo voltaram para os valores padrao que estavam carregados nesta tela.', 'ok');
  }

  async function recarregarProcesso() {
    const btn = $('opsReloadBtn');
    btn.disabled = true;
    setStatus('Recarregando processo Node...');
    try {
      const data = await state.json('/api/admin/reload-processo', { method: 'POST' });
      setStatus(`${data.mensagem || 'Processo recarregado'}${data.build ? `\nBuild ${data.build}` : ''}`, 'ok');
    } catch (error) {
      setStatus(error.message || 'Falha ao recarregar processo.', 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  function bind() {
    $('opsSalvarEnvioBtn').addEventListener('click', salvarEnvio);
    $('opsRestaurarEnvioBtn').addEventListener('click', restaurarEnvio);
    $('opsSalvarTempoBtn').addEventListener('click', salvarTempo);
    $('opsRestaurarTempoBtn').addEventListener('click', restaurarTempo);
    $('opsReloadBtn').addEventListener('click', recarregarProcesso);
  }

  let iniciado = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (iniciado) return;
    iniciado = true;
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    if (!state.json) return;
    bind();
    carregar().catch(() => undefined);
  });
})();
