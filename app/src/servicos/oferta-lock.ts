/**
 * Locks de oferta por telefone para evitar concorrencia real.
 * O mesmo motorista nao pode ficar preso em dois embarques ao mesmo tempo.
 * O payload fica em Redis para auditoria e liberacao segura.
 */
import { obterRedis } from '../lib/redis.js';
import { normalizarTelefone } from '../util/telefone.js';

const redis = obterRedis();
const PREFIXO = 'oferta:ativa:telefone:';
const TTL_SEGUNDOS = 12 * 60 * 60;

export interface OfertaLockPayload {
  telefone: string;
  embarque_id: string;
  motorista_id?: string | null;
  criado_em: string;
  origem?: string | null;
  destino?: string | null;
}

function chave(telefone: string): string {
  return `${PREFIXO}${normalizarTelefone(telefone)}`;
}

export async function obterLockOfertaPorTelefone(
  telefone: string,
): Promise<OfertaLockPayload | null> {
  const raw = await redis.get(chave(telefone)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OfertaLockPayload;
  } catch {
    return null;
  }
}

export async function adquirirLockOferta(opts: {
  telefone: string;
  embarqueId: number | string;
  motoristaId?: number | string | null;
  origem?: string | null;
  destino?: string | null;
}): Promise<{ ok: boolean; atual?: OfertaLockPayload | null }> {
  const telefone = normalizarTelefone(opts.telefone);
  const embarqueId = String(opts.embarqueId);
  const atual = await obterLockOfertaPorTelefone(telefone);

  if (atual?.embarque_id === embarqueId) {
    await renovarLockOferta(telefone);
    return { ok: true, atual };
  }
  if (atual) {
    return { ok: false, atual };
  }

  const payload: OfertaLockPayload = {
    telefone,
    embarque_id: embarqueId,
    motorista_id: opts.motoristaId != null ? String(opts.motoristaId) : null,
    criado_em: new Date().toISOString(),
    origem: opts.origem ?? null,
    destino: opts.destino ?? null,
  };

  const ok = await redis
    .set(chave(telefone), JSON.stringify(payload), 'EX', TTL_SEGUNDOS, 'NX')
    .catch(() => null);
  if (ok === 'OK') {
    return { ok: true, atual: payload };
  }
  return { ok: false, atual: await obterLockOfertaPorTelefone(telefone) };
}

export async function renovarLockOferta(telefone: string): Promise<void> {
  await redis.expire(chave(telefone), TTL_SEGUNDOS).catch(() => undefined);
}

export async function liberarLockOfertaPorTelefone(telefone: string): Promise<void> {
  await redis.del(chave(telefone)).catch(() => undefined);
}
