/**
 * Fila de respostas pendentes quando o canal WhatsApp não está disponível.
 */
import { obterRedis } from '../lib/redis.js';
import { config } from '../config.js';
import { normalizarTelefone } from '../util/telefone.js';
import { logEvento } from '../util/log-eventos.js';

const redis = obterRedis();
const PREFIXO = 'fila:resposta:';
const LISTA_GLOBAL = 'fila:resposta:ids';

export interface RespostaPendente {
  id: string;
  telefone: string;
  remoteJid: string;
  texto: string;
  criadoEm: number;
  motivo: string;
  mensagensEntrada: number;
  origem?: 'evolution' | 'teste';
  agendadoPara?: number;
  fragmentar?: boolean;
  tipoFila?: 'canal_indisponivel' | 'atraso_humanizado' | 'falha_envio';
}

export async function enfileirarResposta(
  dados: Omit<RespostaPendente, 'id' | 'criadoEm'>,
): Promise<string> {
  if (dados.origem === 'teste') {
    logEvento('fila', 'Resposta de teste — não enfileirada', { telefone: dados.telefone }, 'debug');
    return 'teste_sem_fila';
  }

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const item: RespostaPendente = { ...dados, id, criadoEm: Date.now() };
  const telefone = normalizarTelefone(dados.telefone);
  await redis.set(`${PREFIXO}${id}`, JSON.stringify(item), 'EX', config.filaRespostaTtlSegundos);
  await redis.lpush(`${PREFIXO}tel:${telefone}`, id);
  await redis.ltrim(`${PREFIXO}tel:${telefone}`, 0, 9);
  await redis.lpush(LISTA_GLOBAL, id);
  await redis.ltrim(LISTA_GLOBAL, 0, 49);
  console.log(
    `[fila] Resposta pendente ${id} para ${telefone}: ${dados.motivo}${dados.agendadoPara ? ` (agendada para ${new Date(dados.agendadoPara).toISOString()})` : ''}`,
  );
  return id;
}

export async function listarRespostasPendentes(limite = 30): Promise<RespostaPendente[]> {
  const ids = await redis.lrange(LISTA_GLOBAL, 0, limite - 1);
  const itens: RespostaPendente[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${PREFIXO}${id}`);
    if (raw) itens.push(JSON.parse(raw) as RespostaPendente);
  }
  return itens;
}

export async function contarPendentes(): Promise<number> {
  return redis.llen(LISTA_GLOBAL);
}

export async function removerRespostaPendente(id: string, telefone: string): Promise<void> {
  const tel = normalizarTelefone(telefone);
  await redis.del(`${PREFIXO}${id}`);
  const ids = await redis.lrange(`${PREFIXO}tel:${tel}`, 0, -1);
  const filtrados = ids.filter((i) => i !== id);
  if (filtrados.length === 0) {
    await redis.del(`${PREFIXO}tel:${tel}`);
  } else {
    await redis.del(`${PREFIXO}tel:${tel}`);
    for (const i of filtrados.reverse()) {
      await redis.lpush(`${PREFIXO}tel:${tel}`, i);
    }
  }
  const globais = await redis.lrange(LISTA_GLOBAL, 0, -1);
  const restantes = globais.filter((i) => i !== id);
  await redis.del(LISTA_GLOBAL);
  if (restantes.length > 0) {
    for (const i of restantes.reverse()) {
      await redis.lpush(LISTA_GLOBAL, i);
    }
  }
}

/** Remove todas as respostas pendentes (incidente / manutenção). */
export async function limparTodaFila(): Promise<number> {
  const ids = await redis.lrange(LISTA_GLOBAL, 0, -1);
  let removidos = 0;
  for (const id of ids) {
    const raw = await redis.get(`${PREFIXO}${id}`);
    if (!raw) continue;
    const item = JSON.parse(raw) as RespostaPendente;
    await removerRespostaPendente(id, item.telefone);
    removidos++;
  }
  await redis.del(LISTA_GLOBAL);
  return removidos;
}

export async function limparFilaPorTelefone(telefone: string): Promise<number> {
  const tel = normalizarTelefone(telefone);
  const ids = await redis.lrange(`${PREFIXO}tel:${tel}`, 0, -1);
  let removidos = 0;
  for (const id of ids) {
    await removerRespostaPendente(id, tel);
    removidos++;
  }
  return removidos;
}

/** Descarta itens expirados por idade (não envia — evita mensagem fora de contexto). */
export async function descartarRespostasAntigas(
  maxIdadeMs = config.filaRespostaMaxIdadeMs,
): Promise<number> {
  const pendentes = await listarRespostasPendentes(100);
  const agora = Date.now();
  let descartados = 0;
  for (const item of pendentes) {
    if (agora - item.criadoEm <= maxIdadeMs) continue;
    await removerRespostaPendente(item.id, item.telefone);
    descartados++;
    logEvento(
      'fila',
      'Resposta pendente descartada (expirada)',
      {
        telefone: item.telefone,
        id: item.id,
        idadeMin: Math.round((agora - item.criadoEm) / 60_000),
        texto: item.texto.slice(0, 60),
      },
      'warn',
    );
  }
  return descartados;
}
