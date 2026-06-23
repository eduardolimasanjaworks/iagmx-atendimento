/**
 * Editor embutido de jornadas e OCR no monitor por telefone.
 * Mantem CRUD na mesma tela, sem atalhos paralelos nem estado oculto.
 * Tambem salva os prompts OCR usados antes de enviar os dados ao Directus.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { json: null, jornadas: [], docs: [], jornadaId: '', docId: '' };

  function setBox(id, text, kind = '') {
    const el = $(id);
    if (!el) return;
    el.className = `result-box${kind ? ` ${kind}` : ''}`;
    el.textContent = text;
  }

  function nId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
  }

  function pickById(list, id) {
    return list.find((item) => item.id === id) || null;
  }

  function blankJourney(seed = {}) {
    return { id: '', cenario: 0, titulo: '', descricao: '', origemMensagem: 'empresa', mensagemPadrao: '', ativa: true, ...seed };
  }

  function blankDoc(seed = {}) {
    return { id: '', rotulo: '', tipoDocumento: '', colecao: '', dicaPrompt: '', ativo: true, campos: [], ...seed };
  }

  function blankCampo(seed = {}) {
    return { id: '', rotulo: '', chaveExtraida: '', campoDirectus: '', destino: 'documento', regex: '', ...seed };
  }

  function renderJourneySelect() {
    const select = $('editorJornadaSelect');
    const options = ['<option value="">Nova jornada</option>'].concat(
      state.jornadas.map((item) => `<option value="${item.id}">C${item.cenario} - ${item.titulo}</option>`),
    );
    select.innerHTML = options.join('');
    select.value = state.jornadaId || '';
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
    if (!body.id || !body.titulo || !body.mensagemPadrao) {
      return setBox('editorJornadaStatus', 'Preencha ID, titulo e mensagem inicial da jornada.', 'warn');
    }
    const currentId = state.jornadaId;
    const url = currentId ? `/api/admin/jornadas-teste/catalogo/${encodeURIComponent(currentId)}` : '/api/admin/jornadas-teste/catalogo';
    const method = currentId ? 'PUT' : 'POST';
    setBox('editorJornadaStatus', currentId ? 'Salvando jornada...' : 'Criando jornada...');
    const data = await state.json(url, { method, body: JSON.stringify(body) });
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
    setBox('editorJornadaStatus', 'Excluindo jornada...');
    const data = await state.json(`/api/admin/jornadas-teste/catalogo/${encodeURIComponent(state.jornadaId)}`, { method: 'DELETE' });
    state.jornadas = data.catalogo || [];
    state.jornadaId = state.jornadas[0]?.id || '';
    renderJourneySelect();
    fillJourneyForm(pickById(state.jornadas, state.jornadaId));
    window.dispatchEvent(new CustomEvent('phone-journeys-updated'));
    setBox('editorJornadaStatus', data.mensagem || 'Jornada removida.', 'ok');
  }

  function renderDocSelect() {
    const select = $('ocrDocSelect');
    const options = ['<option value="">Novo documento</option>'].concat(
      state.docs.map((item) => `<option value="${item.id}">${item.rotulo || item.id}</option>`),
    );
    select.innerHTML = options.join('');
    select.value = state.docId || '';
  }

  function collectCampos() {
    return Array.from(document.querySelectorAll('#ocrCamposList .stack-item')).map((row, index) => {
      const read = (name) => row.querySelector(`[data-name="${name}"]`)?.value || '';
      return blankCampo({
        id: read('id') || `campo_${index + 1}`,
        rotulo: read('rotulo').trim(),
        chaveExtraida: read('chaveExtraida').trim(),
        campoDirectus: read('campoDirectus').trim(),
        destino: read('destino') === 'motorista' ? 'motorista' : 'documento',
        regex: read('regex').trim(),
      });
    }).filter((campo) => campo.chaveExtraida && campo.campoDirectus);
  }

  function renderCampos(campos) {
    const root = $('ocrCamposList');
    root.innerHTML = (campos || []).map((_, index) => `
      <div class="stack-item" data-index="${index}">
        <div class="stack-grid">
          <input data-name="id" type="text" placeholder="id_campo" />
          <input data-name="rotulo" type="text" placeholder="Rotulo visivel" />
          <input data-name="chaveExtraida" type="text" placeholder="chave extraida" />
          <input data-name="campoDirectus" type="text" placeholder="campo directus" />
          <select data-name="destino"><option value="documento">documento</option><option value="motorista">motorista</option></select>
          <input data-name="regex" type="text" placeholder="regex opcional" />
        </div>
        <button class="stack-remove" type="button" data-remove-index="${index}">Remover campo</button>
      </div>
    `).join('') || '<div class="stack-empty">Nenhum campo configurado para este documento.</div>';
    Array.from(root.querySelectorAll('.stack-item')).forEach((row, index) => {
      const campo = blankCampo(campos[index] || {});
      row.querySelector('[data-name="id"]').value = campo.id;
      row.querySelector('[data-name="rotulo"]').value = campo.rotulo;
      row.querySelector('[data-name="chaveExtraida"]').value = campo.chaveExtraida;
      row.querySelector('[data-name="campoDirectus"]').value = campo.campoDirectus;
      row.querySelector('[data-name="destino"]').value = campo.destino;
      row.querySelector('[data-name="regex"]').value = campo.regex || '';
    });
  }

  function fillDocForm(item) {
    const data = blankDoc(item || {});
    $('ocrDocId').value = data.id;
    $('ocrDocRotulo').value = data.rotulo;
    $('ocrDocTipo').value = data.tipoDocumento;
    $('ocrDocColecao').value = data.colecao;
    $('ocrDocDica').value = data.dicaPrompt;
    $('ocrDocAtivo').checked = data.ativo !== false;
    renderCampos(data.campos || []);
  }

  function collectDocForm() {
    return blankDoc({
      id: $('ocrDocId').value,
      rotulo: $('ocrDocRotulo').value.trim(),
      tipoDocumento: $('ocrDocTipo').value.trim(),
      colecao: $('ocrDocColecao').value.trim(),
      dicaPrompt: $('ocrDocDica').value.trim(),
      ativo: $('ocrDocAtivo').checked,
      campos: collectCampos(),
    });
  }

  function selectDoc(id) {
    state.docId = id || '';
    renderDocSelect();
    fillDocForm(pickById(state.docs, state.docId));
  }

  async function loadOcr(statusText) {
    const [docData, promptData] = await Promise.all([
      state.json('/api/admin/ocr-documentos'),
      state.json('/api/config/ocr'),
    ]);
    state.docs = docData.documentos || [];
    if (!pickById(state.docs, state.docId)) state.docId = state.docs[0]?.id || '';
    renderDocSelect();
    fillDocForm(pickById(state.docs, state.docId));
    $('ocrPrompt').value = promptData.prompt || '';
    $('ocrPromptForcado').value = promptData.promptForcado || '';
    if (statusText) setBox('editorOcrStatus', statusText, 'ok');
  }

  async function saveDoc() {
    const body = collectDocForm();
    if (!body.id || !body.tipoDocumento || !body.colecao) {
      return setBox('editorOcrStatus', 'Preencha ID, tipo do documento e colecao do Directus.', 'warn');
    }
    const currentId = state.docId;
    const url = currentId ? `/api/admin/ocr-documentos/${encodeURIComponent(currentId)}` : '/api/admin/ocr-documentos';
    const method = currentId ? 'PUT' : 'POST';
    setBox('editorOcrStatus', currentId ? 'Salvando documento OCR...' : 'Criando documento OCR...');
    const data = await state.json(url, { method, body: JSON.stringify(body) });
    state.docs = data.documentos || [];
    state.docId = nId(body.id || body.tipoDocumento);
    renderDocSelect();
    fillDocForm(pickById(state.docs, state.docId));
    setBox('editorOcrStatus', data.mensagem || 'Documento OCR salvo com sucesso.', 'ok');
  }

  async function deleteDoc() {
    if (!state.docId) return setBox('editorOcrStatus', 'Selecione um documento salvo para excluir.', 'warn');
    if (!window.confirm(`Excluir o documento OCR "${state.docId}"?`)) return;
    setBox('editorOcrStatus', 'Excluindo documento OCR...');
    const data = await state.json(`/api/admin/ocr-documentos/${encodeURIComponent(state.docId)}`, { method: 'DELETE' });
    state.docs = data.documentos || [];
    state.docId = state.docs[0]?.id || '';
    renderDocSelect();
    fillDocForm(pickById(state.docs, state.docId));
    setBox('editorOcrStatus', data.mensagem || 'Documento OCR removido.', 'ok');
  }

  async function savePrompts() {
    const body = { prompt: $('ocrPrompt').value.trim(), promptForcado: $('ocrPromptForcado').value.trim() };
    setBox('editorOcrStatus', 'Salvando prompts OCR...');
    await state.json('/api/config/ocr', { method: 'PUT', body: JSON.stringify(body) });
    setBox('editorOcrStatus', 'Prompts OCR salvos com sucesso.', 'ok');
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
    $('ocrDocSelect').addEventListener('change', () => selectDoc($('ocrDocSelect').value));
    $('ocrDocNovoBtn').addEventListener('click', () => selectDoc(''));
    $('ocrDocDuplicarBtn').addEventListener('click', () => fillDocForm(blankDoc({ ...collectDocForm(), id: `${nId($('ocrDocId').value || 'documento')}_copia`, tipoDocumento: `${nId($('ocrDocTipo').value || 'documento')}_copia`, rotulo: `${$('ocrDocRotulo').value.trim() || 'Novo documento'} copia` })));
    $('ocrCampoAddBtn').addEventListener('click', () => renderCampos([...collectCampos(), blankCampo({ id: `campo_${collectCampos().length + 1}` })]));
    $('ocrCamposList').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-remove-index]');
      if (!btn) return;
      const index = Number(btn.dataset.removeIndex);
      renderCampos(collectCampos().filter((_, itemIndex) => itemIndex !== index));
    });
    $('ocrDocSalvarBtn').addEventListener('click', () => saveDoc().catch((error) => setBox('editorOcrStatus', error.message || 'Falha ao salvar documento OCR.', 'warn')));
    $('ocrDocExcluirBtn').addEventListener('click', () => deleteDoc().catch((error) => setBox('editorOcrStatus', error.message || 'Falha ao excluir documento OCR.', 'warn')));
    $('ocrPromptSalvarBtn').addEventListener('click', () => savePrompts().catch((error) => setBox('editorOcrStatus', error.message || 'Falha ao salvar prompts OCR.', 'warn')));
  }

  async function start() {
    state.json = window.PhoneMonitorPage?.json?.bind(window.PhoneMonitorPage) || window.IagmxPainelAuth?.json;
    if (!state.json) return;
    bind();
    await Promise.all([
      loadJourneys('Catalogo de jornadas carregado.'),
      loadOcr('Configuracao OCR carregada.'),
    ]);
  }

  let started = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (started) return;
    started = true;
    start().catch((error) => {
      setBox('editorJornadaStatus', error.message || 'Falha ao carregar editor de jornadas.', 'warn');
      setBox('editorOcrStatus', error.message || 'Falha ao carregar editor OCR.', 'warn');
    });
  });
})();
