/**
 * Rastreamento visível do pipeline de mensagens (Redis).
 */
import { randomUUID } from 'node:crypto';
import { obterRedis } from '../lib/redis.js';

const redis = obterRedis();
const LISTA = 'pipeline:traces';
const PREFIXO = 'pipeline:trace:';
const MAX_TRACES = 80;
const TTL_SEG = 86400;

export type StatusTrace = 'processando' | 'ok' | 'silencio' | 'erro' | 'enfileirado';

export interface EtapaTrace {
  ordem: number;
  etapa: string;
  rotulo: string;
  ts: number;
  duracaoMs?: number;
  detalhe?: Record<string, unknown>;
}

export interface TracePipeline {
  id: string;
  telefone: string;
  remoteJid: string;
  entrada: string;
  tipos: string[];
  inicioMs: number;
  fimMs?: number;
  status: StatusTrace;
  etapas: EtapaTrace[];
  resposta?: string;
  erro?: string;
}

function chave(id: string): string {
  return `${PREFIXO}${id}`;
}

async function persistir(trace: TracePipeline): Promise<void> {
  await redis.set(chave(trace.id), JSON.stringify(trace), 'EX', TTL_SEG);
  await redis.lrem(LISTA, 0, trace.id);
  await redis.lpush(LISTA, trace.id);
  await redis.ltrim(LISTA, 0, MAX_TRACES - 1);
}

export async function iniciarTrace(opts: {
  telefone: string;
  remoteJid: string;
  entrada: string;
  tipos: string[];
  debounceAguardouMs?: number;
}): Promise<string> {
  const id = randomUUID().slice(0, 8);
  const trace: TracePipeline = {
    id,
    telefone: opts.telefone,
    remoteJid: opts.remoteJid,
    entrada: opts.entrada.slice(0, 500),
    tipos: opts.tipos,
    inicioMs: Date.now(),
    status: 'processando',
    etapas: [],
  };
  if (opts.debounceAguardouMs !== undefined) {
    trace.etapas.push({
      ordem: 1,
      etapa: 'debounce',
      rotulo: 'Aguardou motorista parar de digitar',
      ts: Date.now(),
      duracaoMs: opts.debounceAguardouMs,
      detalhe: { debounceMs: opts.debounceAguardouMs },
    });
  }
  await persistir(trace);
  return id;
}

export async function registrarEnfileiramento(opts: {
  telefone: string;
  remoteJid: string;
  entrada: string;
  tipo: string;
}): Promise<string> {
  const id = randomUUID().slice(0, 8);
  const trace: TracePipeline = {
    id,
    telefone: opts.telefone,
    remoteJid: opts.remoteJid,
    entrada: opts.entrada.slice(0, 500),
    tipos: [opts.tipo],
    inicioMs: Date.now(),
    status: 'enfileirado',
    etapas: [
      {
        ordem: 1,
        etapa: 'webhook',
        rotulo: 'Mensagem recebida no WhatsApp',
        ts: Date.now(),
        detalhe: { tipo: opts.tipo },
      },
    ],
  };
  await persistir(trace);
  return id;
}

export async function vincularTraceEnfileirado(
  remoteJid: string,
  traceId: string,
): Promise<void> {
  await redis.set(`pipeline:ativo:${remoteJid}`, traceId, 'EX', 300);
}

export async function obterTraceIdAtivo(remoteJid: string): Promise<string | null> {
  return redis.get(`pipeline:ativo:${remoteJid}`);
}

export async function adicionarEtapa(
  id: string,
  etapa: string,
  rotulo: string,
  detalhe?: Record<string, unknown>,
  duracaoMs?: number,
): Promise<void> {
  const raw = await redis.get(chave(id));
  if (!raw) return;
  const trace = JSON.parse(raw) as TracePipeline;
  trace.etapas.push({
    ordem: trace.etapas.length + 1,
    etapa,
    rotulo,
    ts: Date.now(),
    duracaoMs,
    detalhe,
  });
  if (trace.status === 'enfileirado') trace.status = 'processando';
  await persistir(trace);
}

export async function finalizarTrace(
  id: string,
  opts: {
    status: StatusTrace;
    resposta?: string;
    erro?: string;
  },
): Promise<void> {
  const raw = await redis.get(chave(id));
  if (!raw) return;
  const trace = JSON.parse(raw) as TracePipeline;
  trace.status = opts.status;
  trace.fimMs = Date.now();
  trace.resposta = opts.resposta?.slice(0, 500);
  trace.erro = opts.erro;
  await persistir(trace);
  await redis.del(`pipeline:ativo:${trace.remoteJid}`);
}

export async function listarTracesRecentes(limite = 30): Promise<TracePipeline[]> {
  const ids = await redis.lrange(LISTA, 0, limite - 1);
  const traces: TracePipeline[] = [];
  for (const id of ids) {
    const raw = await redis.get(chave(id));
    if (raw) traces.push(JSON.parse(raw) as TracePipeline);
  }
  return traces;
}

export async function obterTrace(id: string): Promise<TracePipeline | null> {
  const raw = await redis.get(chave(id));
  return raw ? (JSON.parse(raw) as TracePipeline) : null;
}

export async function limparTracesContato(remoteJid: string): Promise<number> {
  const ids = await redis.lrange(LISTA, 0, -1);
  const manter: string[] = [];
  let removidos = 0;

  for (const id of ids) {
    const raw = await redis.get(chave(id));
    if (!raw) continue;
    const trace = JSON.parse(raw) as TracePipeline;
    if (trace.remoteJid === remoteJid) {
      await redis.del(chave(id));
      removidos++;
      continue;
    }
    manter.push(id);
  }

  await redis.del(LISTA);
  for (const id of manter.reverse()) {
    await redis.lpush(LISTA, id);
  }
  await redis.del(`pipeline:ativo:${remoteJid}`);
  return removidos;
}
