/**
 * Embarques vinculados ao motorista (kanban).
 */
import { directusConfigurado, directusListar, directusPost } from './directus.js';
import { directusUploadArquivo, directusAssetUrl } from './directus.js';
import { buscarMotoristaPorTelefone } from './motorista-gmx.js';
import type { MidiaCacheada } from './midia-cache.js';
import { espelharMidiaWhatsappNoDrive } from './google-drive-motorista.js';
import { mesmaRotaOperacional } from './rota-operacional.js';

export interface EmbarqueAtivo {
  id: number | string;
  status?: string;
  origin?: string;
  destination?: string;
  operacao?: string | null;
  rota_status?: string | null;
  config_rota_id?: number | string | null;
  valor_ofertado?: number | string | null;
  valor_minimo?: number | string | null;
  valor_maximo?: number | string | null;
  total_value?: number | string | null;
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

/** Embarques ativos (driver_id ou oferta_motorista_id). */
export async function listarEmbarquesAtivos(motoristaId: number): Promise<EmbarqueAtivo[]> {
  if (!directusConfigurado()) return [];
  const campos =
    'id,status,origin,destination,operacao,rota_status,config_rota_id,valor_ofertado,valor_minimo,valor_maximo,total_value';
  const [a, b] = await Promise.all([
    directusListar<EmbarqueAtivo>('embarques', {
      'filter[driver_id][_eq]': String(motoristaId),
      'filter[status][_in]': STATUS_ATIVO.join(','),
      sort: '-date_updated,-date_created',
      limit: '5',
      fields: campos,
    }).catch(() => []),
    directusListar<EmbarqueAtivo>('embarques', {
      'filter[oferta_motorista_id][_eq]': String(motoristaId),
      'filter[status][_in]': STATUS_ATIVO.join(','),
      sort: '-date_updated,-date_created',
      limit: '5',
      fields: campos,
    }).catch(() => []),
  ]);
  const vistos = new Set<string>();
  const out: EmbarqueAtivo[] = [];
  for (const e of [...a, ...b]) {
    const k = String(e.id);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(e);
  }
  return out;
}

export async function obterEmbarqueAtivoPrincipal(telefone: string): Promise<EmbarqueAtivo | null> {
  const m = await buscarMotoristaPorTelefone(telefone);
  if (!m) return null;
  const lista = await listarEmbarquesAtivos(m.id);
  return lista[0] ?? null;
}

export async function resolverEmbarqueAtivoPorTelefone(opts: {
  telefone: string;
  embarqueId?: string | number | null;
  origem?: string | null;
  destino?: string | null;
}): Promise<EmbarqueAtivo | null> {
  if (opts.embarqueId != null) {
    return { id: opts.embarqueId };
  }
  const motorista = await buscarMotoristaPorTelefone(opts.telefone);
  if (!motorista) return null;
  const ativos = await listarEmbarquesAtivos(motorista.id);
  if (ativos.length === 0) return null;
  if (ativos.length === 1) return ativos[0];

  if (opts.origem || opts.destino) {
    const candidatos = ativos.filter((item) => {
      return mesmaRotaOperacional(
        {
          origem: item.origin,
          destino: item.destination,
          operacao: item.operacao ?? null,
        },
        {
          origem: opts.origem ?? null,
          destino: opts.destino ?? null,
        },
      );
    });
    if (candidatos.length === 1) return candidatos[0];
  }

  throw new Error(
    `embarque_ambiguo: o motorista possui ${ativos.length} embarques ativos e a IA precisa de embarque_id explicito`,
  );
}

/** Grava canhoto/comprovante de entrega no embarque ativo. */
export async function gravarCanhotoEmbarque(opts: {
  telefone: string;
  embarqueId: number | string;
  midia: MidiaCacheada;
  textoExtraido?: string;
}): Promise<{ fileUrl: string; registroId: unknown }> {
  const fileId = await directusUploadArquivo(
    opts.midia.buffer,
    opts.midia.fileName,
    opts.midia.mimetype,
  );
  const fileUrl = directusAssetUrl(fileId);
  const registro = await directusPost('delivery_receipts', {
    shipment_id: String(opts.embarqueId),
    file_url: fileUrl,
    file_name: opts.midia.fileName,
    file_size: opts.midia.buffer.length,
    observations: opts.textoExtraido?.slice(0, 2000),
  });

  const motorista = await buscarMotoristaPorTelefone(opts.telefone);
  if (motorista) {
    espelharMidiaWhatsappNoDrive({
      motorista,
      midia: opts.midia,
      tipoDocumento: 'comprovante_entrega',
    });
  }

  return { fileUrl, registroId: (registro as { id?: unknown }).id };
}

export async function verificarCanhotoEmbarqueNoErp(opts: {
  embarqueId: string | number;
  fileUrl?: string;
}): Promise<{ ok: boolean; registro?: Record<string, unknown>; motivo?: string }> {
  const lista = await directusListar<Record<string, unknown>>('delivery_receipts', {
    'filter[shipment_id][_eq]': String(opts.embarqueId),
    sort: '-id',
    limit: '5',
    fields: 'id,shipment_id,file_url,file_name,verified',
  }).catch(() => []);

  const registro = lista.find((item) => {
    if (!opts.fileUrl) return true;
    return String(item.file_url ?? '') === opts.fileUrl;
  });

  if (!registro) {
    return {
      ok: false,
      motivo: `canhoto não encontrado no embarque ${String(opts.embarqueId)}`,
    };
  }
  return { ok: true, registro };
}
