/**
 * Monitor principal multi-contato do /phone.
 * Agrega varios telefones no frontend e mantem um contato em foco para as acoes admin.
 * Aplica filtros locais para evitar novas telas ou fluxos paralelos.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const els = ['phoneInput', 'addPhoneBtn', 'refreshBtn', 'tableBody', 'phoneSuggestions', 'selectedPhones', 'clearPhonesBtn', 'filterPhone', 'filterOrigin', 'filterStatus', 'filterType', 'filterText'].reduce((acc, id) => ({ ...acc, [id]: $(id) }), {});
  const state = { activePhone: '', phones: [], lines: [], dataByPhone: new Map(), contactsByPhone: new Map(), pollTimer: null, contexto: null };

  const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');
  const telefoneValido = (valor) => soDigitos(valor).length >= 10 && soDigitos(valor).length <= 15;
  const escapeHtml = (valor) => String(valor || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  const classeOrigem = (origem) => ({ cliente: 'cliente', ia: 'ia', empresa: 'empresa' }[origem] || 'sistema');
  const classeStatus = (status) => {
    const texto = String(status || '').toLowerCase();
    if (texto.includes('erro')) return 'error';
    if (texto.includes('humano') || texto.includes('pausada')) return 'handoff';
    if (texto.includes('enviado') || texto.includes('recebido') || texto.includes('manual')) return 'sent';
    if (texto.includes('esperando') || texto.includes('digitando') || texto.includes('fila')) return 'waiting';
    return '';
  };
  const fmtHorario = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR') : '-');
  const contatoMeta = (phone) => state.contactsByPhone.get(phone) || null;
  const rotuloContato = (phone) => contatoMeta(phone)?.nome || phone;
  const descricaoContato = (phone) => contatoMeta(phone)?.label || phone;

  function urlMonitor(phones) {
    const lista = phones.filter(telefoneValido);
    const atual = new URL(window.location.href);
    const destino = new URL(window.location.href);
    destino.pathname = atual.pathname === '/phone.html' ? '/phone.html' : '/phone';
    destino.searchParams.delete('phone');
    destino.searchParams.delete('phones');
    if (!lista.length) return `${destino.pathname}${destino.search}`;
    if (lista.length === 1) {
      destino.searchParams.set('phone', lista[0]);
      return `${destino.pathname}${destino.search}`;
    }
    destino.searchParams.set('phones', lista.join(','));
    return `${destino.pathname}${destino.search}`;
  }

  function atualizarUrl() {
    const alvo = urlMonitor(state.phones);
    history.replaceState({}, '', alvo);
  }

  function telefoneFoco() {
    return state.activePhone || state.phones[0] || soDigitos(els.phoneInput.value);
  }

  function garantirFoco() {
    if (!state.phones.length) state.activePhone = '';
    else if (!state.phones.includes(state.activePhone)) state.activePhone = state.phones[0];
  }

  function renderSelecao() {
    if (!state.phones.length) {
      els.selectedPhones.innerHTML = '<span class="empty-inline">Nenhum contato selecionado.</span>';
      return;
    }
    els.selectedPhones.innerHTML = state.phones.map((phone) => `
      <div class="chip-item${phone === state.activePhone ? ' active' : ''}">
        <button type="button" class="chip-main" data-focus="${phone}" title="${escapeHtml(descricaoContato(phone))}">${escapeHtml(rotuloContato(phone))}${phone === state.activePhone ? ' (foco)' : ''}</button>
        <button type="button" class="chip-remove" data-remove="${phone}" aria-label="Remover ${phone}">x</button>
      </div>
    `).join('');
  }

  function atualizarFiltroTelefones() {
    const atual = els.filterPhone.value;
    const options = ['<option value="">Todos os contatos</option>'].concat(state.phones.map((phone) => `<option value="${phone}">${escapeHtml(rotuloContato(phone))}</option>`));
    els.filterPhone.innerHTML = options.join('');
    els.filterPhone.value = state.phones.includes(atual) ? atual : '';
  }

  function linhasFiltradas() {
    const filtros = {
      phone: els.filterPhone.value,
      origin: els.filterOrigin.value,
      status: els.filterStatus.value.toLowerCase(),
      type: els.filterType.value.toLowerCase(),
      text: els.filterText.value.trim().toLowerCase(),
    };
    return state.lines.filter((linha) => {
      if (filtros.phone && linha.phone !== filtros.phone) return false;
      if (filtros.origin === 'cliente' && linha.origem !== 'cliente') return false;
      if (filtros.origin === 'gmx' && linha.origem === 'cliente') return false;
      if (filtros.status && !String(linha.status || '').toLowerCase().includes(filtros.status)) return false;
      if (filtros.type && !String(linha.tipo || '').toLowerCase().includes(filtros.type)) return false;
      if (filtros.text && !`${linha.mensagem} ${linha.tipo} ${linha.status}`.toLowerCase().includes(filtros.text)) return false;
      return true;
    });
  }

  function renderLinhas() {
    const linhas = linhasFiltradas();
    if (!linhas.length) {
      const vazio = state.phones.length ? 'Nenhuma atividade recente para os filtros aplicados.' : 'Informe um ou mais telefones para abrir o monitor.';
      els.tableBody.innerHTML = `<tr><td colspan="6" class="empty">${vazio}</td></tr>`;
      return;
    }
    els.tableBody.innerHTML = linhas.map((linha) => `
      <tr class="row-${linha.origem}${linha.tipo === 'atendimento_humano' ? ' row-handoff' : ''}">
        <td>${fmtHorario(linha.horarioMs)}</td>
        <td>${escapeHtml(linha.phone)}</td>
        <td><span class="badge ${classeOrigem(linha.origem)}">${escapeHtml(linha.origem)}</span></td>
        <td class="message">${escapeHtml(linha.mensagem)}</td>
        <td><span class="type-muted">${escapeHtml(linha.tipo)}</span></td>
        <td><span class="status ${classeStatus(linha.status)}">${escapeHtml(linha.status)}</span></td>
      </tr>
    `).join('');
  }

  function atualizarTela() {
    garantirFoco();
    renderSelecao();
    atualizarFiltroTelefones();
    renderLinhas();
    atualizarUrl();
    window.dispatchEvent(new CustomEvent('phone-monitor-updated'));
  }

  function adicionarTelefone(valor) {
    const telefone = soDigitos(valor);
    if (!telefoneValido(telefone) || state.phones.includes(telefone)) return false;
    state.phones = [...state.phones, telefone];
    state.activePhone = telefone;
    els.phoneInput.value = '';
    atualizarTela();
    return true;
  }

  function focarOuAdicionarTelefone(valor) {
    const telefone = soDigitos(valor);
    if (!telefoneValido(telefone)) return false;
    if (!state.phones.includes(telefone)) state.phones = [...state.phones, telefone];
    state.activePhone = telefone;
    els.phoneInput.value = '';
    atualizarTela();
    return true;
  }

  function removerTelefone(valor) {
    state.phones = state.phones.filter((phone) => phone !== valor);
    state.dataByPhone.delete(valor);
    state.lines = state.lines.filter((linha) => linha.phone !== valor);
    atualizarTela();
  }

  async function carregarSugestoes() {
    try {
      const data = await IagmxPainelAuth.json('/api/monitor/contatos-erp');
      state.contactsByPhone = new Map((data.contatos || []).map((item) => [item.telefone, item]));
      els.phoneSuggestions.innerHTML = (data.contatos || []).map((item) => `<option value="${item.telefone}">${escapeHtml(item.label || item.nome || item.telefone)}</option>`).join('');
    } catch {
      try {
        const data = await IagmxPainelAuth.json('/api/monitor/telefones-ativos');
        els.phoneSuggestions.innerHTML = (data.telefones || []).map((phone) => `<option value="${phone}"></option>`).join('');
      } catch {}
    }
  }

  async function carregar(forcePhones) {
    const phones = (forcePhones || state.phones).filter(telefoneValido);
    if (!phones.length) {
      state.lines = [];
      state.dataByPhone.clear();
      atualizarTela();
      return;
    }
    state.phones = [...new Set(phones)];
    garantirFoco();
    els.refreshBtn.disabled = true;
    try {
      const resultados = await Promise.allSettled(state.phones.map((telefone) => IagmxPainelAuth.json(`/api/monitor/telefone?telefone=${encodeURIComponent(telefone)}`)));
      const erros = [];
      const linhas = [];
      state.dataByPhone.clear();
      resultados.forEach((resultado, index) => {
        const telefone = state.phones[index];
        if (resultado.status === 'fulfilled') {
          state.dataByPhone.set(telefone, resultado.value);
          linhas.push(...(resultado.value.linhas || []));
        } else {
          erros.push(`${telefone}: ${resultado.reason?.message || 'falha ao carregar'}`);
        }
      });
      state.lines = linhas.sort((a, b) => b.horarioMs - a.horarioMs).slice(0, 240);
      atualizarTela();
      if (erros.length && !state.lines.length) {
        els.tableBody.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(erros.join(' | '))}</td></tr>`;
      }
    } finally {
      els.refreshBtn.disabled = false;
    }
  }

  function iniciarPoll() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (state.phones.length) carregar([...state.phones]);
    }, 2000);
  }

  function lerTelefonesIniciais() {
    const match = window.location.pathname.match(/^\/phone=([0-9+()\-\s]+)$/);
    const params = new URLSearchParams(window.location.search);
    const lista = [match ? match[1] : '', params.get('phone') || '', ...(params.get('phones') || '').split(',')];
    return [...new Set(lista.map(soDigitos).filter(telefoneValido))];
  }

  els.addPhoneBtn.addEventListener('click', () => {
    if (focarOuAdicionarTelefone(els.phoneInput.value)) return carregar([...state.phones]);
    if (state.phones.length) carregar([...state.phones]);
    else atualizarTela();
  });
  els.refreshBtn.addEventListener('click', () => carregar([...state.phones]));
  els.clearPhonesBtn.addEventListener('click', () => {
    state.phones = [];
    state.activePhone = '';
    state.lines = [];
    state.dataByPhone.clear();
    atualizarTela();
  });
  els.selectedPhones.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.remove) return removerTelefone(btn.dataset.remove);
    if (btn.dataset.focus) {
      state.activePhone = btn.dataset.focus;
      atualizarTela();
    }
  });
  els.phoneInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (focarOuAdicionarTelefone(els.phoneInput.value)) carregar([...state.phones]);
    }
  });
  [els.filterPhone, els.filterOrigin, els.filterStatus, els.filterType].forEach((el) => el.addEventListener('change', () => {
    if (el === els.filterPhone && state.phones.includes(els.filterPhone.value)) state.activePhone = els.filterPhone.value;
    atualizarTela();
  }));
  els.filterText.addEventListener('input', renderLinhas);

  window.PhoneMonitorPage = {
    getPhone: () => telefoneFoco(),
    getPhones: () => [...state.phones],
    getContext: () => state.contexto,
    getSnapshot() {
      return {
        activePhone: state.activePhone,
        phones: [...state.phones],
        lines: [...state.lines],
        dataByPhone: [...state.dataByPhone.entries()].map(([phone, data]) => [phone, data]),
        contactsByPhone: [...state.contactsByPhone.entries()],
      };
    },
    setPhone(valor) {
      els.phoneInput.value = soDigitos(valor);
    },
    recarregar: () => carregar([...state.phones]),
    abrirTelefone(valor) {
      adicionarTelefone(valor);
      return carregar([...state.phones]);
    },
    json(url, init) {
      return IagmxPainelAuth.json(url, init);
    },
  };

  IagmxPainelAuth.boot({
    requiredBlock: 'painel_etapas',
    onReady(contexto) {
      state.contexto = contexto;
      state.phones = lerTelefonesIniciais();
      garantirFoco();
      atualizarTela();
      carregarSugestoes();
      if (state.phones.length) carregar([...state.phones]);
      iniciarPoll();
      window.dispatchEvent(new CustomEvent('phone-monitor-ready', { detail: { telefone: telefoneFoco() || '' } }));
    },
  });
})();
