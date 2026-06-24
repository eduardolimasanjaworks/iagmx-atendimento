/**
 * Regras de unicidade entre motorista e embarque.
 * Garante que um motorista nao fique preso a dois embarques ativos.
 * Garante que um embarque nao aponte para motoristas diferentes ao mesmo tempo.
 */
import { directusListar } from './directus.js';

export interface EmbarqueVinculoResumo {
  id: number | string;
  status?: string | null;
  rota_status?: string | null;
  driver_id?: number | string | null;
  accepted_motorista_id?: number | string | null;
  oferta_motorista_id?: number | string | null;
}

const STATUS_ATIVO = [
  'new',
  'needs_attention',
  'sent',
  'waiting_confirmation',
  'confirmed',
  'in_transit',
  'waiting_receipt',
];

function numeroOpcional(valor: unknown): number | null {
  const num = Number(valor);
  return Number.isFinite(num) ? num : null;
}

function idsMotoristasRelacionados(item: EmbarqueVinculoResumo | null): number[] {
  if (!item) return [];
  return Array.from(
    new Set(
      [
        numeroOpcional(item.driver_id),
        numeroOpcional(item.accepted_motorista_id),
        numeroOpcional(item.oferta_motorista_id),
      ].filter((valor): valor is number => valor != null),
    ),
  );
}

function deduplicarPorId(lista: EmbarqueVinculoResumo[]): EmbarqueVinculoResumo[] {
  const vistos = new Set<string>();
  return lista.filter((item) => {
    const chave = String(item.id);
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

async function listarPorCampo(
  campo: 'driver_id' | 'accepted_motorista_id' | 'oferta_motorista_id',
  motoristaId: number,
): Promise<EmbarqueVinculoResumo[]> {
  return directusListar<EmbarqueVinculoResumo>('embarques', {
    [`filter[${campo}][_eq]`]: String(motoristaId),
    'filter[status][_in]': STATUS_ATIVO.join(','),
    sort: '-date_updated,-date_created',
    limit: '10',
    fields: 'id,status,rota_status,driver_id,accepted_motorista_id,oferta_motorista_id',
  }).catch(() => []);
}

export async function buscarResumoVinculoEmbarque(
  embarqueId: number | string,
): Promise<EmbarqueVinculoResumo | null> {
  const itens = await directusListar<EmbarqueVinculoResumo>('embarques', {
    'filter[id][_eq]': String(embarqueId),
    limit: '1',
    fields: 'id,status,rota_status,driver_id,accepted_motorista_id,oferta_motorista_id',
  }).catch(() => []);
  return itens[0] ?? null;
}

export async function listarEmbarquesAtivosDoMotorista(
  motoristaId: number,
): Promise<EmbarqueVinculoResumo[]> {
  const [porDriver, porAceite, porOferta] = await Promise.all([
    listarPorCampo('driver_id', motoristaId),
    listarPorCampo('accepted_motorista_id', motoristaId),
    listarPorCampo('oferta_motorista_id', motoristaId),
  ]);
  return deduplicarPorId([...porDriver, ...porAceite, ...porOferta]);
}

export async function validarVinculoUnicoMotoristaEmbarque(opts: {
  embarqueId: number | string;
  motoristaId: number | string;
}): Promise<void> {
  const embarqueId = String(opts.embarqueId);
  const motoristaId = numeroOpcional(opts.motoristaId);
  if (motoristaId == null) {
    throw new Error(`motorista_invalido:${String(opts.motoristaId)}`);
  }

  const embarque = await buscarResumoVinculoEmbarque(embarqueId);
  const idsNoEmbarque = idsMotoristasRelacionados(embarque);
  const motoristaConflitante = idsNoEmbarque.find((id) => id !== motoristaId);
  if (motoristaConflitante != null) {
    throw new Error(
      `embarque_ja_vinculado_outro_motorista:embarque=${embarqueId}:motorista_atual=${motoristaConflitante}:motorista_tentado=${motoristaId}`,
    );
  }

  const ativos = await listarEmbarquesAtivosDoMotorista(motoristaId);
  const conflito = ativos.find((item) => String(item.id) !== embarqueId);
  if (conflito) {
    throw new Error(
      `motorista_ja_vinculado_outro_embarque:motorista=${motoristaId}:embarque_atual=${String(conflito.id)}:embarque_tentado=${embarqueId}`,
    );
  }
}
