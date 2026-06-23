/**
 * Painel de treinamento da IA dentro do /phone.
 * Separa o cadastro de telefones autorizados da criacao de novas regras.
 * Reaproveita as APIs admin existentes e evita um CRUD paralelo improvisado.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { json: null, treinadores: [] };

  function setBox(id, texto, classe = '') {
    const el = $(id);
    if (!el) return;
    el.className = `result-box${classe ? ` ${classe}` : ''}`;
    el.textContent = texto;
  }

  function normalizarTelefone(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  function renderPendencias(itens) {
    const root = $('trainingPendencias');
    root.innerHTML = !itens.length ? 'Nenhuma pendencia de treinamento agora.' : itens.slice(0, 5).map((item) => `
      <div class="pending-item">
        <strong>Proposta #${item.id}</strong>
        <div>${String(item.resumo_sugerido || item.instrucao_sugerida || '').replace(/</g, '&lt;')}</div>
        <div class="admin-help" style="margin-top:.45rem">autor: ${item.nome_autor || item.telefone_autor || 'nao informado'}</div>
        <div class="pending-actions">
          <button type="button" data-approve="${item.id}">Aprovar</button>
          <button type="button" data-cancel="${item.id}">Cancelar</button>
        </div>
      </div>`).join('');
  }

  function renderTreinadores() {
    const root = $('trainingTrainerList');
    root.innerHTML = !state.treinadores.length ? '<div class="stack-empty">Nenhum telefone autorizado cadastrado.</div>' : state.treinadores.map((item) => `
      <div class="stack-item">
        <div class="stack-grid guided-grid">
          <div class="field compact-field"><label>Nome</label><input type="text" value="${item.nome || '-'}" readonly /></div>
          <div class="field compact-field"><label>Telefone</label><input type="text" value="${item.telefone || '-'}" readonly /></div>
          <div class="field compact-field"><label>Funcao</label><input type="text" value="${item.cargo || '-'}" readonly /></div>
          <div class="field compact-field"><label>Status</label><input type="text" value="${item.ativo ? 'ativo' : 'inativo'}" readonly /></div>
        </div>
        <div class="pending-actions">
          <button type="button" data-use-trainer="${item.id}">Usar como autor</button>
          <button type="button" data-toggle-trainer="${item.id}" data-next-active="${item.ativo ? 'false' : 'true'}">${item.ativo ? 'Desativar' : 'Ativar'}</button>
          <button type="button" data-delete-trainer="${item.id}">Excluir</button>
        </div>
      </div>`).join('');
  }

  function limparTreinadorForm() {
    $('trainerManagePhone').value = '';
    $('trainerManageName').value = '';
    $('trainerManageRole').value = '';
  }

  function usarComoAutor(id) {
    const item = state.treinadores.find((row) => String(row.id) === String(id));
    if (!item) return;
    $('trainerPhone').value = item.telefone || '';
    $('trainerName').value = item.nome || '';
    setBox('trainingStatus', `Autor da regra preenchido com ${item.nome || item.telefone}.`, 'ok');
  }

  async function carregarTreinamento() {
    const [telefones, pendencias, aprendizados] = await Promise.all([
      state.json('/api/admin/treinamento/telefones'),
      state.json('/api/admin/treinamento/pendencias'),
      state.json('/api/admin/treinamento/aprendizados'),
    ]);
    state.treinadores = telefones.itens || [];
    $('statTrainers').textContent = String(state.treinadores.filter((item) => item.ativo).length);
    $('statPending').textContent = String((pendencias.itens || []).filter((item) => item.status === 'pendente').length);
    $('statLearned').textContent = String((aprendizados.itens || []).filter((item) => item.ativo).length);
    renderTreinadores();
    renderPendencias((pendencias.itens || []).filter((item) => item.status === 'pendente'));
    setBox('trainingStatus', 'Telefones autorizados e regras carregados.', 'ok');
  }

  async function salvarTreinador() {
    const telefone = normalizarTelefone($('trainerManagePhone').value);
    if (!telefone) return setBox('trainingStatus', 'Informe um telefone valido para autorizar treinamento.', 'warn');
    await state.json('/api/admin/treinamento/telefones', {
      method: 'POST',
      body: JSON.stringify({ telefone, nome: $('trainerManageName').value.trim() || undefined, cargo: $('trainerManageRole').value.trim() || undefined, ativo: true }),
    });
    limparTreinadorForm();
    await carregarTreinamento();
    setBox('trainingStatus', 'Telefone autorizado salvo com sucesso.', 'ok');
  }

  async function enviarInstrucao(aplicarAgora) {
    const texto = $('trainingInstruction').value.trim();
    if (texto.length < 10) return setBox('trainingStatus', 'Escreva uma regra mais completa antes de enviar.', 'warn');
    const data = await state.json('/api/admin/treinamento/instrucao-direta', {
      method: 'POST',
      body: JSON.stringify({ telefoneAutor: $('trainerPhone').value.trim() || undefined, nomeAutor: $('trainerName').value.trim() || undefined, texto, aplicarAgora }),
    });
    $('trainingInstruction').value = '';
    await carregarTreinamento();
    setBox('trainingStatus', data.modo === 'aplicado' ? `Regra aplicada agora.\n\n${data.item.resumo || data.item.instrucao}` : `Proposta criada com sucesso.\n\n${data.item.resumo_sugerido || data.item.instrucao_sugerida}`, 'ok');
  }

  async function aprovarOuCancelar(id, acao) {
    await state.json(`/api/admin/treinamento/pendencias/${id}/${acao}`, { method: 'POST', body: JSON.stringify({ autor: 'dashboard' }) });
    await carregarTreinamento();
    setBox('trainingStatus', `Proposta #${id} ${acao === 'aprovar' ? 'aprovada' : 'cancelada'} com sucesso.`, 'ok');
  }

  async function atualizarTreinador(id, ativo) {
    await state.json(`/api/admin/treinamento/telefones/${id}`, { method: 'PUT', body: JSON.stringify({ ativo }) });
    await carregarTreinamento();
    setBox('trainingStatus', `Telefone ${ativo ? 'ativado' : 'desativado'} com sucesso.`, 'ok');
  }

  async function excluirTreinador(id) {
    await state.json(`/api/admin/treinamento/telefones/${id}`, { method: 'DELETE' });
    await carregarTreinamento();
    setBox('trainingStatus', 'Telefone autorizado removido.', 'ok');
  }

  function bind() {
    $('trainingProposalBtn').addEventListener('click', () => enviarInstrucao(false).catch((error) => setBox('trainingStatus', error.message || 'Falha ao criar proposta.', 'warn')));
    $('trainingApplyBtn').addEventListener('click', () => enviarInstrucao(true).catch((error) => setBox('trainingStatus', error.message || 'Falha ao aplicar regra.', 'warn')));
    $('trainingTrainerAddBtn').addEventListener('click', () => salvarTreinador().catch((error) => setBox('trainingStatus', error.message || 'Falha ao salvar telefone autorizado.', 'warn')));
    $('trainingTrainerClearBtn').addEventListener('click', limparTreinadorForm);
    $('trainingPendencias').addEventListener('click', (event) => {
      const btn = event.target.closest('button');
      if (!btn) return;
      if (btn.dataset.approve) aprovarOuCancelar(btn.dataset.approve, 'aprovar').catch((error) => setBox('trainingStatus', error.message || 'Falha ao aprovar proposta.', 'warn'));
      if (btn.dataset.cancel) aprovarOuCancelar(btn.dataset.cancel, 'cancelar').catch((error) => setBox('trainingStatus', error.message || 'Falha ao cancelar proposta.', 'warn'));
    });
    $('trainingTrainerList').addEventListener('click', (event) => {
      const btn = event.target.closest('button');
      if (!btn) return;
      if (btn.dataset.useTrainer) usarComoAutor(btn.dataset.useTrainer);
      if (btn.dataset.toggleTrainer) atualizarTreinador(btn.dataset.toggleTrainer, btn.dataset.nextActive === 'true').catch((error) => setBox('trainingStatus', error.message || 'Falha ao atualizar telefone autorizado.', 'warn'));
      if (btn.dataset.deleteTrainer) excluirTreinador(btn.dataset.deleteTrainer).catch((error) => setBox('trainingStatus', error.message || 'Falha ao excluir telefone autorizado.', 'warn'));
    });
  }

  let started = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (started) return;
    started = true;
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    if (!state.json) return;
    bind();
    carregarTreinamento().catch((error) => setBox('trainingStatus', error.message || 'Falha ao carregar treinamento.', 'warn'));
  });
})();
