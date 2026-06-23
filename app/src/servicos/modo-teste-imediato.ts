/**
 * Controle temporário de contatos em modo de teste imediato.
 * Evita debounce/humanização durante jornadas iniciadas manualmente.
 * Usa Redis com TTL para não contaminar produção por muito tempo.
 */
import { obterRedis } from '../lib/redis.js';
import { normalizarTelefone } from '../util/telefone.js';

const redis = obterRedis();
const PREFIXO = 'teste:modo_imediato:';
const TTL_PADRAO_SEGUNDOS = 6 * 60 * 60;

function chave(telefone: string): string {
  return `${PREFIXO}${normalizarTelefone(telefone)}`;
}

export async function ativarModoTesteImediato(
  telefone: string,
  ttlSegundos = TTL_PADRAO_SEGUNDOS,
): Promise<void> {
  await redis.set(chave(telefone), '1', 'EX', ttlSegundos);
}

export async function contatoEmModoTesteImediato(telefone: string): Promise<boolean> {
  return (await redis.get(chave(telefone))) === '1';
}
