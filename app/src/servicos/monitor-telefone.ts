/**
 * Estado operacional em tempo real por telefone para o painel de monitoramento.
 */
import { obterRedis } from '../lib/redis.js';
import { normalizarTelefone } from '../util/telefone.js';

const redis = obterRedis();
const PREFIXO = 'monitor:telefone:';
const TTL_SEGUNDOS = 6 * 60 * 60;

export type FaseMonitorTelefone =
  | 'aguardando_atraso_inicial'
  | 'pausa_fragmento'
  | 'digitando'
  | 'enviando'
  | 'fila_pendente'
  | 'concluido'
  | 'erro';

export interface EstadoMonitorTelefone {
  telefone: string;
  fase: FaseMonitorTelefone;
  mensagem: string;
  atualizadoEmMs: number;
  desdeMs?: number;
  ateMs?: number;
  sorteadoMs?: number;
  fragmentoAtual?: number;
  totalFragmentos?: number;
  detalhe?: string;
}

function chave(telefone: string): string {
  return `${PREFIXO}${normalizarTelefone(telefone)}`;
}

export async function salvarEstadoMonitorTelefone(
  telefone: string,
  estado: Omit<EstadoMonitorTelefone, 'telefone' | 'atualizadoEmMs'>,
): Promise<void> {
  const normalizado = normalizarTelefone(telefone);
  const payload: EstadoMonitorTelefone = {
    telefone: normalizado,
    atualizadoEmMs: Date.now(),
    ...estado,
  };
  await redis.set(chave(normalizado), JSON.stringify(payload), 'EX', TTL_SEGUNDOS);
}

export async function obterEstadoMonitorTelefone(
  telefone: string,
): Promise<EstadoMonitorTelefone | null> {
  const raw = await redis.get(chave(telefone));
  if (!raw) return null;
  return JSON.parse(raw) as EstadoMonitorTelefone;
}

export async function limparEstadoMonitorTelefone(telefone: string): Promise<void> {
  await redis.del(chave(telefone));
}
