/**
 * Monitor em tempo real por telefone.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { obterHistoricoBruto } from '../servicos/historico.js';
import { listarJidsHistoricoRecente } from '../servicos/historico.js';
import { listarRespostasPendentes } from '../servicos/fila-respostas.js';
import { obterDebounceContato } from '../servicos/debounce.js';
import { obterEstadoMonitorTelefone } from '../servicos/monitor-telefone.js';
import { listarTracesRecentes } from '../servicos/trace-pipeline.js';
import { listarContatosMonitorErp } from '../servicos/monitor-contatos-erp.js';
import { obterEstadoAtendimentoErp } from '../servicos/erp-atendimento-motorista.js';
import { painelAutenticado } from '../servicos/painel-acesso.js';
import {
  jidEhGrupoOuLista,
  normalizarTelefone,
  telefoneEhContatoValido,
  telefoneParaJid,
} from '../util/telefone.js';
import { montarJustificativaRespostaIa } from '../servicos/justificativa-resposta-ia.js';

interface LinhaMonitorTelefone {
  horarioMs: number;
  horarioIso: string;
  phone: string;
  origem: string;
  mensagem: string;
  tipo: string;
  status: string;
  variante?: 'chat' | 'previsto' | 'erp' | 'sistema';
  previstoParaMs?: number;
  detalhe?: {
    titulo: string;
    resumo: string;
    itens: string[];
    revisao?: string;
  };
}

interface ResumoMonitorTelefone {
  estadoAtual: string;
  previstoParaMs?: number;
  previstoParaIso?: string;
  restanteSegundos?: number;
  delaySorteadoMs?: number;
  delaySorteadoSegundos?: number;
  observacao?: string;
}

async function exigirLeituraPainel(
  req: Parameters<typeof painelAutenticado>[0],
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (painelAutenticado(req)) return true;
  reply.status(401).send({ erro: 'Não autenticado' });
  return false;
}

function formatarSegundos(ms?: number): string | null {
  if (ms == null) return null;
  return `${Math.max(0, Math.ceil(ms / 1000))}s`;
}

function formatarStatusTemporizado(prefixo: string, ateMs?: number): string {
  const restante = ateMs ? Math.max(0, ateMs - Date.now()) : 0;
  const sufixo = formatarSegundos(restante);
  return sufixo ? `${prefixo} ${sufixo}` : prefixo;
}

function formatarHoraBrasilia(ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms));
}

function formatarStatusCompleto(prefixo: string, ateMs?: number, sorteadoMs?: number): string {
  const restanteMs = ateMs ? Math.max(0, ateMs - Date.now()) : 0;
  const partes = [formatarStatusTemporizado(prefixo, ateMs)];
  if (ateMs) partes.push(`dispara ${formatarHoraBrasilia(ateMs)}`);
  if (sorteadoMs != null) partes.push(`delay ${Math.ceil(sorteadoMs / 1000)}s`);
  if (restanteMs > 0) partes.push(`faltam ${Math.ceil(restanteMs / 1000)}s`);
  return partes.join(' · ');
}

function novaLinha(
  telefone: string,
  horarioMs: number,
  origem: string,
  mensagem: string,
  tipo: string,
  status: string,
  extras?: Partial<Pick<LinhaMonitorTelefone, 'variante' | 'previstoParaMs' | 'detalhe'>>,
): LinhaMonitorTelefone {
  return {
    horarioMs,
    horarioIso: new Date(horarioMs).toISOString(),
    phone: telefone,
    origem,
    mensagem,
    tipo,
    status,
    variante: extras?.variante,
    previstoParaMs: extras?.previstoParaMs,
    detalhe: extras?.detalhe,
  };
}

function resumoFerramenta(
  nome: string,
  dados?: Record<string, unknown>,
): { mensagem: string; tipo: string } {
  const safe = dados || {};
  if (nome === 'registrar_disponibilidade') {
    const partes = [
      `Disponibilidade validada para gravacao`,
      safe.status ? `status ${String(safe.status)}` : null,
      safe.localizacao_atual ? `local atual ${String(safe.localizacao_atual)}` : null,
      safe.local_destino_atual ? `destino atual ${String(safe.local_destino_atual)}` : null,
      (safe.local_liberacao_prevista || safe.local_disponibilidade)
        ? `local de liberacao ${String(safe.local_liberacao_prevista || safe.local_disponibilidade)}`
        : null,
      safe.data_previsao_disponibilidade
        ? `libera em ${String(safe.data_previsao_disponibilidade)}`
        : null,
      safe.latitude != null && safe.longitude != null
        ? `lat/lon ${String(safe.latitude)}, ${String(safe.longitude)}`
        : null,
    ].filter(Boolean);
    return { mensagem: partes.join(' · '), tipo: 'erp_disponibilidade' };
  }
  if (nome === 'atualizar_motorista') {
    return {
      mensagem: `Cadastro principal atualizado · ${JSON.stringify(safe).slice(0, 240)}`,
      tipo: 'erp_cadastro',
    };
  }
  if (nome === 'grava_ocr') {
    return {
      mensagem: `Documento enviado para revisao/gravação · ${JSON.stringify(safe).slice(0, 240)}`,
      tipo: 'erp_ocr',
    };
  }
  if (nome === 'grava_comprovante') {
    return {
      mensagem: `Arquivo operacional vinculado no banco · ${JSON.stringify(safe).slice(0, 240)}`,
      tipo: 'erp_arquivo',
    };
  }
  if (nome === 'salvar_carreta') {
    return {
      mensagem: `Dados do veiculo atualizados · ${JSON.stringify(safe).slice(0, 240)}`,
      tipo: 'erp_veiculo',
    };
  }
  if (nome === 'resposta_oferta_carga') {
    return {
      mensagem: `Resposta de oferta registrada · ${JSON.stringify(safe).slice(0, 240)}`,
      tipo: 'erp_oferta',
    };
  }
  if (nome === 'escalonar_negociacao') {
    return {
      mensagem: `Escalonamento operacional criado · ${JSON.stringify(safe).slice(0, 240)}`,
      tipo: 'erp_escalonamento',
    };
  }
  return {
    mensagem: `Ferramenta executada · ${nome} · ${JSON.stringify(safe).slice(0, 240)}`,
    tipo: 'erp_ferramenta',
  };
}

function formatarDetalheTrace(detalhe?: Record<string, unknown>): string {
  if (!detalhe) return '';
  const partes: string[] = [];
  const push = (rotulo: string, valor: unknown) => {
    if (valor == null) return;
    const texto =
      typeof valor === 'string'
        ? valor
        : Array.isArray(valor) || typeof valor === 'object'
          ? JSON.stringify(valor)
          : String(valor);
    if (!texto) return;
    partes.push(`${rotulo}: ${texto}`);
  };
  push('tipo', detalhe.tipo);
  push('intencao', detalhe.intencao);
  push('passo', detalhe.passo);
  push('cenario', detalhe.cenario);
  push('passadas', detalhe.passadas);
  push('ferramentas', detalhe.ferramentas);
  push('mensagens_lote', detalhe.mensagensLote);
  push('ultima_saida', detalhe.ultimaSaida);
  push('historico_recente', detalhe.historicoRecente);
  push('memoria_mesmo_dia', detalhe.memoriaMesmoDia);
  push('memoria_semantica', detalhe.memoriaSemantica);
  push('preview', detalhe.preview);
  return partes.join('\n').slice(0, 1200);
}

function historicoAssistantAindaNaoEnviado(
  conteudo: string,
  timestamp: number,
  pendentes: Awaited<ReturnType<typeof listarRespostasPendentes>>,
): boolean {
  return pendentes.some((item) => {
    if (item.tipoFila !== 'atraso_humanizado') return false;
    if (!item.agendadoPara) return false;
    if ((item.texto || '').trim() !== (conteudo || '').trim()) return false;
    return Math.abs(item.criadoEm - timestamp) <= 5000;
  });
}

function montarResumoAtual(opts: {
  linhas: LinhaMonitorTelefone[];
  debounce: Awaited<ReturnType<typeof obterDebounceContato>>;
  filaTelefone: Awaited<ReturnType<typeof listarRespostasPendentes>>;
  estadoEnvio: Awaited<ReturnType<typeof obterEstadoMonitorTelefone>>;
  atendimento: Awaited<ReturnType<typeof obterEstadoAtendimentoErp>>;
}): ResumoMonitorTelefone {
  if (opts.estadoEnvio?.fase === 'aguardando_atraso_inicial') {
    return {
      estadoAtual: 'Aguardando atraso inicial persistido',
      previstoParaMs: opts.estadoEnvio.ateMs,
      previstoParaIso: opts.estadoEnvio.ateMs ? new Date(opts.estadoEnvio.ateMs).toISOString() : undefined,
      restanteSegundos: opts.estadoEnvio.ateMs ? Math.max(0, Math.ceil((opts.estadoEnvio.ateMs - Date.now()) / 1000)) : undefined,
      delaySorteadoMs: opts.estadoEnvio.sorteadoMs,
      delaySorteadoSegundos: opts.estadoEnvio.sorteadoMs ? Math.ceil(opts.estadoEnvio.sorteadoMs / 1000) : undefined,
      observacao: opts.estadoEnvio.detalhe || opts.estadoEnvio.mensagem,
    };
  }

  const filaAgendada = opts.filaTelefone.find((item) => item.agendadoPara);
  if (filaAgendada) {
    return {
      estadoAtual: 'Resposta agendada na fila',
      previstoParaMs: filaAgendada.agendadoPara,
      previstoParaIso: filaAgendada.agendadoPara
        ? new Date(filaAgendada.agendadoPara).toISOString()
        : undefined,
      restanteSegundos: filaAgendada.agendadoPara
        ? Math.max(0, Math.ceil((filaAgendada.agendadoPara - Date.now()) / 1000))
        : undefined,
      observacao: filaAgendada.motivo,
    };
  }

  if (opts.debounce) {
    const previstoParaMs = Date.now() + opts.debounce.aguardandoMs;
    return {
      estadoAtual: 'Aguardando debounce',
      previstoParaMs,
      previstoParaIso: new Date(previstoParaMs).toISOString(),
      restanteSegundos: Math.max(0, Math.ceil(opts.debounce.aguardandoMs / 1000)),
      delaySorteadoMs: opts.debounce.aguardandoMs,
      delaySorteadoSegundos: Math.max(0, Math.ceil(opts.debounce.aguardandoMs / 1000)),
      observacao: 'A IA ainda esta juntando mensagens antes de processar o lote',
    };
  }

  const motivoAtendimento =
    opts.atendimento.estado.precisa_atendimento_motivo || opts.atendimento.estado.ia_pausa_motivo;
  if (opts.atendimento.estado.precisa_atendimento || opts.atendimento.estado.ia_pausada) {
    return {
      estadoAtual: 'IA pausada para ajuda humana',
      observacao: motivoAtendimento || 'A conversa foi escalada para atendimento humano',
    };
  }

  return {
    estadoAtual: opts.linhas[0]?.status ?? 'sem atividade recente',
    observacao: opts.linhas[0]
      ? 'Nao existe cronometro ativo salvo para este telefone agora'
      : 'Nenhuma atividade recente encontrada',
  };
}

export async function rotasMonitorTelefone(app: FastifyInstance): Promise<void> {
  app.get('/api/monitor/contatos-erp', async (req, reply) => {
    if (!(await exigirLeituraPainel(req, reply))) return;
    const contatos = await listarContatosMonitorErp(150);
    return {
      ok: true,
      contatos,
    };
  });

  app.get('/api/monitor/telefones-ativos', async (req, reply) => {
    if (!(await exigirLeituraPainel(req, reply))) return;
    const [jids, pendentes, traces] = await Promise.all([
      listarJidsHistoricoRecente({
        janelaHoras: 72,
        maxChaves: 250,
        prefetchMensagens: 8,
        minMensagensNaJanela: 1,
        timeoutMs: 8000,
      }).catch(() => []),
      listarRespostasPendentes(120),
      listarTracesRecentes(120),
    ]);
    const vistos = new Set<string>();
    const telefones: string[] = [];
    const adicionar = (telefoneOuJid: string | undefined | null) => {
      const bruto = String(telefoneOuJid ?? '').trim();
      if (!bruto || jidEhGrupoOuLista(bruto)) return;
      const normalizado = normalizarTelefone(bruto);
      if (!telefoneEhContatoValido(normalizado) || vistos.has(normalizado)) return;
      vistos.add(normalizado);
      telefones.push(normalizado);
    };
    const adicionarPendente = (telefone: string | undefined | null) => {
      const normalizado = normalizarTelefone(String(telefone ?? ''));
      if (!telefoneEhContatoValido(normalizado) || vistos.has(normalizado)) return;
      vistos.add(normalizado);
      telefones.push(normalizado);
    };
    for (const jid of jids) adicionar(jid);
    for (const item of pendentes) adicionarPendente(item.telefone);
    for (const trace of traces) adicionarPendente(trace.telefone);
    return {
      ok: true,
      telefones: telefones.slice(0, 80),
    };
  });

  app.get<{ Querystring: { telefone?: string } }>('/api/monitor/telefone', async (req, reply) => {
    if (!(await exigirLeituraPainel(req, reply))) return;

    const telefoneInformado = req.query.telefone ?? '';
    const telefone = normalizarTelefone(telefoneInformado);
    if (!telefone) {
      return reply.status(400).send({ erro: 'telefone obrigatorio' });
    }

    const remoteJid = telefoneParaJid(telefone);
    const [historico, pendentes, debounce, estadoEnvio, traces, atendimento] = await Promise.all([
      obterHistoricoBruto(remoteJid),
      listarRespostasPendentes(100),
      obterDebounceContato(remoteJid),
      obterEstadoMonitorTelefone(telefone),
      listarTracesRecentes(80),
      obterEstadoAtendimentoErp(telefone),
    ]);
    // #region debug-point E:monitor-load
    if (telefone === '5512997918525') fetch('http://2.24.201.28:7777/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'chat-no-response-8525',runId:'pre-fix',hypothesisId:'E',location:'monitor-telefone.ts:337',msg:'[DEBUG] monitor carregou snapshot do telefone alvo',data:{telefone,remoteJid,historico:historico.length,pendentes:pendentes.filter((item)=>item.telefone===telefone).length,debounce:debounce ? debounce.itens.length : 0,estadoEnvio:estadoEnvio?.fase ?? null,traces:traces.filter((trace)=>trace.telefone===telefone).length,ultimosPapeis:historico.slice(-6).map((item)=>item.papel)},ts:Date.now()})}).catch(()=>{});
    // #endregion

    const linhas: LinhaMonitorTelefone[] = [];

    const tracesContato = traces.filter((trace) => trace.telefone === telefone).slice(0, 10);

    for (const item of historico) {
      if (
        item.papel === 'assistant' &&
        historicoAssistantAindaNaoEnviado(item.conteudo, item.timestamp, pendentes)
      ) {
        continue;
      }
      const origem =
        item.papel === 'user'
          ? 'cliente'
          : item.papel === 'assistant'
            ? 'ia'
            : item.papel === 'empresa'
              ? 'empresa'
              : 'sistema';
      const status =
        item.papel === 'user'
          ? 'recebido'
          : item.papel === 'assistant'
            ? 'enviado'
            : item.papel === 'empresa'
              ? 'manual'
              : 'registrado';
      linhas.push(novaLinha(telefone, item.timestamp, origem, item.conteudo, 'mensagem', status));
      if (item.papel === 'assistant') {
        const justificativa = montarJustificativaRespostaIa(item.conteudo, item.timestamp, tracesContato);
        if (justificativa) {
          linhas[linhas.length - 1].detalhe = justificativa;
          linhas[linhas.length - 1].tipo = 'mensagem_ia';
        }
      }
    }

    if (debounce) {
      for (const item of debounce.itens) {
        linhas.push(
          novaLinha(
            telefone,
            item.timestamp,
            'cliente',
            item.conteudo,
            item.tipo,
            formatarStatusTemporizado('esperando debounce por mais', Date.now() + debounce.aguardandoMs),
            { variante: 'sistema' },
          ),
        );
      }
      linhas.push(
        novaLinha(
          telefone,
          debounce.iniciadoEmMs,
          'sistema',
          'Lote recebido e segurado para evitar resposta imediata',
          'debounce',
          formatarStatusTemporizado('esperando', Date.now() + debounce.aguardandoMs),
          { variante: 'sistema', previstoParaMs: Date.now() + debounce.aguardandoMs },
        ),
      );
    }

    const filaTelefone = pendentes.filter((item) => item.telefone === telefone);
    for (const item of filaTelefone) {
      const status = item.agendadoPara
        ? formatarStatusCompleto(
            'esperando',
            item.agendadoPara,
            item.agendadoPara ? item.agendadoPara - item.criadoEm : undefined,
          )
        : `na fila: ${item.motivo || 'canal indisponivel'}`;
      const mensagem =
        item.texto?.trim()
          ? item.texto
          : item.tipoFila === 'atraso_humanizado'
            ? `Resposta aguardando o atraso inicial persistido desde ${formatarHoraBrasilia(item.criadoEm)}`
            : 'Resposta aguardando na fila';
      linhas.push(
        novaLinha(
          telefone,
          item.criadoEm,
          'ia',
          mensagem,
          item.tipoFila === 'atraso_humanizado' ? 'atraso_inicial' : 'fila',
          status,
          { variante: 'previsto', previstoParaMs: item.agendadoPara },
        ),
      );
    }

    if (estadoEnvio) {
      const mensagemEstado =
        estadoEnvio.fase === 'aguardando_atraso_inicial'
          ? 'Resposta aguardando envio automatico apos o delay persistido'
          : estadoEnvio.fase === 'pausa_fragmento'
            ? 'Resposta em pausa entre fragmentos'
            : estadoEnvio.fase === 'digitando'
              ? 'Simulando digitacao antes do envio'
              : estadoEnvio.fase === 'fila_pendente'
                ? 'Resposta aguardando na fila'
                : estadoEnvio.detalhe || estadoEnvio.mensagem;
      const status =
        estadoEnvio.fase === 'aguardando_atraso_inicial'
          ? formatarStatusCompleto('esperando', estadoEnvio.ateMs, estadoEnvio.sorteadoMs)
          : estadoEnvio.fase === 'pausa_fragmento'
            ? formatarStatusCompleto('esperando', estadoEnvio.ateMs, estadoEnvio.sorteadoMs)
            : estadoEnvio.fase === 'digitando'
              ? formatarStatusCompleto('digitando por mais', estadoEnvio.ateMs, estadoEnvio.sorteadoMs)
              : estadoEnvio.fase === 'fila_pendente'
                ? 'na fila'
                : estadoEnvio.fase === 'concluido'
                  ? 'enviado'
                  : estadoEnvio.fase === 'erro'
                    ? 'erro'
                    : 'enviando agora';
      linhas.push(
        novaLinha(
          telefone,
          estadoEnvio.atualizadoEmMs,
          'sistema',
          mensagemEstado,
          estadoEnvio.fase,
          status,
          {
            variante:
              ['aguardando_atraso_inicial', 'pausa_fragmento', 'digitando', 'fila_pendente'].includes(
                estadoEnvio.fase,
              )
                ? 'previsto'
                : 'sistema',
            previstoParaMs: estadoEnvio.ateMs,
          },
        ),
      );
    }

    const motivoAtendimento =
      atendimento.estado.precisa_atendimento_motivo || atendimento.estado.ia_pausa_motivo;
    if (
      motivoAtendimento &&
      !debounce &&
      !filaTelefone.length &&
      !estadoEnvio
    ) {
      linhas.push(
        novaLinha(
          telefone,
          Date.now(),
          'sistema',
          `IA pausada e aguardando atendimento humano\n${motivoAtendimento}`,
          'atendimento_humano',
          'aguardando humano',
          { variante: 'erp' },
        ),
      );
    }

    const semCronometroAtivo = !debounce && !filaTelefone.some((item) => item.agendadoPara) && !estadoEnvio;
    for (const trace of tracesContato) {
      const ultimaEtapa = trace.etapas[trace.etapas.length - 1];
      const statusTrace =
        trace.status === 'processando' && semCronometroAtivo
          ? `${trace.status}${ultimaEtapa ? ` · ${ultimaEtapa.rotulo}` : ''} · sem horario previsto salvo`
          : `${trace.status}${ultimaEtapa ? ` · ${ultimaEtapa.rotulo}` : ''}`;
      linhas.push(
        novaLinha(
          telefone,
          trace.fimMs ?? trace.inicioMs,
          'sistema',
          trace.entrada,
          `trace:${trace.tipos.join(',') || 'texto'}`,
          statusTrace,
        ),
      );
      for (const etapa of trace.etapas.slice(-6)) {
        const nomeFerramenta = String(etapa.detalhe?.ferramenta ?? '');
        if (etapa.etapa === 'ferramenta' && nomeFerramenta) {
          const resumo = resumoFerramenta(nomeFerramenta, etapa.detalhe?.dados as Record<string, unknown>);
          linhas.push(
            novaLinha(
              telefone,
              etapa.ts,
              'sistema',
              resumo.mensagem,
              resumo.tipo,
              `ERP ${String(etapa.detalhe?.status || 'ok')}`,
              { variante: 'erp' },
            ),
          );
          continue;
        }
        if (etapa.etapa === 'auto_pausa') {
          linhas.push(
            novaLinha(
              telefone,
              etapa.ts,
              'sistema',
              String(etapa.detalhe?.mensagem || etapa.rotulo),
              'erp_ajuda_humana',
              'IA pausada · ajuda humana solicitada',
              { variante: 'erp' },
            ),
          );
          continue;
        }
        if (['contexto', 'roteamento', 'geracao', 'envio', 'webhook', 'debounce'].includes(etapa.etapa)) {
          continue;
        }
        const detalhe = formatarDetalheTrace(etapa.detalhe);
        linhas.push(
          novaLinha(
            telefone,
            etapa.ts,
            'sistema',
            detalhe ? `${etapa.rotulo}\n${detalhe}` : etapa.rotulo,
            etapa.etapa,
            etapa.rotulo,
            { variante: 'sistema' },
          ),
        );
      }
    }

    linhas.sort((a, b) => b.horarioMs - a.horarioMs);
    // #region debug-point E:monitor-built
    if (telefone === '5512997918525') fetch('http://2.24.201.28:7777/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'chat-no-response-8525',runId:'pre-fix',hypothesisId:'E',location:'monitor-telefone.ts:545',msg:'[DEBUG] monitor montou linhas do telefone alvo',data:{telefone,totalLinhas:linhas.length,primeirasLinhas:linhas.slice(0,6).map((item)=>({origem:item.origem,tipo:item.tipo,status:item.status,mensagem:item.mensagem.slice(0,120)}))},ts:Date.now()})}).catch(()=>{});
    // #endregion

    const ultimaLinha = linhas[0] ?? null;
    const resumoAtual = montarResumoAtual({
      linhas,
      debounce,
      filaTelefone,
      estadoEnvio,
      atendimento,
    });
    return {
      build: config.buildId,
      telefone,
      remoteJid,
      atualizadoEmMs: Date.now(),
      estadoAtual: resumoAtual.estadoAtual || ultimaLinha?.status || 'sem atividade recente',
      resumoAtual,
      total: linhas.length,
      linhas: linhas.slice(0, 80),
    };
  });
}
