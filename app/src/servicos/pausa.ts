/**
 * Controle de pausa da IA — por contato ou global.
 */
import { obterRedis } from '../lib/redis.js';
import { normalizarTelefone } from '../util/telefone.js';
import { sincronizarPausaIaErp } from './erp-atendimento-motorista.js';
import { config } from '../config.js';

const redis = obterRedis();
const CHAVE_GLOBAL = 'pausa:global';
const CHAVE_MODO_GLOBAL = 'pausa:modo_global';
const PREFIXO_CONTATO = 'pausa:contato:';
const PREFIXO_CONTATO_ATIVO = 'pausa:contato_ativo:';

export type ModoGlobalIa = 'default_on' | 'default_off';

export interface StatusPausa {
  global: boolean;
  globalMotivo?: string;
  modoGlobal: ModoGlobalIa;
  contatos: Array<{ telefone: string; motivo?: string }>;
  contatosAtivos: Array<{ telefone: string }>;
}

export async function pausaGlobalAtiva(): Promise<boolean> {
  return (await obterModoGlobalIa()) === 'default_off';
}

export async function obterModoGlobalIa(): Promise<ModoGlobalIa> {
  const salvo = await redis.get(CHAVE_MODO_GLOBAL);
  if (salvo === 'default_on' || salvo === 'default_off') return salvo;
  return config.iaGlobalDefaultOff ? 'default_off' : 'default_on';
}

export async function pausarGlobal(motivo?: string): Promise<void> {
  await redis.set(CHAVE_GLOBAL, '1');
  await redis.set(CHAVE_MODO_GLOBAL, 'default_off');
  if (motivo) await redis.set(`${CHAVE_GLOBAL}:motivo`, motivo);
}

export async function despausarGlobal(): Promise<void> {
  await redis.set(CHAVE_MODO_GLOBAL, 'default_on');
  await redis.del(CHAVE_GLOBAL, `${CHAVE_GLOBAL}:motivo`);
}

export async function pausarContato(telefone: string, motivo?: string): Promise<void> {
  const n = normalizarTelefone(telefone);
  await redis.set(`${PREFIXO_CONTATO}${n}`, '1', 'EX', 86400 * 30);
  await redis.del(`${PREFIXO_CONTATO_ATIVO}${n}`);
  if (motivo) await redis.set(`${PREFIXO_CONTATO}${n}:motivo`, motivo, 'EX', 86400 * 30);
  await sincronizarPausaIaErp(n, true, motivo);
}

export async function despausarContato(telefone: string): Promise<void> {
  const n = normalizarTelefone(telefone);
  await redis.del(`${PREFIXO_CONTATO}${n}`, `${PREFIXO_CONTATO}${n}:motivo`);
  if ((await obterModoGlobalIa()) === 'default_off') {
    await redis.set(`${PREFIXO_CONTATO_ATIVO}${n}`, '1', 'EX', 86400 * 30);
  } else {
    await redis.del(`${PREFIXO_CONTATO_ATIVO}${n}`);
  }
  await sincronizarPausaIaErp(n, false);
}

export async function contatoPausado(telefone: string): Promise<boolean> {
  const n = normalizarTelefone(telefone);
  return (await redis.get(`${PREFIXO_CONTATO}${n}`)) === '1';
}

export async function contatoAtivadoIndividualmente(telefone: string): Promise<boolean> {
  const n = normalizarTelefone(telefone);
  return (await redis.get(`${PREFIXO_CONTATO_ATIVO}${n}`)) === '1';
}

/** Verifica se a IA pode responder para este telefone */
export async function iaPodeResponder(telefone: string): Promise<boolean> {
  if (await contatoPausado(telefone)) return false;
  if ((await obterModoGlobalIa()) === 'default_off') {
    return contatoAtivadoIndividualmente(telefone);
  }
  return true;
}

export async function obterStatusPausa(): Promise<StatusPausa> {
  const modoGlobal = await obterModoGlobalIa();
  const global = modoGlobal === 'default_off';
  const globalMotivo = global ? (await redis.get(`${CHAVE_GLOBAL}:motivo`)) ?? undefined : undefined;

  const chaves = await redis.keys(`${PREFIXO_CONTATO}*`);
  const contatos: StatusPausa['contatos'] = [];
  for (const chave of chaves) {
    if (chave.endsWith(':motivo')) continue;
    const telefone = chave.replace(PREFIXO_CONTATO, '');
    if (!/^\d+$/.test(telefone)) continue;
    const motivo = (await redis.get(`${chave}:motivo`)) ?? undefined;
    contatos.push({ telefone, motivo });
  }

  const chavesAtivos = await redis.keys(`${PREFIXO_CONTATO_ATIVO}*`);
  const contatosAtivos: StatusPausa['contatosAtivos'] = [];
  for (const chave of chavesAtivos) {
    const telefone = chave.replace(PREFIXO_CONTATO_ATIVO, '');
    if (!/^\d+$/.test(telefone)) continue;
    contatosAtivos.push({ telefone });
  }

  return { global, globalMotivo, modoGlobal, contatos, contatosAtivos };
}
