/**
 * Debounce de mensagens via Redis.
 */
import { obterRedis, pingRedis } from '../lib/redis.js';
import { config } from '../config.js';
import type { ItemDebounce } from '../tipos/evolution.js';
import { gerarRespostaRefinada, montarPromptCompactoPassadas } from './inferencia-refinada.js';
import { tentarEnviarResposta } from './enviar-resposta.js';
import { obterHistorico, adicionarAoHistorico, obterHistoricoBruto } from './historico.js';
import { processarFerramentas } from './ferramentas.js';
import { normalizarRespostaWhatsapp } from './mensagem.js';
import { iaPodeResponder } from './pausa.js';
import { jidParaTelefone, telefoneParaJid } from '../util/telefone.js';
import { montarPromptSistemaInferencia } from './contexto-inferencia.js';
import { gerarConversaRapida, deveUsarConversaRapida } from './conversa-rapida.js';
import { logEvento } from '../util/log-eventos.js';
import { pararDigitando } from './digitando-sessao.js';
import { rotearMensagem } from './roteador-intencao.js';
import { garantirContatoMotorista } from './contato-motorista.js';
import { registrarIntencaoWhatsapp } from './erp-atendimento-motorista.js';
import { obterConfigTempo } from './config-tempo.js';
import { obterConfigMensagensFluxo } from './config-mensagens-fluxo.js';
import {
  iniciarTrace,
  adicionarEtapa,
  finalizarTrace,
  obterTraceIdAtivo,
} from './trace-pipeline.js';
import {
  processarMensagemTreinamentoWhatsapp,
  telefoneAutorizadoTreinamento,
} from './treinamento-whatsapp.js';
import { obterConfigHumanizacao, aleatorioEntre } from './config-humanizacao.js';
import { salvarEstadoMonitorTelefone } from './monitor-telefone.js';
import { listarRespostasPendentes, removerRespostaPendente } from './fila-respostas.js';
import { montarMemoriaConversaMesmoDia } from './memoria-conversa.js';
import { montarMemoriaSemanticaContato } from './memoria-semanticacontato.js';
import { serializarBlocoFerramenta } from './ferramentas.js';
import { resolverDisponibilidadeComRedundancia } from './consenso-disponibilidade.js';
import { contatoEmModoTesteImediato } from './modo-teste-imediato.js';

const redis = obterRedis();

const PREFIXO_LISTA = 'debounce:lista:';
const PREFIXO_TIMER = 'debounce:timer:';
const PREFIXO_LOCK = 'debounce:lock:';
const PREFIXO_PROCESSAR_EM = 'debounce:processar_em:';
const PREFIXO_ATRASO = 'debounce:atraso_inicial:';
const TTL_DEBOUNCE_SEGUNDOS = 2 * 60 * 60;

function assuntoDisponibilidadeProvavel(
  rota: { intencao: string; cenario?: number },
  analise?: { intencao_provavel?: string } | null,
): boolean {
  return (
    rota.intencao === 'disponibilidade' ||
    rota.cenario === 7 ||
    analise?.intencao_provavel === 'disponibilidade'
  );
}

function leadDigitandoMs(atrasoMs: number): number {
  if (atrasoMs <= 10_000) return Math.max(1000, Math.floor(atrasoMs / 2));
  return 10_000;
}

async function garantirJanelaFinalResposta(remoteJid: string): Promise<{
  processarEmMs: number;
  atrasoInicialMs: number;
}> {
  const chaveProcessar = `${PREFIXO_PROCESSAR_EM}${remoteJid}`;
  const chaveAtraso = `${PREFIXO_ATRASO}${remoteJid}`;
  const telefone = jidParaTelefone(remoteJid);
  if (await contatoEmModoTesteImediato(telefone)) {
    const processarEmMs = Date.now();
    await Promise.all([
      redis.set(chaveProcessar, String(processarEmMs), 'EX', TTL_DEBOUNCE_SEGUNDOS),
      redis.set(chaveAtraso, '0', 'EX', TTL_DEBOUNCE_SEGUNDOS),
    ]);
    return { processarEmMs, atrasoInicialMs: 0 };
  }
  const [processarRaw, atrasoRaw] = await Promise.all([
    redis.get(chaveProcessar),
    redis.get(chaveAtraso),
  ]);

  if (processarRaw && atrasoRaw) {
    return {
      processarEmMs: parseInt(processarRaw, 10),
      atrasoInicialMs: parseInt(atrasoRaw, 10),
    };
  }

  const cfg = await obterConfigHumanizacao();
  const atrasoInicialMs = aleatorioEntre(cfg.atrasoInicialMinMs, cfg.atrasoInicialMaxMs);
  const processarEmMs = Date.now() + Math.max(0, atrasoInicialMs - leadDigitandoMs(atrasoInicialMs));

  await Promise.all([
    redis.set(chaveProcessar, String(processarEmMs), 'EX', TTL_DEBOUNCE_SEGUNDOS),
    redis.set(chaveAtraso, String(atrasoInicialMs), 'EX', TTL_DEBOUNCE_SEGUNDOS),
  ]);

  return { processarEmMs, atrasoInicialMs };
}

async function cancelarRespostaAgendadaSeNecessario(telefone: string): Promise<number> {
  const pendentes = await listarRespostasPendentes(100);
  const cancelar = pendentes.filter((item) => {
    if (item.telefone !== telefone) return false;
    return item.tipoFila === 'atraso_humanizado';
  });
  for (const item of cancelar) {
    await removerRespostaPendente(item.id, item.telefone);
  }
  return cancelar.length;
}

export async function adicionarAoDebounce(item: ItemDebounce): Promise<void> {
  const chaveLista = `${PREFIXO_LISTA}${item.remoteJid}`;
  const chaveTimer = `${PREFIXO_TIMER}${item.remoteJid}`;
  const telefone = jidParaTelefone(item.remoteJid);
  const [{ processarEmMs, atrasoInicialMs }, removidos] = await Promise.all([
    garantirJanelaFinalResposta(item.remoteJid),
    cancelarRespostaAgendadaSeNecessario(telefone),
  ]);

  await redis.rpush(chaveLista, JSON.stringify(item));
  await redis.expire(chaveLista, TTL_DEBOUNCE_SEGUNDOS);
  await redis.set(chaveTimer, Date.now().toString(), 'EX', TTL_DEBOUNCE_SEGUNDOS);

  await salvarEstadoMonitorTelefone(telefone, {
    fase: 'aguardando_atraso_inicial',
    mensagem: 'Aguardando janela final antes de responder',
    desdeMs: Date.now(),
    ateMs: processarEmMs,
    sorteadoMs: atrasoInicialMs,
    detalhe:
      removidos > 0
        ? `nova mensagem recebida, resposta anterior replanejada (${removidos} agendada(s) cancelada(s))`
        : 'novas mensagens continuam entrando no contexto ate perto do envio',
  });
}

export async function statusDebounce(): Promise<
  Array<{ remoteJid: string; mensagens: number; aguardandoMs: number }>
> {
  const chavesTimer = await redis.keys(`${PREFIXO_TIMER}*`);
  const agora = Date.now();
  const resultado = [];

  for (const chaveTimer of chavesTimer) {
    const remoteJid = chaveTimer.replace(PREFIXO_TIMER, '');
    const valorTimer = await redis.get(chaveTimer);
    if (!valorTimer) continue;
    const inicio = parseInt(valorTimer, 10);
    const lista = await redis.llen(`${PREFIXO_LISTA}${remoteJid}`);
    const modoImediato = await contatoEmModoTesteImediato(jidParaTelefone(remoteJid));
    const tempoCfg = await obterConfigTempo();
    resultado.push({
      remoteJid,
      mensagens: lista,
      aguardandoMs: modoImediato ? 0 : Math.max(0, tempoCfg.debounceMs - (agora - inicio)),
    });
  }
  return resultado;
}

export async function obterDebounceContato(
  remoteJid: string,
): Promise<{ itens: ItemDebounce[]; aguardandoMs: number; iniciadoEmMs: number } | null> {
  const chaveLista = `${PREFIXO_LISTA}${remoteJid}`;
  const chaveTimer = `${PREFIXO_TIMER}${remoteJid}`;
  const [valorTimer, itensRaw, tempoCfg] = await Promise.all([
    redis.get(chaveTimer),
    redis.lrange(chaveLista, 0, -1),
    obterConfigTempo(),
  ]);
  if (!valorTimer || !itensRaw.length) return null;
  const iniciadoEmMs = parseInt(valorTimer, 10);
  if (!Number.isFinite(iniciadoEmMs)) return null;
  const modoImediato = await contatoEmModoTesteImediato(jidParaTelefone(remoteJid));
  return {
    iniciadoEmMs,
    aguardandoMs: modoImediato ? 0 : Math.max(0, tempoCfg.debounceMs - (Date.now() - iniciadoEmMs)),
    itens: itensRaw.map((raw) => JSON.parse(raw) as ItemDebounce),
  };
}

export async function processarDebounceExpirado(): Promise<void> {
  const chavesTimer = await redis.keys(`${PREFIXO_TIMER}*`);
  const agora = Date.now();
  const tempo = await obterConfigTempo();

  for (const chaveTimer of chavesTimer) {
    const remoteJid = chaveTimer.replace(PREFIXO_TIMER, '');
    const valorTimer = await redis.get(chaveTimer);
    if (!valorTimer) continue;
    const processarEmRaw = await redis.get(`${PREFIXO_PROCESSAR_EM}${remoteJid}`);
    const modoImediato = await contatoEmModoTesteImediato(jidParaTelefone(remoteJid));

    const inicio = parseInt(valorTimer, 10);
    if (!modoImediato && agora - inicio < tempo.debounceMs) continue;
    if (processarEmRaw && agora < parseInt(processarEmRaw, 10)) continue;

    const chaveLock = `${PREFIXO_LOCK}${remoteJid}`;
    const lock = await redis.set(chaveLock, '1', 'PX', 60000, 'NX');
    if (!lock) continue;

    try {
      await processarLote(remoteJid);
    } finally {
      await redis.del(chaveLock);
    }
  }
}

async function processarLote(remoteJid: string): Promise<void> {
  const chaveLista = `${PREFIXO_LISTA}${remoteJid}`;
  const chaveTimer = `${PREFIXO_TIMER}${remoteJid}`;
  const chaveProcessar = `${PREFIXO_PROCESSAR_EM}${remoteJid}`;
  const chaveAtraso = `${PREFIXO_ATRASO}${remoteJid}`;

  const itensRaw = await redis.lrange(chaveLista, 0, -1);
  if (itensRaw.length === 0) {
    await redis.del(chaveTimer, chaveProcessar, chaveAtraso);
    return;
  }

  await redis.del(chaveLista, chaveTimer, chaveProcessar, chaveAtraso);

  const itens: ItemDebounce[] = itensRaw.map((r: string) => JSON.parse(r) as ItemDebounce);
  const mensagens = itens.map((i) => i.conteudo).filter(Boolean);
  if (mensagens.length === 0) return;

  const instance = itens[0].instance;
  const origem = itens.find((i) => i.origem)?.origem;
  const numero = jidParaTelefone(remoteJid);
  const textoUsuario = mensagens.join('\n\n');
  const pushName = itens.find((i) => i.pushName)?.pushName;
  const tiposEntrada = [...new Set(itens.map((i) => i.tipo))];
  const primeiroTs = Math.min(...itens.map((i) => i.timestamp ?? Date.now()));
  const tempo = await obterConfigTempo();
  const debounceAguardouMs = Date.now() - primeiroTs - tempo.debounceMs;

  let traceId = (await obterTraceIdAtivo(remoteJid)) ?? '';
  if (!traceId) {
    traceId = await iniciarTrace({
      telefone: numero,
      remoteJid,
      entrada: textoUsuario,
      tipos: tiposEntrada,
      debounceAguardouMs: Math.max(0, debounceAguardouMs),
    });
  } else {
    await adicionarEtapa(traceId, 'debounce', 'Debounce expirou — processando lote', {
      mensagens: mensagens.length,
      tipos: tiposEntrada,
    });
  }

  // #region debug-point B:debounce-start
  fetch('http://2.24.201.28:7778/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'whatsapp-delay-response',runId:'pre-fix',hypothesisId:'B',location:'debounce.ts:143',msg:'[DEBUG] lote entrou em processamento no debounce',data:{traceId,telefone:numero,remoteJid,mensagens:mensagens.length,tiposEntrada,origem:origem ?? null,primeiroTs,debounceAguardouMs:Math.max(0,debounceAguardouMs)},ts:Date.now()})}).catch(()=>{});
  // #endregion

  const t0 = Date.now();

  if (await telefoneAutorizadoTreinamento(numero)) {
    try {
      await adicionarEtapa(
        traceId,
        'treinamento_whatsapp',
        'Telefone autorizado entrou em modo de treino/admin',
        { telefone: numero },
        Date.now() - t0,
      );
      const respostaTreino = await processarMensagemTreinamentoWhatsapp({
        telefone: numero,
        remoteJid,
        textoUsuario,
        pushName,
      });
      const envioTreino = await tentarEnviarResposta(numero, respostaTreino, instance, {
        remoteJid,
        mensagensEntrada: mensagens.length,
        origem,
        fragmentar: false,
        agendarAtrasoInicial: false,
      });
      await adicionarEtapa(
        traceId,
        'envio',
        envioTreino.enviado ? 'Resposta de treino enviada' : 'Resposta de treino enfileirada',
        {
          fragmentos: envioTreino.fragmentos,
          motivo: envioTreino.motivo,
          pendente: envioTreino.pendente,
        },
        0,
      );
      await finalizarTrace(traceId, { status: 'ok', resposta: respostaTreino });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await finalizarTrace(traceId, { status: 'erro', erro: msg });
      throw err;
    }
  }

  const registro = await garantirContatoMotorista(numero, pushName);
  if (registro.criado) {
    logEvento('debounce', 'Contato registrado no ERP (primeiro contato)', {
      telefone: numero,
      motoristaId: registro.motoristaId,
    });
  }

  if (!(await iaPodeResponder(numero))) {
    logEvento('debounce', 'Lote descartado — contato pausado', { telefone: numero });
    await finalizarTrace(traceId, { status: 'silencio', resposta: '(contato pausado)' });
    return;
  }

  if (tiposEntrada.some((t) => t === 'imagem' || t === 'documento')) {
    await adicionarEtapa(traceId, 'ocr', 'OCR / leitura de mídia', {
      preview: textoUsuario.slice(0, 200),
      midiaId: itens.find((i) => i.midiaId)?.midiaId,
    });
  }

  logEvento('debounce', 'Processando lote', {
    telefone: numero,
    mensagens: mensagens.length,
    tipos: [...new Set(itens.map((i) => i.tipo))],
  });

  try {
    await adicionarAoHistorico(remoteJid, 'user', textoUsuario);

    const [historico, historicoBruto] = await Promise.all([
      obterHistorico(remoteJid, { limite: 20 }),
      obterHistoricoBruto(remoteJid),
    ]);
    const historicoSemAtual = historico.slice(0, -1);
    const ultimaAssistant = [...historicoSemAtual]
      .reverse()
      .find((h) => h.role === 'assistant')?.content;
    const memoriaConversa = montarMemoriaConversaMesmoDia(historicoBruto, {
      recentesCompletas: 10,
      maxLinhasMemoria: 8,
    });
    const memoriaSemantica = await montarMemoriaSemanticaContato(
      numero,
      textoUsuario,
      historicoSemAtual.slice(-10).map((item) => item.content),
    );
    const memoriaExtra = [memoriaConversa, memoriaSemantica].filter(Boolean).join('\n\n');

    await adicionarEtapa(
      traceId,
      'contexto',
      'Contexto consolidado antes da decisao',
      {
        mensagensLote: mensagens.map((msg) => msg.slice(0, 160)),
        ultimaSaida: ultimaAssistant?.slice(0, 160),
        historicoRecente: historicoSemAtual.slice(-4).map((item) => ({
          role: item.role,
          content: item.content.slice(0, 140),
        })),
        memoriaMesmoDia: memoriaConversa.slice(0, 300),
        memoriaSemantica: memoriaSemantica.slice(0, 300),
      },
      Date.now() - t0,
    );

    const rota = await rotearMensagem({
      telefone: numero,
      mensagem: textoUsuario,
      historico: historicoSemAtual,
      ultimaAssistant,
      itens,
      nomeContato: pushName,
    });

    await adicionarEtapa(
      traceId,
      'roteamento',
      'Decisão do roteador',
      {
        tipo: rota.tipo,
        intencao: rota.tipo === 'llm' ? rota.intencao : rota.intencao,
        passo: rota.tipo === 'programatico' ? rota.passo : undefined,
        cenario: rota.tipo === 'llm' ? rota.cenario : undefined,
      },
      Date.now() - t0,
    );

    logEvento('debounce', 'Roteamento', {
      telefone: numero,
      intencao: rota.tipo === 'llm' ? rota.intencao : rota.intencao,
      tipo: rota.tipo,
    });

    if (rota.tipo === 'silencio') {
      logEvento('debounce', 'Silêncio — motorista encerrou sem necessidade de resposta', {
        telefone: numero,
        motivo: rota.motivo,
        texto: textoUsuario.slice(0, 80),
      });
      await finalizarTrace(traceId, { status: 'silencio', resposta: '(silêncio)' });
      return;
    }

    let resposta: string;
    let enviarUmaBolha = false;
    const tGen = Date.now();

    if (rota.tipo === 'programatico') {
      resposta = rota.textoComFerramentas;
      enviarUmaBolha = rota.fragmentar === false;
      if (rota.executarFerramentas) {
        resposta = await processarFerramentas(resposta, { remoteJid, instance, itens });
      } else {
        resposta = rota.resposta;
      }
      logEvento('debounce', 'Resposta programática', {
        telefone: numero,
        intencao: rota.intencao,
        passo: rota.passo,
        texto: resposta.slice(0, 80),
      });
      await adicionarEtapa(
        traceId,
        'geracao',
        'Resposta programática (sem LLM)',
        { passo: rota.passo, intencao: rota.intencao, preview: resposta.slice(0, 120) },
        Date.now() - tGen,
      );
    } else {
      const midias = itens
        .filter((i) => i.midiaId)
        .map((i) => `midia_id=${i.midiaId} (${i.fileName ?? i.tipo})`)
        .join(', ');

      const promptCompleto = await montarPromptSistemaInferencia({
        telefone: numero,
        nomeContato: pushName,
        mensagemUsuario: textoUsuario,
        historico: historicoSemAtual,
        memoriaConversa: memoriaExtra,
        anexosLote: midias || undefined,
      });

      const midiaId = itens.find((i) => i.midiaId)?.midiaId;

      if (deveUsarConversaRapida(rota)) {
        const respostaBruta = await gerarConversaRapida({
          promptCompleto,
          mensagensUsuario: mensagens,
          historico: historicoSemAtual,
          cenario: rota.cenario,
          intencaoRoteador: rota.intencao,
        });
        logEvento('debounce', 'Conversa rápida (1 passada LLM)', {
          telefone: numero,
          cenario: rota.cenario ?? 6,
          roteador: rota.intencao,
          texto: respostaBruta.slice(0, 120),
        });
        await adicionarEtapa(
          traceId,
          'geracao',
          'Conversa rápida — 1 passada LLM',
          { cenario: rota.cenario ?? 6, preview: respostaBruta.slice(0, 120) },
          Date.now() - tGen,
        );
        resposta = await processarFerramentas(respostaBruta, { remoteJid, instance, itens });
      } else {
        const promptSistema =
          rota.cenario !== undefined
            ? await montarPromptCompactoPassadas(promptCompleto, {
                cenario: `CENÁRIO ${rota.cenario}`,
                ferramentas: [],
                observacoes: `roteador:${rota.intencao}`,
              })
            : promptCompleto;

        const { texto: respostaBruta, plano, passadas, analise, cadeiaPensamento } =
          await gerarRespostaRefinada(
            promptSistema,
            mensagens,
            historicoSemAtual,
            { telefone: numero, midiaId },
          );
        logEvento('debounce', 'Inferência refinada', {
          telefone: numero,
          cenario: plano.cenario,
          ferramentas: plano.ferramentas,
          passadas,
          roteador: rota.intencao,
          intencao: analise?.intencao_provavel,
          ambiguo: analise?.ambiguo,
          cadeiaPensamento: cadeiaPensamento?.map((c) => ({
            etapa: c.etapa,
            aprovado: c.aprovado,
            raciocinio: c.raciocinio,
          })),
        });
        await adicionarEtapa(
          traceId,
          'geracao',
          `Inferência refinada — ${passadas} passada(s)`,
          {
            cenario: plano.cenario,
            passadas,
            ferramentas: plano.ferramentas,
            preview: respostaBruta.slice(0, 120),
          },
          Date.now() - tGen,
        );

        let respostaFinal = respostaBruta;
        if (assuntoDisponibilidadeProvavel(rota, analise)) {
          const consenso = await resolverDisponibilidadeComRedundancia({
            historico: historicoSemAtual,
            mensagemAtual: mensagens.join('\n\n'),
          });
          if (consenso?.assuntoDisponibilidade) {
            const msgsFluxo = await obterConfigMensagensFluxo();
            const proximoCampo = consenso.faltando[0];
            if (proximoCampo === 'status') {
              respostaFinal = msgsFluxo.c7_pergunta_status;
            } else if (proximoCampo === 'localizacao_atual') {
              respostaFinal =
                consenso.status === 'carregado'
                  ? msgsFluxo.c7_pergunta_local_atual_carregado
                  : msgsFluxo.c7_pede_localizacao;
            } else if (proximoCampo === 'data_previsao_disponibilidade') {
              respostaFinal = msgsFluxo.c7_pergunta_data;
            } else if (proximoCampo === 'local_disponibilidade') {
              respostaFinal = msgsFluxo.c7_pergunta_local_disponibilidade;
            } else if (
              consenso.status !== 'indefinido' &&
              consenso.localizacaoAtual &&
              (consenso.status === 'disponivel' ||
                (consenso.status === 'indisponivel' &&
                  consenso.dataPrevisaoDisponibilidade &&
                  consenso.localDisponibilidade) ||
                (consenso.status === 'carregado' &&
                  consenso.dataPrevisaoDisponibilidade &&
                  consenso.localDisponibilidade))
            ) {
              const bloco = serializarBlocoFerramenta('registrar_disponibilidade', {
                telefone: numero,
                disponivel: consenso.disponivel,
                status: consenso.status,
                localizacao_atual: consenso.localizacaoAtual,
                local_disponibilidade:
                  consenso.status === 'disponivel'
                    ? undefined
                    : consenso.localDisponibilidade ?? consenso.localizacaoAtual,
                data_previsao_disponibilidade:
                  consenso.status === 'disponivel'
                    ? undefined
                    : consenso.dataPrevisaoDisponibilidade,
              });
              respostaFinal = `${msgsFluxo.c7_fechamento}\n${bloco}`;
            }
            await adicionarEtapa(
              traceId,
              'auditoria_disponibilidade',
              'Consenso GLM + Fable aplicado',
              {
                status: consenso.status,
                faltando: consenso.faltando,
                confianca: consenso.confianca,
                localizacaoAtual: consenso.localizacaoAtual,
                localDisponibilidade: consenso.localDisponibilidade,
              },
              0,
            );
          }
        }

        resposta = normalizarRespostaWhatsapp(respostaFinal);
        resposta = await processarFerramentas(resposta, { remoteJid, instance, itens });

        if (analise?.intencao_provavel) {
          void registrarIntencaoWhatsapp(numero, analise.intencao_provavel, {
            ambiguo: analise.ambiguo,
            notas: analise.notas,
          });
        }
      }
    }

    const tEnv = Date.now();
    const envio = await tentarEnviarResposta(numero, resposta, instance, {
      remoteJid,
      mensagensEntrada: mensagens.length,
      origem,
      fragmentar: enviarUmaBolha ? false : undefined,
      agendarAtrasoInicial: false,
    });

    // #region debug-point D:send-finished
    fetch('http://2.24.201.28:7778/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'whatsapp-delay-response',runId:'pre-fix',hypothesisId:'D',location:'debounce.ts:399',msg:'[DEBUG] envio da resposta foi concluido',data:{traceId,telefone:numero,remoteJid,enviado:envio.enviado,pendente:envio.pendente,fragmentos:envio.fragmentos,motivo:envio.motivo ?? null,filaId:envio.filaId ?? null,tempoTotalMs:Date.now()-t0,respostaPreview:resposta.slice(0,160)},ts:Date.now()})}).catch(()=>{});
    // #endregion

    await adicionarEtapa(
      traceId,
      'envio',
      envio.enviado
        ? 'Enviado ao WhatsApp'
        : envio.agendado
          ? 'Resposta agendada com atraso persistido'
          : 'Enfileirado / teste',
      {
        fragmentos: envio.fragmentos,
        motivo: envio.motivo,
        pendente: envio.pendente,
        agendado: envio.agendado,
      },
      Date.now() - tEnv,
    );

    if (envio.enviado) {
      await adicionarAoHistorico(remoteJid, 'assistant', resposta);
      logEvento('debounce', 'Resposta enviada', {
        telefone: numero,
        fragmentos: envio.fragmentos,
      });
      await finalizarTrace(traceId, { status: 'ok', resposta });
    } else {
      logEvento(
        'debounce',
        envio.agendado ? 'Resposta agendada com atraso persistido' : 'Resposta na fila (canal indisponível)',
        {
          telefone: numero,
          motivo: envio.motivo,
          filaId: envio.filaId,
          fragmentos: envio.fragmentos,
          agendado: envio.agendado,
        },
        envio.agendado ? 'info' : 'warn',
      );
      await finalizarTrace(traceId, { status: 'ok', resposta });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvento(
      'debounce',
      'Erro ao processar lote',
      { telefone: numero, erro: msg },
      'error',
    );
    await finalizarTrace(traceId, { status: 'erro', erro: msg });
    const fallback =
      'Desculpe, tive um problema ao processar sua mensagem, tente novamente em instantes';
    await tentarEnviarResposta(numero, fallback, instance, {
      remoteJid,
      mensagensEntrada: mensagens.length,
      origem,
      agendarAtrasoInicial: false,
    });
  } finally {
    pararDigitando(remoteJid);
  }
}

export async function simularDebounce(
  telefone: string,
  mensagens: string[],
  pushName = 'Teste',
): Promise<{ remoteJid: string; enfileiradas: number }> {
  const remoteJid = telefoneParaJid(telefone);
  for (const conteudo of mensagens) {
    await adicionarAoDebounce({
      remoteJid,
      pushName,
      tipo: 'texto',
      conteudo,
      instance: config.evolutionInstance,
      timestamp: Date.now(),
      origem: 'teste',
    });
  }
  return { remoteJid, enfileiradas: mensagens.length };
}

export async function limparDebounceContato(remoteJid: string): Promise<number> {
  const chaveLista = `${PREFIXO_LISTA}${remoteJid}`;
  const chaveTimer = `${PREFIXO_TIMER}${remoteJid}`;
  const chaveLock = `${PREFIXO_LOCK}${remoteJid}`;
  const total = await redis.llen(chaveLista);
  await redis.del(chaveLista, chaveTimer, chaveLock);
  pararDigitando(remoteJid);
  return total;
}

export function iniciarWorkerDebounce(): void {
  setInterval(() => {
    processarDebounceExpirado().catch((err) =>
      console.error('[debounce] Worker erro:', err),
    );
  }, config.debounceWorkerMs);
  console.log(
    `[debounce] Worker iniciado (intervalo ${config.debounceWorkerMs}ms, debounce ${config.debounceMs}ms)`,
  );
}

export async function verificarRedis(): Promise<boolean> {
  return pingRedis();
}

export { redis };
