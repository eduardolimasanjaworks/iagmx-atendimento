(function () {
  const BLOCO_LABELS = {
    resumo_operacional: 'Resumo operacional',
    comando_rapido: 'Comando rápido',
    prompt_principal: 'Texto principal',
    prompt_ocr: 'Leitura de documentos',
    estilo_formatacao: 'Estilo e formatação',
    mensagens_fluxo: 'Mensagens operacionais',
    operacao_avancada: 'Ajustes avançados',
    editor_visual: 'Editor visual',
    painel_etapas: 'Painel de etapas',
    conexao_numero_ia: 'Conexão do número da i.a',
  };

  const BLOCO_DESCRICOES = {
    resumo_operacional: 'Mostra os indicadores gerais e a saúde operacional do painel.',
    comando_rapido: 'Libera o atalho para encaixar ajustes rápidos nos textos da i.a.',
    prompt_principal: 'Permite ver o texto principal que guia o comportamento da i.a.',
    prompt_ocr: 'Permite ver as regras usadas na leitura de documentos e imagens.',
    estilo_formatacao: 'Libera os ajustes de tom, estilo e formato das respostas.',
    mensagens_fluxo: 'Permite ver e ajustar mensagens prontas usadas nos fluxos operacionais.',
    operacao_avancada: 'Libera ajustes mais sensíveis de envio, tempo e recarga do processo.',
    editor_visual: 'Mostra a tela visual com simulações, histórico recente e os textos usados para alimentar esse painel.',
    painel_etapas: 'Mostra as etapas internas percorridas por cada conversa recente.',
    conexao_numero_ia: 'Mostra o status do número da i.a e o acesso ao QR code da conexão local.',
  };

  const BLOCO_PREVIAS = {
    resumo_operacional: {
      onde: 'Home do painel',
      amostra: ['Build', 'Prompt principal', 'Prompt OCR', 'Servicos'],
    },
    comando_rapido: {
      onde: 'Home do painel',
      amostra: ['Instrucao direta', 'Destino da instrucao', 'Inserir no editor'],
    },
    prompt_principal: {
      onde: 'Home do painel',
      amostra: ['Prompt principal', 'Salvar prompt principal', 'Voltar ao texto carregado'],
    },
    prompt_ocr: {
      onde: 'Home do painel',
      amostra: ['Prompt OCR', 'Salvar prompt OCR', 'Restaurar padrao'],
    },
    estilo_formatacao: {
      onde: 'Home do painel',
      amostra: ['Camada humana', 'Instrucao de formatacao', 'Salvar estilo e formatacao'],
    },
    mensagens_fluxo: {
      onde: 'Home do painel',
      amostra: ['Mensagens operacionais dos fluxos', 'Filtrar mensagens', 'Salvar mensagens de fluxo'],
    },
    operacao_avancada: {
      onde: 'Home do painel',
      amostra: ['Humanizacao', 'Reatividade', 'Deploy', 'Recarregar processo agora'],
    },
    editor_visual: {
      onde: 'Botao no topo e tela propria',
      amostra: ['Editor visual', 'Chats simulados', 'Historico recente', 'Visao consolidada'],
    },
    painel_etapas: {
      onde: 'Botao no topo e tela propria',
      amostra: ['Painel de etapas das conversas', 'Etapas internas', 'Conversa(s) recente(s)', 'Atualizar'],
    },
    conexao_numero_ia: {
      onde: 'Tela propria',
      amostra: ['Conectar numero da i.a', 'Gerar QR Code', 'Atualizar QR', 'Reconectar'],
    },
  };

  const state = {
    contexto: null,
    overlay: null,
  };

  function style() {
    if (document.getElementById('painel-auth-style')) return;
    const css = document.createElement('style');
    css.id = 'painel-auth-style';
    css.textContent = `
      .painel-auth-overlay{position:fixed;inset:0;background:rgba(15,23,42,.78);display:flex;align-items:center;justify-content:center;z-index:99999;padding:1rem;backdrop-filter:blur(4px)}
      .painel-auth-card{width:min(100%,420px);background:#fff;border-radius:18px;padding:1.2rem;border:1px solid rgba(148,163,184,.35);box-shadow:0 20px 50px rgba(0,0,0,.25);color:#132033}
      .painel-auth-card h2{font-size:1.15rem;margin-bottom:.35rem}
      .painel-auth-card p{font-size:.92rem;color:#62748b;margin-bottom:1rem}
      .painel-auth-card label{display:block;font-size:.82rem;font-weight:600;margin:.7rem 0 .35rem}
      .painel-auth-card input{width:100%;border:1px solid #d7e0ee;border-radius:12px;padding:.82rem .9rem;background:#f8fbff}
      .painel-auth-actions{display:flex;gap:.6rem;align-items:center;margin-top:1rem}
      .painel-auth-error{color:#b91c1c;font-size:.82rem;min-height:1.1rem;margin-top:.55rem}
      .painel-toolbar-user{display:inline-flex;align-items:center;gap:.5rem;padding:.6rem .8rem;border:1px solid rgba(148,163,184,.35);border-radius:999px;background:rgba(255,255,255,.92);font-size:.82rem;color:#475569}
      .painel-toolbar-user strong{color:#0f172a}
      .painel-oculto{display:none !important}
      .painel-admin-stack{display:grid;gap:1rem;margin-bottom:1rem}
      .painel-admin-card{background:rgba(255,255,255,.94);border:1px solid #d7e0ee;border-radius:16px;padding:1rem 1.05rem;box-shadow:0 12px 30px rgba(15,23,42,.07);margin-bottom:1rem}
      .painel-admin-lista{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.7rem;margin-top:.85rem}
      .painel-admin-item{display:flex;gap:.55rem;align-items:flex-start;padding:.7rem .75rem;border:1px solid #d7e0ee;border-radius:12px;background:#f8fbff}
      .painel-admin-item input{margin-top:.15rem}
      .painel-admin-item strong{display:block;font-size:.88rem;color:#132033}
      .painel-admin-item small{display:block;color:#64748b;font-size:.76rem;line-height:1.45;margin-top:.18rem}
      .painel-admin-onde{display:inline-flex;align-items:center;margin-top:.45rem;padding:.2rem .5rem;border-radius:999px;background:#e8f0fe;color:#1d4ed8;font-size:.72rem;font-weight:600}
      .painel-admin-preview{margin-top:.6rem;padding:.62rem .68rem;border:1px dashed #c7d7ee;border-radius:12px;background:rgba(255,255,255,.8)}
      .painel-admin-preview-label{display:block;color:#475569;font-size:.72rem;font-weight:700;letter-spacing:.02em;text-transform:uppercase;margin-bottom:.35rem}
      .painel-admin-preview-chips{display:flex;flex-wrap:wrap;gap:.35rem}
      .painel-admin-preview-chip{display:inline-flex;align-items:center;padding:.28rem .48rem;border-radius:999px;background:#fff;border:1px solid #d7e0ee;color:#132033;font-size:.72rem}
      .painel-admin-resumo{margin-top:.75rem;color:#64748b;font-size:.8rem}
      .painel-admin-reset-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(260px,1fr);gap:.9rem;margin-top:.85rem}
      .painel-admin-reset-box{padding:.85rem .9rem;border:1px solid #d7e0ee;border-radius:14px;background:#f8fbff}
      .painel-admin-reset-box label{display:block;font-size:.8rem;font-weight:700;color:#132033;margin-bottom:.35rem}
      .painel-admin-reset-box input{width:100%;border:1px solid #d7e0ee;border-radius:12px;padding:.82rem .9rem;background:#fff}
      .painel-admin-reset-help{color:#64748b;font-size:.77rem;line-height:1.5;margin-top:.38rem}
      .painel-admin-reset-actions{display:flex;gap:.55rem;flex-wrap:wrap;align-items:center;margin-top:.8rem}
      .painel-admin-reset-result{margin-top:.75rem;padding:.72rem .8rem;border-radius:12px;background:#fff;border:1px solid #d7e0ee;color:#334155;font-size:.78rem;line-height:1.55;white-space:pre-line}
      .painel-bloqueado{max-width:760px;margin:2rem auto;background:rgba(255,255,255,.94);border:1px solid #d7e0ee;border-radius:18px;padding:1.2rem;box-shadow:0 12px 30px rgba(15,23,42,.07)}
    `;
    document.head.appendChild(css);
  }

  async function json(url, opts) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opts && opts.headers ? opts.headers : {}) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Falha de autenticação');
    return data;
  }

  function ensureOverlay() {
    if (state.overlay) return state.overlay;
    style();
    const overlay = document.createElement('div');
    overlay.className = 'painel-auth-overlay';
    overlay.innerHTML = `
      <div class="painel-auth-card">
        <h2>Acesso ao painel</h2>
        <p>Entre com seu e-mail e senha para acessar o iagmx</p>
        <form id="painelAuthForm">
          <label for="painelAuthEmail">E-mail</label>
          <input id="painelAuthEmail" type="email" autocomplete="username" />
          <label for="painelAuthSenha">Senha</label>
          <input id="painelAuthSenha" type="password" autocomplete="current-password" />
          <div class="painel-auth-error" id="painelAuthErro"></div>
          <div class="painel-auth-actions">
            <button type="submit" style="border:none;border-radius:12px;padding:.82rem 1rem;background:#2563eb;color:#fff;font-weight:600;cursor:pointer">Entrar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('#painelAuthForm');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const erroEl = overlay.querySelector('#painelAuthErro');
      erroEl.textContent = '';
      try {
        const email = overlay.querySelector('#painelAuthEmail').value.trim();
        const senha = overlay.querySelector('#painelAuthSenha').value;
        await json('/api/painel/login', {
          method: 'POST',
          body: JSON.stringify({ email, senha }),
        });
        overlay.remove();
        state.overlay = null;
        await carregarContexto();
        if (window.IagmxPainelAuth && typeof window.IagmxPainelAuth._onReady === 'function') {
          window.IagmxPainelAuth._onReady(state.contexto);
        }
      } catch (error) {
        erroEl.textContent = error.message || 'Falha ao entrar';
      }
    });
    state.overlay = overlay;
    return overlay;
  }

  async function carregarContexto() {
    state.contexto = await json('/api/painel/eu');
    if (!state.contexto || !state.contexto.autenticado || !state.contexto.usuario) {
      throw new Error('Nao autenticado');
    }
    return state.contexto;
  }

  function appendUserBadge(contexto) {
    const topActions = document.querySelector('.top-actions, header > div:last-child, .top-links');
    if (!topActions || document.getElementById('painelUserBadge')) return;
    const wrap = document.createElement('div');
    wrap.id = 'painelUserBadge';
    wrap.className = 'painel-toolbar-user';
    wrap.innerHTML = `<span><strong>${contexto.usuario.nome}</strong> · ${contexto.usuario.perfil}</span>`;
    const sair = document.createElement('button');
    sair.type = 'button';
    sair.textContent = 'Sair';
    sair.style.border = 'none';
    sair.style.background = 'transparent';
    sair.style.color = '#2563eb';
    sair.style.cursor = 'pointer';
    sair.addEventListener('click', async () => {
      await json('/api/painel/logout', { method: 'POST' }).catch(() => undefined);
      window.location.reload();
    });
    wrap.appendChild(sair);
    topActions.appendChild(wrap);
  }

  function esconderSeEquipe(contexto, bloco, elemento) {
    if (!elemento) return;
    if (contexto.usuario.perfil === 'admin') return;
    if (!contexto.equipe.blocosVisiveis.includes(bloco)) {
      elemento.classList.add('painel-oculto');
    }
  }

  function bloquearPagina(mensagem) {
    document.body.innerHTML = `
      <div class="painel-bloqueado">
        <h1 style="font-size:1.35rem;margin-bottom:.45rem">Acesso restrito</h1>
        <p style="color:#64748b">${mensagem}</p>
      </div>
    `;
  }

  function resumoVisibilidade(blocosVisiveis, total) {
    if (!Array.isArray(blocosVisiveis) || !blocosVisiveis.length) {
      return 'Hoje o login equipe nao enxerga nenhum bloco liberado.';
    }
    return `Hoje o login equipe enxerga ${blocosVisiveis.length} de ${total} blocos disponiveis.`;
  }

  function normalizarTelefone(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  async function renderAdminEquipeCard(contexto) {
    if (contexto.usuario.perfil !== 'admin') return;
    const alvo = document.getElementById('adminEquipeAccess');
    if (!alvo) return;
    const dados = await json('/api/painel/visibilidade-equipe');
    alvo.className = 'painel-admin-stack';
    alvo.innerHTML = `
      <div class="painel-admin-card">
        <div style="display:flex;justify-content:space-between;gap:.8rem;align-items:flex-start;flex-wrap:wrap">
          <div>
            <h2 style="font-size:1rem;margin-bottom:.2rem">Visibilidade do login equipe</h2>
            <p style="color:#64748b;font-size:.84rem">Escolha o que o perfil equipe@gmx.com consegue ver ou até saber que existe</p>
          </div>
          <div style="display:flex;gap:.55rem;flex-wrap:wrap">
            <button type="button" id="restaurarEquipePadrao" style="border:1px solid #d7e0ee;border-radius:12px;padding:.72rem 1rem;background:#fff;color:#132033;font-weight:600;cursor:pointer">Voltar ao padrao</button>
            <button type="button" id="salvarEquipeVisibilidade" style="border:none;border-radius:12px;padding:.72rem 1rem;background:#2563eb;color:#fff;font-weight:600;cursor:pointer">Salvar visibilidade</button>
          </div>
        </div>
        <div class="painel-admin-resumo" id="painelEquipeResumo">${resumoVisibilidade(dados.config.blocosVisiveis, dados.opcoes.length)}</div>
        <div class="painel-admin-lista">
          ${dados.opcoes.map((bloco) => `
            <label class="painel-admin-item">
              <input type="checkbox" data-bloco-equipe="${bloco}" ${dados.config.blocosVisiveis.includes(bloco) ? 'checked' : ''} />
              <span>
                <strong>${BLOCO_LABELS[bloco] || bloco}</strong>
                <small>${BLOCO_DESCRICOES[bloco] || 'Bloco operacional deste painel.'}</small>
                <span class="painel-admin-onde">${BLOCO_PREVIAS[bloco]?.onde || 'Area do painel'}</span>
                <div class="painel-admin-preview">
                  <span class="painel-admin-preview-label">Previa rapida</span>
                  <div class="painel-admin-preview-chips">
                    ${(BLOCO_PREVIAS[bloco]?.amostra || ['Bloco operacional']).map((item) => `<span class="painel-admin-preview-chip">${item}</span>`).join('')}
                  </div>
                </div>
              </span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="painel-admin-card">
        <div style="display:flex;justify-content:space-between;gap:.8rem;align-items:flex-start;flex-wrap:wrap">
          <div>
            <h2 style="font-size:1rem;margin-bottom:.2rem">Reiniciar teste de um contato</h2>
            <p style="color:#64748b;font-size:.84rem">Limpa apenas o contexto operacional daquele telefone para voce testar de novo sem carregar conversa antiga</p>
          </div>
        </div>
        <div class="painel-admin-reset-grid">
          <div class="painel-admin-reset-box">
            <label for="resetContatoTelefone">Telefone do contato</label>
            <input id="resetContatoTelefone" type="text" inputmode="numeric" placeholder="+55 12 99791-8525" />
            <div class="painel-admin-reset-help">Esse reset limpa historico da conversa, fila pendente, debounce, rastreamento recente e estado de fluxo do contato. Nao apaga aprendizados nem o conhecimento geral da i.a.</div>
            <div class="painel-admin-reset-actions">
              <button type="button" id="resetContatoBtn" style="border:none;border-radius:12px;padding:.72rem 1rem;background:#b45309;color:#fff;font-weight:600;cursor:pointer">Apagar historico deste contato</button>
            </div>
          </div>
          <div class="painel-admin-reset-box">
            <strong style="display:block;font-size:.88rem;color:#132033">Quando usar</strong>
            <div class="painel-admin-reset-help" style="margin-top:.45rem">
              Use antes de um novo teste quando voce quiser que a i.a pare de considerar a conversa anterior desse contato.
              <br><br>
              Exemplo: travou um fluxo, ficou digitando sem entregar, ou voce quer simular um primeiro contato do zero.
            </div>
            <div class="painel-admin-reset-actions" style="margin-top:.8rem">
              <a href="/journey.html" style="display:inline-flex;align-items:center;justify-content:center;border-radius:12px;padding:.72rem 1rem;background:#1d4ed8;color:#fff;font-weight:600;text-decoration:none">Abrir jornadas de teste</a>
            </div>
            <div id="resetContatoResultado" class="painel-admin-reset-result" hidden>Nenhum reset executado nesta sessao.</div>
          </div>
        </div>
      </div>
    `;
    const inputs = Array.from(alvo.querySelectorAll('[data-bloco-equipe]'));
    const resumoEl = alvo.querySelector('#painelEquipeResumo');
    const atualizarResumo = () => {
      const selecionados = inputs.filter((input) => input.checked).map((input) => input.getAttribute('data-bloco-equipe'));
      resumoEl.textContent = resumoVisibilidade(selecionados, dados.opcoes.length);
    };
    inputs.forEach((input) => input.addEventListener('change', atualizarResumo));
    alvo.querySelector('#restaurarEquipePadrao').addEventListener('click', () => {
      const padrao = new Set(dados.padrao?.blocosVisiveis || []);
      inputs.forEach((input) => {
        input.checked = padrao.has(input.getAttribute('data-bloco-equipe'));
      });
      atualizarResumo();
    });
    alvo.querySelector('#salvarEquipeVisibilidade').addEventListener('click', async () => {
      const blocosVisiveis = inputs
        .filter((input) => input.checked)
        .map((input) => input.getAttribute('data-bloco-equipe'));
      await json('/api/painel/visibilidade-equipe', {
        method: 'PUT',
        body: JSON.stringify({ blocosVisiveis }),
      });
      alert('Visibilidade do perfil equipe salva');
      await carregarContexto();
      await renderAdminEquipeCard(state.contexto);
    });
    const inputReset = alvo.querySelector('#resetContatoTelefone');
    const btnReset = alvo.querySelector('#resetContatoBtn');
    const resetResultado = alvo.querySelector('#resetContatoResultado');
    btnReset.addEventListener('click', async () => {
      const telefone = normalizarTelefone(inputReset.value);
      if (!telefone) {
        alert('Informe o telefone do contato que voce quer limpar');
        inputReset.focus();
        return;
      }
      if (!window.confirm(`Apagar o historico operacional do contato ${telefone}?`)) {
        return;
      }
      btnReset.disabled = true;
      btnReset.textContent = 'Limpando...';
      try {
        const data = await json('/api/admin/contatos/resetar-historico', {
          method: 'POST',
          body: JSON.stringify({ telefone }),
        });
        resetResultado.hidden = false;
        resetResultado.textContent =
          `Contato limpo: ${data.resultado.telefone}\n` +
          `Historico apagado: ${data.resultado.historicoLimpo ? 'sim' : 'nao'}\n` +
          `Mensagens retiradas do debounce: ${data.resultado.mensagensDebounceRemovidas}\n` +
          `Respostas pendentes removidas: ${data.resultado.respostasPendentesRemovidas}\n` +
          `Traces removidos: ${data.resultado.tracesRemovidos}\n` +
          `Estado de fluxo limpo: ${data.resultado.estadoFluxoLimpo ? 'sim' : 'nao'}`;
        inputReset.value = '';
        alert('Historico operacional do contato limpo');
      } catch (error) {
        resetResultado.hidden = false;
        resetResultado.textContent = error.message || 'Falha ao limpar o contato';
        alert(error.message || 'Falha ao limpar o contato');
      } finally {
        btnReset.disabled = false;
        btnReset.textContent = 'Apagar historico deste contato';
      }
    });
  }

  async function boot(options) {
    style();
    try {
      const contexto = await carregarContexto();
      appendUserBadge(contexto);
      if (options && options.requiredBlock && contexto.usuario.perfil === 'equipe') {
        if (!contexto.equipe.blocosVisiveis.includes(options.requiredBlock)) {
          bloquearPagina('Seu login não tem acesso a esta área');
          return;
        }
      }
      if (options && options.blockMap) {
        Object.entries(options.blockMap).forEach(([bloco, selector]) => {
          document.querySelectorAll(selector).forEach((el) => esconderSeEquipe(contexto, bloco, el));
        });
      }
      await renderAdminEquipeCard(contexto);
      if (options && typeof options.onReady === 'function') {
        options.onReady(contexto);
      }
    } catch {
      ensureOverlay();
      window.IagmxPainelAuth._onReady = async (contexto) => {
        appendUserBadge(contexto);
        if (options && options.requiredBlock && contexto.usuario.perfil === 'equipe') {
          if (!contexto.equipe.blocosVisiveis.includes(options.requiredBlock)) {
            bloquearPagina('Seu login não tem acesso a esta área');
            return;
          }
        }
        if (options && options.blockMap) {
          Object.entries(options.blockMap).forEach(([bloco, selector]) => {
            document.querySelectorAll(selector).forEach((el) => esconderSeEquipe(contexto, bloco, el));
          });
        }
        await renderAdminEquipeCard(contexto);
        if (options && typeof options.onReady === 'function') {
          options.onReady(contexto);
        }
      };
    }
  }

  window.IagmxPainelAuth = {
    boot,
    json,
    labels: BLOCO_LABELS,
    _onReady: null,
  };
})();
