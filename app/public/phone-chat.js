/**
 * Renderiza as conversas reais do /phone em formato de bolhas.
 * Mostra mensagens, envios previstos e eventos de ERP na mesma timeline.
 * Mantem a tabela original como visao secundaria para auditoria detalhada.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { view: 'chat' };

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
    if (linha.variante === 'erp') return 'erp';
    if (linha.origem === 'cliente') return 'driver';
    if (linha.origem === 'ia' || linha.origem === 'empresa') return 'assistant';
    return 'system';
  }

  function tituloLinha(linha) {
    if (linha.variante === 'previsto') return 'GMX prevista';
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
    if (linha.variante === 'erp') {
      return 'ERP confirmado';
    }
    if (linha.tipo === 'justificativa_ia') {
      return 'Motivo da resposta';
    }
    if (String(linha.status || '').toLowerCase().includes('erro')) {
      return 'Atencao';
    }
    return '';
  }

  function renderLinha(linha) {
    const legenda = legendaLinha(linha);
    const badge = legenda ? `<div class="chat-inline-note">${escapeHtml(legenda)}</div>` : '';
    const tags = [linha.tipo, linha.status].filter(Boolean).slice(0, 2).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join('');
    return `
      <div class="message-row ${classeLinha(linha)}">
        <div class="bubble ${classeLinha(linha)}${linha.variante === 'previsto' ? ' selected' : ''}">
          <div class="bubble-head">
            <span>${escapeHtml(tituloLinha(linha))}</span>
            <span>${escapeHtml(fmtHora(linha.horarioMs))}</span>
          </div>
          ${badge}
          <div class="bubble-body">${escapeHtml(linha.mensagem)}</div>
          ${tags ? `<div class="bubble-tags">${tags}</div>` : ''}
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
    const linhas = dedupeLinhas([...(data?.linhas || [])])
      .sort((a, b) => a.horarioMs - b.horarioMs)
      .slice(-(phone === activePhone ? 18 : 10));
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
        <div class="messages monitor-messages">${body}</div>
      </section>`;
  }

  function render() {
    const root = $('chatCards');
    if (!root || !window.PhoneMonitorPage?.getSnapshot) return;
    const snapshot = window.PhoneMonitorPage.getSnapshot();
    if (!snapshot.phones.length) {
      root.innerHTML = '<div class="chat-monitor-empty">Abra um ou mais contatos vindos do ERP para ver as conversas reais.</div>';
      return;
    }
    const map = new Map(snapshot.dataByPhone || []);
    const contatos = new Map(snapshot.contactsByPhone || []);
    root.innerHTML = snapshot.phones.map((phone) => renderCard(phone, map.get(phone), snapshot.activePhone, contatos.get(phone))).join('');
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
      if (!btn) return;
      window.PhoneMonitorPage?.abrirTelefone?.(btn.dataset.focusPhone || '');
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
