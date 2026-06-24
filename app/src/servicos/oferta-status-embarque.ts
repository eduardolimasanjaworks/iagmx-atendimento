/**
 * Materializa no embarque o estado operacional da oferta.
 * Historico continua auditando eventos, mas o embarque passa a refletir o vivo.
 * Isso reduz divergencia entre simulacao, fluxo real e portal.
 */
import { directusListar, directusPatch } from './directus.js';

type EmbarqueOfertaResumo = {
  id: number | string;
  rejected_drivers_count?: number | string | null;
};

async function obterEmbarque(embarqueId: number | string): Promise<EmbarqueOfertaResumo | null> {
  const itens = await directusListar<EmbarqueOfertaResumo>('embarques', {
    'filter[id][_eq]': String(embarqueId),
    fields: 'id,rejected_drivers_count',
    limit: '1',
  }).catch(() => []);
  return itens[0] ?? null;
}

export async function marcarEmbarqueOfertado(opts: {
  embarqueId: number | string;
  motoristaId?: number | string | null;
  configRotaId?: number | string | null;
  valorOfertado?: number | null;
}): Promise<void> {
  await directusPatch('embarques', opts.embarqueId, {
    oferta_disparada_em: new Date().toISOString(),
    rota_status: 'ofertado',
    ultimo_evento_oferta_em: new Date().toISOString(),
    needs_manual_review: false,
    manual_review_completed: false,
    manual_review_owner: null,
    manual_review_at: null,
    manual_review_note: null,
    ...(opts.configRotaId != null ? { config_rota_id: Number(opts.configRotaId) } : {}),
    ...(opts.motoristaId != null ? { oferta_motorista_id: Number(opts.motoristaId) } : {}),
    ...(opts.valorOfertado != null ? { valor_ofertado: Number(opts.valorOfertado) } : {}),
  }).catch(() => undefined);
}

export async function marcarEmbarqueAceito(opts: {
  embarqueId: number | string;
  motoristaId?: number | string | null;
  valorAceito?: number | null;
}): Promise<void> {
  await directusPatch('embarques', opts.embarqueId, {
    rota_status: 'aceito',
    ultimo_evento_oferta_em: new Date().toISOString(),
    needs_manual_review: false,
    manual_review_completed: true,
    manual_review_at: new Date().toISOString(),
    manual_review_note: null,
    ...(opts.motoristaId != null ? { accepted_motorista_id: Number(opts.motoristaId) } : {}),
    ...(opts.motoristaId != null ? { oferta_motorista_id: Number(opts.motoristaId) } : {}),
    ...(opts.valorAceito != null ? { valor_aceito: Number(opts.valorAceito) } : {}),
  }).catch(() => undefined);
}

export async function marcarEmbarqueRecusado(opts: {
  embarqueId: number | string;
  limparMotorista?: boolean;
}): Promise<void> {
  const atual = await obterEmbarque(opts.embarqueId);
  const recusasAtuais = Number(atual?.rejected_drivers_count ?? 0);

  await directusPatch('embarques', opts.embarqueId, {
    rota_status: 'recusado',
    ultimo_evento_oferta_em: new Date().toISOString(),
    rejected_drivers_count: Number.isFinite(recusasAtuais) ? recusasAtuais + 1 : 1,
    needs_manual_review: false,
    manual_review_completed: false,
    manual_review_owner: null,
    manual_review_at: null,
    manual_review_note: null,
    ...(opts.limparMotorista ? { oferta_motorista_id: null } : {}),
  }).catch(() => undefined);
}

export async function marcarEmbarqueAguardandoHumano(opts: {
  embarqueId: number | string;
  motoristaId?: number | string | null;
  motivo: string;
}): Promise<void> {
  await directusPatch('embarques', opts.embarqueId, {
    rota_status: 'aguardando_humano',
    ultimo_evento_oferta_em: new Date().toISOString(),
    needs_manual_review: true,
    manual_review_completed: false,
    manual_review_at: new Date().toISOString(),
    manual_review_note: opts.motivo,
    ...(opts.motoristaId != null ? { oferta_motorista_id: Number(opts.motoristaId) } : {}),
  }).catch(() => undefined);
}

export async function limparRevisaoHumanaEmbarque(
  embarqueId: number | string,
  opts?: { owner?: string | null; observacao?: string | null },
): Promise<void> {
  await directusPatch('embarques', embarqueId, {
    needs_manual_review: false,
    manual_review_completed: true,
    manual_review_owner: opts?.owner ?? null,
    manual_review_at: new Date().toISOString(),
    manual_review_note: opts?.observacao ?? null,
  }).catch(() => undefined);
}
