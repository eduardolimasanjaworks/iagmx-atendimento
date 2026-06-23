/**
 * Editor embutido de jornadas no monitor por telefone.
 * Mantem o CRUD de jornadas e a troca entre as abas do editor.
 * O OCR fica em um modulo proprio para reduzir ruido e tamanho do arquivo.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { json: null, jornadas: [], jornadaId: '' };

  function setBox(id, text, kind = '') {
    const el = $(id);
    if (!el) return;
    el.className = `result-box${kind ? ` ${kind}` : ''}`;
    el.textContent = text;
  }

  function nId(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  }

  function pickById(list, id) {
    return list.find((item) => item.id === id) || null;
  }

  function blankJourney(seed = {}) {
    return { id: '', cenario: 0, titulo: '', descricao: '', origemMensagem: 'empresa', mensagemPadrao: '', ativa: true, ...seed };
  }

  function renderJourneySelect() {
    $('editorJornadaSelect').innerHTML = ['<option value="">Nova jornada</option>'].concat(
      state.jornadas.map((item) => `<option value="${item.id}">C${item.cenario} - ${item.titulo}</option>`),
    ).join('');
    $('editorJornadaSelect').value = state.jornadaId || '';
  }

  function fillJourneyForm(item) {
    const data = blankJourney(item || {});
    $('editorJornadaId').value = data.id;
    $('editorJornadaTitulo').value = data.titulo;
    $('editorJornadaCenario').value = String(data.cenario || 0);
    $('editorJornadaDescricao').value = data.descricao;
    $('editorJornadaMensagem').value = data.mensagemPadrao;
    $('editorJornadaAtiva').checked = data.ativa !== false;
  }

  function collectJourneyForm() {
    return blankJourney({
      id: $('editorJornadaId').value,
      cenario: Number($('editorJornadaCenario').value || 0),
      titulo: $('editorJornadaTitulo').value.trim(),
      descricao: $('editorJornadaDescricao').value.trim(),
      mensagemPadrao: $('editorJornadaMensagem').value.trim(),
      ativa: $('editorJornadaAtiva').checked,
    });
  }

  function selectJourney(id) {
    state.jornadaId = id || '';
    renderJourneySelect();
    fillJourneyForm(pickById(state.jornadas, state.jornadaId));
  }

  async function loadJourneys(statusText) {
    const data = await state.json('/api/admin/jornadas-teste');
    state.jornadas = data.catalogo || [];
    if (!pickById(state.jornadas, state.jornadaId)) state.jornadaId = state.jornadas[0]?.id || '';
    renderJourneySelect();
    fillJourneyForm(pickById(state.jornadas, state.jornadaId));
    if (statusText) setBox('editorJornadaStatus', statusText, 'ok');
  }

  async function saveJourney() {
    const body = collectJourneyForm();
    if (!body.id || !body.titulo || !body.mensagemPadrao) return setBox('editorJornadaStatus', 'Preencha codigo, titulo e mensagem inicial da jornada.', 'warn');
    const currentId = state.jornadaId;
    const data = await state.json(currentId ? `/api/admin/jornadas-teste/catalogo/${encodeURIComponent(currentId)}` : '/api/admin/jornadas-teste/catalogo', {
      method: currentId ? 'PUT' : 'POST', body: JSON.stringify(body),
    });
    state.jornadas = data.catalogo || [];
    state.jornadaId = nId(body.id);
    renderJourneySelect();
    fillJourneyForm(pickById(state.jornadas, state.jornadaId));
    window.dispatchEvent(new CustomEvent('phone-journeys-updated'));
    setBox('editorJornadaStatus', data.mensagem || 'Jornada salva com sucesso.', 'ok');
  }

  async function deleteJourney() {
    if (!state.jornadaId) return setBox('editorJornadaStatus', 'Selecione uma jornada salva para excluir.', 'warn');
    if (!window.confirm(`Excluir a jornada "${state.jornadaId}"?`)) return;
    const data = await state.json(`/api/admin/jornadas-teste/catalogo/${encodeURIComponent(state.jornadaId)}`, { method: 'DELETE' });
    state.jornadas = data.catalogo || [];
    state.jornadaId = state.jornadas[0]?.id || '';
    renderJourneySelect();
    fillJourneyForm(pickById(state.jornadas, state.jornadaId));
    window.dispatchEvent(new CustomEvent('phone-journeys-updated'));
    setBox('editorJornadaStatus', data.mensagem || 'Jornada removida.', 'ok');
  }

  function switchEditor(targetId) {
    ['editorJourneyBox', 'editorOcrBox'].forEach((id) => { $(id).hidden = id !== targetId; });
    document.querySelectorAll('[data-editor]').forEach((btn) => btn.classList.toggle('active', btn.dataset.editor === targetId));
  }

  function bind() {
    document.querySelectorAll('[data-editor]').forEach((btn) => btn.addEventListener('click', () => switchEditor(btn.dataset.editor)));
    $('editorJornadaSelect').addEventListener('change', () => selectJourney($('editorJornadaSelect').value));
    $('editorJornadaNovoBtn').addEventListener('click', () => selectJourney(''));
    $('editorJornadaDuplicarBtn').addEventListener('click', () => fillJourneyForm(blankJourney({ ...collectJourneyForm(), id: `${nId($('editorJornadaId').value || 'jornada')}_copia`, titulo: `${$('editorJornadaTitulo').value.trim() || 'Nova jornada'} copia` })));
    $('editorJornadaSalvarBtn').addEventListener('click', () => saveJourney().catch((error) => setBox('editorJornadaStatus', error.message || 'Falha ao salvar jornada.', 'warn')));
    $('editorJornadaExcluirBtn').addEventListener('click', () => deleteJourney().catch((error) => setBox('editorJornadaStatus', error.message || 'Falha ao excluir jornada.', 'warn')));
  }

  let started = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (started) return;
    started = true;
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    if (!state.json) return;
    bind();
    loadJourneys('Catalogo de jornadas carregado.').catch((error) => setBox('editorJornadaStatus', error.message || 'Falha ao carregar jornadas.', 'warn'));
  });
})();
