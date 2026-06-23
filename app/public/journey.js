/**
 * Frontend leve da tela de jornadas de teste.
 * Busca catalogo no backend admin e dispara a jornada escolhida.
 * Reaproveita a autenticacao do painel para evitar uma pagina isolada demais.
 */
const $ = (id) => document.getElementById(id);

const state = {
  jornadas: [],
  json: null,
};

function normalizarTelefone(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function renderInfo(jornada) {
  const alvo = $('jornadaInfo');
  if (!jornada) {
    alvo.innerHTML = '';
    return;
  }
  alvo.innerHTML = `
    <div class="box"><span class="muted">Cenario</span><strong>${jornada.cenario}</strong></div>
    <div class="box"><span class="muted">Titulo</span><strong>${jornada.titulo}</strong></div>
    <div class="box"><span class="muted">Tipo</span><strong>${jornada.origemMensagem}</strong></div>
    <div class="box"><span class="muted">Descricao</span><strong>${jornada.descricao}</strong></div>
  `;
}

function setStatus(texto, classe) {
  const el = $('status');
  el.className = `result${classe ? ` ${classe}` : ''}`;
  el.textContent = texto;
}

function jornadaAtual() {
  return state.jornadas.find((item) => item.id === $('jornada').value) || null;
}

function atualizarMensagemPadrao() {
  const jornada = jornadaAtual();
  renderInfo(jornada);
  if (!jornada) return;
  $('mensagemInicial').value = jornada.mensagemPadrao || '';
}

function atualizarLinkMonitor() {
  const telefone = normalizarTelefone($('telefone').value);
  $('monitorLink').href = telefone ? `/phone=${encodeURIComponent(telefone)}` : '/phone.html';
}

async function carregarJornadas() {
  setStatus('Carregando jornadas...', '');
  const data = await state.json('/api/admin/jornadas-teste');
  state.jornadas = data.jornadas || [];
  $('jornada').innerHTML = state.jornadas
    .map((item) => `<option value="${item.id}">Cenario ${item.cenario} - ${item.titulo}</option>`)
    .join('');
  atualizarMensagemPadrao();
  setStatus(
    `Jornadas carregadas: ${state.jornadas.length}\n\n${data.observacaoCampoTeste || ''}`,
    '',
  );
}

function resumoResultado(resultado) {
  const monitor = `/phone=${encodeURIComponent(resultado.telefone)}`;
  return [
    `Telefone: ${resultado.telefone}`,
    `Motorista ID: ${resultado.motoristaId}`,
    `Motorista criado agora: ${resultado.motoristaCriado ? 'sim' : 'nao'}`,
    `Jornada: cenario ${resultado.jornada.cenario} - ${resultado.jornada.titulo}`,
    `Mensagem enviada: ${resultado.enviado ? 'sim' : 'nao'}`,
    `Fragmentos: ${resultado.fragmentos}`,
    `Observacao teste: ${resultado.observacaoMotorista || 'sem tag adicional'}`,
    `Monitor: ${monitor}`,
    '',
    'Mensagem inicial:',
    resultado.mensagemInicial,
    '',
    resultado.reset
      ? `Reset: historico=${resultado.reset.historicoLimpo ? 'sim' : 'nao'}, debounce=${resultado.reset.mensagensDebounceRemovidas}, fila=${resultado.reset.respostasPendentesRemovidas}, traces=${resultado.reset.tracesRemovidos}`
      : 'Reset: nao executado',
  ].join('\n');
}

async function iniciarJornada() {
  const telefone = normalizarTelefone($('telefone').value);
  if (!telefone) {
    setStatus('Informe o telefone com DDD para iniciar a jornada', 'warn');
    $('telefone').focus();
    return;
  }

  const body = {
    telefone,
    jornadaId: $('jornada').value,
    nomeMotorista: $('nomeMotorista').value.trim() || undefined,
    mensagemInicial: $('mensagemInicial').value.trim(),
    resetarHistorico: $('resetarHistorico').checked,
    marcarComoTeste: $('marcarComoTeste').checked,
  };

  const btn = $('iniciarBtn');
  btn.disabled = true;
  setStatus('Iniciando jornada e aguardando envio real no WhatsApp...', '');

  try {
    const data = await state.json('/api/admin/jornadas-teste/iniciar', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    atualizarLinkMonitor();
    setStatus(`${data.mensagem || 'Jornada iniciada'}\n\n${resumoResultado(data.resultado)}`, 'ok');
  } catch (error) {
    const resultado = error?.data?.resultado;
    if (resultado) {
      atualizarLinkMonitor();
      setStatus(
        `${error.message || 'Falha ao iniciar jornada'}\n\n${resumoResultado(resultado)}`,
        'warn',
      );
      return;
    }
    setStatus(error.message || 'Falha ao iniciar jornada', 'warn');
  } finally {
    btn.disabled = false;
  }
}

async function resetarContato() {
  const telefone = normalizarTelefone($('telefone').value);
  if (!telefone) {
    setStatus('Informe o telefone com DDD para apagar o historico', 'warn');
    $('telefone').focus();
    return;
  }

  const btn = $('resetBtn');
  btn.disabled = true;
  setStatus('Apagando historico operacional do contato...', '');

  try {
    const data = await state.json('/api/admin/contatos/resetar-historico', {
      method: 'POST',
      body: JSON.stringify({ telefone }),
    });
    atualizarLinkMonitor();
    setStatus(
      [
        data.mensagem || 'Historico apagado',
        '',
        `Telefone: ${data.resultado.telefone}`,
        `Historico: ${data.resultado.historicoLimpo ? 'sim' : 'nao'}`,
        `Debounce removido: ${data.resultado.mensagensDebounceRemovidas}`,
        `Fila removida: ${data.resultado.respostasPendentesRemovidas}`,
        `Traces removidos: ${data.resultado.tracesRemovidos}`,
        `Estado de fluxo limpo: ${data.resultado.estadoFluxoLimpo ? 'sim' : 'nao'}`,
      ].join('\n'),
      'ok',
    );
  } catch (error) {
    setStatus(error.message || 'Falha ao apagar historico do contato', 'warn');
  } finally {
    btn.disabled = false;
  }
}

window.IagmxPainelAuth.boot({
  onReady(contexto) {
    if (contexto.usuario?.perfil !== 'admin') {
      setStatus('Seu login nao tem acesso a esta area', 'warn');
      $('iniciarBtn').disabled = true;
      return;
    }

    state.json = window.IagmxPainelAuth.json;
    $('jornada').addEventListener('change', atualizarMensagemPadrao);
    $('telefone').addEventListener('input', atualizarLinkMonitor);
    $('recarregarBtn').addEventListener('click', () => carregarJornadas().catch((error) => {
      setStatus(error.message || 'Falha ao carregar jornadas', 'warn');
    }));
    $('iniciarBtn').addEventListener('click', () => iniciarJornada());
    $('resetBtn').addEventListener('click', () => resetarContato());
    atualizarLinkMonitor();
    carregarJornadas().catch((error) => {
      setStatus(error.message || 'Falha ao carregar jornadas', 'warn');
    });
  },
});
