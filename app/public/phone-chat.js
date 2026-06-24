/**
 * Renderiza as conversas reais do /phone em formato de bolhas.
 * Mantem o chat principal limpo, com explicacoes sob demanda ao clicar na mensagem da IA.
 * Evita rerender destrutivo para preservar scroll e leitura durante a atualizacao automatica.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    view: 'chat',
    selectedByPhone: new Map(),
    lastSignature: '',
    scrollByPhone: new Map(),
  };

  function escapeHtml(valor) {
    return String(valor || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function fmtHora(ms) {
    if (!ms) return '-';
    return new Date(ms).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function resumoCard(data) {
    const atual = data?.estadoAtual || 'Sem atividade recente';
    const previsto = data?.resumoAtual?.previstoParaMs ? ` · previsto ${fmtHora(data.resumoAtual.previstoParaMs)}` : '';
    return `${atual}${previsto}`;
  }

  function dedupeLinhas(linhas) {
    const vistos = new Set();
    return linhas.filter((linha) => {
      const chave = [linha.horarioMs, linha.tipo, linha.status, linha.mensagem, linha.variante].join('|');
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  }

  function classeLinha(linha) {
    if (linha.variante === 'previsto') return 'pending';
    if (linha.tipo === 'atendimento_humano') return 'handoff';
    if (linha.variante === 'erp') return 'erp';
    if (linha.origem === 'cliente') return 'driver';
    if (linha.origem === 'ia' || linha.origem === 'empresa') return 'assistant';
    return 'system';
  }

  function tituloLinha(linha) {
    if (linha.variante === 'previsto') return 'GMX prevista';
    if (linha.tipo === 'atendimento_humano') return 'Atendimento humano';
    if (linha.variante === 'erp') return 'Banco de dados';
    if (linha.origem === 'cliente') return 'Motorista';
    if (linha.origem === 'empresa') return 'GMX';
    if (linha.origem === 'ia') return 'IA GMX';
    return 'Sistema';
  }

  function legendaLinha(linha) {
    if (linha.variante === 'previsto') {
      return `Vai ser enviado ${fmtHora(linha.previstoParaMs)}`;
    }
    if (linha.tipo === 'atendimento_humano') {
      return 'Escalado para humano';
    }
    if (linha.variante === 'erp') {
      return 'Banco atualizado';
    }
    if (String(linha.status || '').toLowerCase().includes('erro')) {
      return 'Atencao';
    }
    return '';
  }

  function linhasDoChat(data) {
    return dedupeLinhas([...(data?.linhas || [])])
      .filter((linha) => {
        if (linha.variante === 'previsto' || linha.variante === 'erp') return true;
        return linha.origem === 'cliente' || linha.origem === 'ia' || linha.origem === 'empresa';
      })
      .sort((a, b) => a.horarioMs - b.horarioMs);
  }

  function chaveLinha(linha) {
    return [linha.horarioMs, linha.origem, linha.tipo, linha.status, linha.mensagem].join('|');
  }

  function assinaturaSnapshot(snapshot) {
    const contatos = new Map(snapshot.contactsByPhone || []);
    const map = new Map(snapshot.dataByPhone || []);
    return JSON.stringify((snapshot.phones || []).map((phone) => {
      const data = map.get(phone) || {};
      const contato = contatos.get(phone) || {};
      return {
        phone,
        active: phone === snapshot.activePhone,
        nome: contato.nome || '',
        local: contato.local || '',
        resumo: resumoCard(data),
        selecionada: state.selectedByPhone.get(phone) || '',
        linhas: linhasDoChat(data).map((linha) => ({
          key: chaveLinha(linha),
          previsto: linha.previstoParaMs || 0,
          detalhe: linha.detalhe?.resumo || '',
        })),
      };
    }));
  }

  function salvarScrollAtual() {
    document.querySelectorAll('.monitor-messages').forEach((el) => {
      const phone = el.dataset.phone;
      if (!phone) return;
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      state.scrollByPhone.set(phone, {
        stickBottom: distanceToBottom < 28,
        scrollTop: el.scrollTop,
      });
    });
  }

  function restaurarScroll() {
    document.querySelectorAll('.monitor-messages').forEach((el) => {
      const phone = el.dataset.phone;
      const saved = phone ? state.scrollByPhone.get(phone) : null;
      if (!saved) return;
      if (saved.stickBottom) {
        el.scrollTop = el.scrollHeight;
        return;
      }
      el.scrollTop = saved.scrollTop;
    });
  }

  function renderLinha(linha) {
    const legenda = legendaLinha(linha);
    const badge = legenda ? `<div class="chat-inline-note">${escapeHtml(legenda)}</div>` : '';
    const tags = [];
    if (linha.variante === 'previsto') tags.push('previsto');
    if (linha.variante === 'erp') tags.push('ERP');
    if (linha.tipo === 'atendimento_humano') tags.push('humano');
    if (linha.detalhe) tags.push('clique para ver motivo');
    const bubbleAttrs = linha.detalhe
      ? ` role="button" tabindex="0" data-open-detail="${escapeHtml(chaveLinha(linha))}"`
      : '';
    return `
      <div class="message-row ${classeLinha(linha)}">
        <div class="bubble ${classeLinha(linha)}${linha.variante === 'previsto' ? ' selected' : ''}${linha.detalhe ? ' clickable' : ''}"${bubbleAttrs}>
          <div class="bubble-head">
            <span>${escapeHtml(tituloLinha(linha))}</span>
            <span>${escapeHtml(fmtHora(linha.horarioMs))}</span>
          </div>
          ${badge}
          <div class="bubble-body">${escapeHtml(linha.mensagem)}</div>
          ${tags.length ? `<div class="bubble-tags">${tags.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        </div>
      </div>`;
  }

  function resumoContato(phone, contato, data, activePhone) {
    const partes = [phone];
    if (contato?.local) partes.push(contato.local);
    if (phone === activePhone) partes.push('em foco');
    if (contato?.precisaAtendimento) partes.push('precisa ajuda');
    else if (contato?.iaPausada) partes.push('IA pausada');
    if (data?.resumoAtual?.previstoParaMs) partes.push(`envio ${fmtHora(data.resumoAtual.previstoParaMs)}`);
    return partes.join(' · ');
  }

  function renderCard(phone, data, activePhone, contato) {
    const linhas = linhasDoChat(data).slice(-(phone === activePhone ? 28 : 12));
    const detailMap = new Map(linhas.filter((linha) => linha.detalhe).map((linha) => [chaveLinha(linha), linha]));
    const selectedKey = state.selectedByPhone.get(phone);
    const selected = (selectedKey && detailMap.get(selectedKey)) || linhas.find((linha) => linha.detalhe) || null;
    if (selected?.detalhe) state.selectedByPhone.set(phone, chaveLinha(selected));
    const body = linhas.length
      ? linhas.map(renderLinha).join('')
      : '<div class="chat-monitor-empty">Nenhuma atividade recente para este telefone.</div>';
    const titulo = contato?.nome || phone;
    return `
      <section class="chat-card${phone === activePhone ? ' active' : ''}">
        <div class="chat-card-head">
          <div>
            <div class="table-title">${escapeHtml(titulo)}</div>
            <div class="muted">${escapeHtml(resumoContato(phone, contato, data, activePhone))}</div>
            <div class="contact-inline-meta">${escapeHtml(resumoCard(data))}</div>
          </div>
          <button type="button" class="chat-focus-btn" data-focus-phone="${escapeHtml(phone)}">Colocar em foco</button>
        </div>
        <div class="messages monitor-messages" data-phone="${escapeHtml(phone)}">${body}</div>
        <div class="chat-audit-panel">
          ${selected?.detalhe ? renderDetalhe(selected) : '<div class="chat-audit-empty">Clique em uma mensagem da IA para ver o motivo do envio.</div>'}
        </div>
      </section>`;
  }

  function renderDetalhe(linha) {
    const detalhe = linha?.detalhe;
    if (!detalhe) return '';
    const itens = (detalhe.itens || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    const revisao = detalhe.revisao ? `<div class="chat-audit-summary">${escapeHtml(detalhe.revisao)}</div>` : '';
    return `
      <div class="chat-audit-title">${escapeHtml(detalhe.titulo || 'Motivo da resposta')}</div>
      <div class="chat-audit-meta">Mensagem enviada ${escapeHtml(fmtHora(linha.horarioMs))}</div>
      <div class="chat-audit-summary">${escapeHtml(detalhe.resumo || '')}</div>
      ${revisao}
      ${itens ? `<ul class="chat-audit-list">${itens}</ul>` : ''}
    `;
  }

  function render() {
    const root = $('chatCards');
    if (!root || !window.PhoneMonitorPage?.getSnapshot) return;
    const snapshot = window.PhoneMonitorPage.getSnapshot();
    const signature = assinaturaSnapshot(snapshot);
    if (!snapshot.phones.length) {
      state.lastSignature = '';
      root.innerHTML = '<div class="chat-monitor-empty">Abra um ou mais contatos vindos do ERP para ver as conversas reais.</div>';
      return;
    }
    if (signature === state.lastSignature) return;
    salvarScrollAtual();
    const map = new Map(snapshot.dataByPhone || []);
    const contatos = new Map(snapshot.contactsByPhone || []);
    root.innerHTML = snapshot.phones.map((phone) => renderCard(phone, map.get(phone), snapshot.activePhone, contatos.get(phone))).join('');
    state.lastSignature = signature;
    restaurarScroll();
  }

  function renderView() {
    const chatSection = $('chatMonitorSection');
    const eventsSection = $('eventsMonitorSection');
    if (chatSection) chatSection.hidden = state.view !== 'chat';
    if (eventsSection) eventsSection.hidden = state.view !== 'events';
    document.querySelectorAll('[data-monitor-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.monitorView === state.view);
    });
  }

  function bind() {
    document.querySelectorAll('[data-monitor-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.view = btn.dataset.monitorView || 'chat';
        renderView();
      });
    });
    $('chatCards')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-focus-phone]');
      if (btn) {
        window.PhoneMonitorPage?.abrirTelefone?.(btn.dataset.focusPhone || '');
        return;
      }
      const detailBtn = event.target.closest('[data-open-detail]');
      if (!detailBtn) return;
      const card = detailBtn.closest('.chat-card');
      const phone = card?.querySelector('.monitor-messages')?.dataset.phone;
      if (!phone) return;
      state.selectedByPhone.set(phone, detailBtn.dataset.openDetail || '');
      state.lastSignature = '';
      render();
    });
    $('chatCards')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const detailBtn = event.target.closest('[data-open-detail]');
      if (!detailBtn) return;
      event.preventDefault();
      detailBtn.click();
    });
  }

  let started = false;
  window.addEventListener('phone-monitor-ready', () => {
    if (started) return;
    started = true;
    bind();
    renderView();
    render();
  });
  window.addEventListener('phone-monitor-updated', render);
})();
