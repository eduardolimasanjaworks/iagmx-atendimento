import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { obterRedis } from '../lib/redis.js';
import {
  listarTracesRecentes,
  type StatusTrace,
  type TracePipeline,
} from './trace-pipeline.js';

const redis = obterRedis();
const PREFIXO = 'pipeline:autoavaliacao:';
const LISTA = 'pipeline:autoavaliacoes';
const TTL_SEG = 7 * 24 * 60 * 60;
const MAX_RELATORIOS = 20;

export interface ExemploAutoavaliacao {
  traceId: string;
  status: StatusTrace;
  entrada: string;
  etapaFinal: string;
  duracaoMs: number | null;
}

export interface SinalAutoavaliacao {
  id: string;
  severidade: 'alta' | 'media' | 'baixa';
  titulo: string;
  descricao: string;
  quantidade: number;
  exemplos: ExemploAutoavaliacao[];
}

export interface RelatorioAutoavaliacaoConversas {
  id: string;
  geradoEm: string;
  buildId: string;
  limiteTraces: number;
  totalTraces: number;
  metricas: {
    erros: number;
    silencios: number;
    enfileirados: number;
    lentos: number;
    duracaoMediaMs: number;
  };
  gargalos: Array<{ etapa: string; quantidade: number }>;
  sinais: SinalAutoavaliacao[];
  recomendacoes: string[];
  resumo: string;
}

function chave(id: string): string {
  return `${PREFIXO}${id}`;
}

function normalizar(texto: string): string {
  return texto.trim().toLowerCase().replace(/\s+/g, ' ');
}

function duracaoTrace(trace: TracePipeline): number | null {
  if (typeof trace.fimMs !== 'number') return null;
  return Math.max(0, trace.fimMs - trace.inicioMs);
}

function etapaFinal(trace: TracePipeline): string {
  return trace.etapas[trace.etapas.length - 1]?.etapa ?? 'sem_etapa';
}

function exemplo(trace: TracePipeline): ExemploAutoavaliacao {
  return {
    traceId: trace.id,
    status: trace.status,
    entrada: trace.entrada,
    etapaFinal: etapaFinal(trace),
    duracaoMs: duracaoTrace(trace),
  };
}

function taxa(parte: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((parte / total) * 100)}%`;
}

function topGargalos(traces: TracePipeline[]): Array<{ etapa: string; quantidade: number }> {
  const mapa = new Map<string, number>();
  for (const trace of traces) {
    const etapa = etapaFinal(trace);
    mapa.set(etapa, (mapa.get(etapa) ?? 0) + 1);
  }
  return [...mapa.entries()]
    .map(([etapa, quantidade]) => ({ etapa, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 5);
}

function sinaisDeTraces(traces: TracePipeline[]): SinalAutoavaliacao[] {
  const sinais: SinalAutoavaliacao[] = [];
  const erros = traces.filter((trace) => trace.status === 'erro');
  const silencios = traces.filter((trace) => trace.status === 'silencio');
  const lentos = traces.filter((trace) => {
    const duracao = duracaoTrace(trace);
    return duracao !== null && duracao >= config.autoavaliacaoLentidaoMs;
  });
  const semResposta = traces.filter(
    (trace) => trace.status === 'ok' && !String(trace.resposta ?? '').trim(),
  );
  const disponibilidadeEspontanea = traces.filter((trace) =>
    /^(disponibilidade|quero disponibilidade)$/.test(normalizar(trace.entrada)),
  );

  if (disponibilidadeEspontanea.length) {
    sinais.push({
      id: 'disponibilidade_iniciada_motorista',
      severidade: 'alta',
      titulo: 'Ainda apareceu disponibilidade iniciada pelo motorista',
      descricao:
        'A GMX deveria iniciar esse fluxo. Se esse padrao aparecer de novo nos traces, existe regressao de roteamento, teste ou automacao externa',
      quantidade: disponibilidadeEspontanea.length,
      exemplos: disponibilidadeEspontanea.slice(0, 3).map(exemplo),
    });
  }

  if (erros.length) {
    sinais.push({
      id: 'erros_pipeline',
      severidade: 'alta',
      titulo: 'Ocorreram falhas no pipeline',
      descricao: `Erros em ${taxa(erros.length, traces.length)} dos traces avaliados`,
      quantidade: erros.length,
      exemplos: erros.slice(0, 3).map(exemplo),
    });
  }

  if (silencios.length) {
    sinais.push({
      id: 'silencios_relevantes',
      severidade: 'media',
      titulo: 'Houve conversas encerradas em silencio',
      descricao:
        'Nem todo silencio e ruim, mas esse volume merece revisao para separar encerramento valido de perda de oportunidade operacional',
      quantidade: silencios.length,
      exemplos: silencios.slice(0, 3).map(exemplo),
    });
  }

  if (lentos.length) {
    sinais.push({
      id: 'lentidao_pipeline',
      severidade: 'media',
      titulo: 'Alguns atendimentos ficaram lentos',
      descricao: `Traces acima de ${Math.round(config.autoavaliacaoLentidaoMs / 1000)}s de duracao total`,
      quantidade: lentos.length,
      exemplos: lentos.slice(0, 3).map(exemplo),
    });
  }

  if (semResposta.length) {
    sinais.push({
      id: 'ok_sem_resposta',
      severidade: 'baixa',
      titulo: 'Alguns traces terminaram como ok sem resposta visivel',
      descricao:
        'Vale revisar se houve enfileiramento, envio quebrado ou finalizacao otimista demais no rastreamento',
      quantidade: semResposta.length,
      exemplos: semResposta.slice(0, 3).map(exemplo),
    });
  }

  return sinais;
}

function recomendacoesDoRelatorio(
  traces: TracePipeline[],
  sinais: SinalAutoavaliacao[],
): string[] {
  const recomendacoes = new Set<string>();

  if (!traces.length) {
    recomendacoes.add('Gerar mais traces reais antes de confiar na autoavaliacao');
    return [...recomendacoes];
  }

  if (sinais.some((item) => item.id === 'disponibilidade_iniciada_motorista')) {
    recomendacoes.add(
      'Revisar qualquer teste, webhook auxiliar ou automacao externa que ainda envie "disponibilidade" como gatilho inicial do motorista',
    );
  }
  if (sinais.some((item) => item.id === 'erros_pipeline')) {
    recomendacoes.add(
      'Inspecionar os traces com status erro e priorizar a etapa final mais recorrente para reduzir falhas repetidas',
    );
  }
  if (sinais.some((item) => item.id === 'silencios_relevantes')) {
    recomendacoes.add(
      'Separar silencios validos de silencios ruins, principalmente em abordagens proativas e negociacoes abertas',
    );
  }
  if (sinais.some((item) => item.id === 'lentidao_pipeline')) {
    recomendacoes.add(
      'Medir onde o tempo esta sendo gasto entre roteamento, geracao e envio para encurtar o ciclo no WhatsApp',
    );
  }
  if (sinais.some((item) => item.id === 'ok_sem_resposta')) {
    recomendacoes.add(
      'Cruzar traces ok sem resposta com a fila de envio para evitar falso positivo de atendimento concluido',
    );
  }
  if (!recomendacoes.size) {
    recomendacoes.add(
      'Sem alerta forte neste recorte, seguir monitorando regressao de disponibilidade, erros e lentidao',
    );
  }
  return [...recomendacoes];
}

function resumoRelatorio(
  traces: TracePipeline[],
  sinais: SinalAutoavaliacao[],
  metricas: RelatorioAutoavaliacaoConversas['metricas'],
): string {
  if (!traces.length) {
    return 'Ainda nao existem traces suficientes para a IA se autoavaliar com confianca';
  }
  if (!sinais.length) {
    return `A IA revisou ${traces.length} traces recentes sem encontrar alerta forte, com duracao media de ${Math.round(metricas.duracaoMediaMs)} ms`;
  }
  const principal = sinais[0];
  return `A IA revisou ${traces.length} traces recentes e o principal alerta foi "${principal.titulo.toLowerCase()}", aparecendo ${principal.quantidade} vez(es)`;
}

async function persistir(relatorio: RelatorioAutoavaliacaoConversas): Promise<void> {
  await redis.set(chave(relatorio.id), JSON.stringify(relatorio), 'EX', TTL_SEG);
  await redis.lrem(LISTA, 0, relatorio.id);
  await redis.lpush(LISTA, relatorio.id);
  await redis.ltrim(LISTA, 0, MAX_RELATORIOS - 1);
}

export async function gerarAutoavaliacaoConversas(
  limite = config.autoavaliacaoMaxTraces,
): Promise<RelatorioAutoavaliacaoConversas> {
  const traces = await listarTracesRecentes(limite);
  const erros = traces.filter((trace) => trace.status === 'erro').length;
  const silencios = traces.filter((trace) => trace.status === 'silencio').length;
  const enfileirados = traces.filter((trace) => trace.status === 'enfileirado').length;
  const lentos = traces.filter((trace) => {
    const duracao = duracaoTrace(trace);
    return duracao !== null && duracao >= config.autoavaliacaoLentidaoMs;
  }).length;
  const duracoes = traces.map(duracaoTrace).filter((item): item is number => item !== null);
  const duracaoMediaMs = duracoes.length
    ? duracoes.reduce((acc, item) => acc + item, 0) / duracoes.length
    : 0;
  const sinais = sinaisDeTraces(traces);
  const relatorio: RelatorioAutoavaliacaoConversas = {
    id: randomUUID().slice(0, 8),
    geradoEm: new Date().toISOString(),
    buildId: config.buildId,
    limiteTraces: limite,
    totalTraces: traces.length,
    metricas: {
      erros,
      silencios,
      enfileirados,
      lentos,
      duracaoMediaMs,
    },
    gargalos: topGargalos(traces),
    sinais,
    recomendacoes: recomendacoesDoRelatorio(traces, sinais),
    resumo: resumoRelatorio(traces, sinais, {
      erros,
      silencios,
      enfileirados,
      lentos,
      duracaoMediaMs,
    }),
  };
  await persistir(relatorio);
  return relatorio;
}

export async function obterUltimaAutoavaliacaoConversas(): Promise<RelatorioAutoavaliacaoConversas | null> {
  const id = await redis.lindex(LISTA, 0);
  if (!id) return null;
  const raw = await redis.get(chave(id));
  return raw ? (JSON.parse(raw) as RelatorioAutoavaliacaoConversas) : null;
}
