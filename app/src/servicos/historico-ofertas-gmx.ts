import { randomUUID } from 'node:crypto';
import { directusListar, directusPost } from './directus.js';
import { buscarMotoristaPorTelefone } from './motorista-gmx.js';
import { normalizarTelefone } from '../util/telefone.js';

export interface EventoHistoricoOfertaInput {
  evento_id?: string;
  tipo_evento?: string;
  subtipo: string;
  telefone: string;
  embarque_id?: number | string | null;
  motorista_id?: number | string | null;
  motorista_nome?: string | null;
  match_id?: number | null;
  aceite?: boolean | null;
  precisa_intervencao_humana?: boolean;
  valor_aceito?: number | null;
  valor_ofertado?: number | null;
  valor_pedido_motorista?: number | null;
  valor_minimo?: number | null;
  valor_maximo?: number | null;
  origem?: string | null;
  destino?: string | null;
  motivo?: string | null;
  observacao?: string | null;
}

export interface EventoHistoricoOferta {
  id: number;
  tipo_evento?: string;
  match_id?: number | null;
  date_created?: string;
  descricao?: string;
}

export interface EventoHistoricoOfertaDecodificado extends EventoHistoricoOferta {
  payload: Record<string, unknown>;
}

export function novoEventoHistoricoId(): string {
  return randomUUID();
}

function contemInteiro(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function paraNumero(value: unknown): number | null {
  if (contemInteiro(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function paraString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t : null;
}

export async function registrarEventoHistoricoOferta(
  input: EventoHistoricoOfertaInput,
): Promise<Record<string, unknown>> {
  const eventoId = input.evento_id ?? novoEventoHistoricoId();
  const telefone = normalizarTelefone(input.telefone);
  const motorista = await buscarMotoristaPorTelefone(telefone).catch(() => null);
  const payload = {
    evento_id: eventoId,
    fonte: 'iagmx_ia',
    telefone,
    subtipo: input.subtipo,
    tipo_evento: input.tipo_evento ?? 'retorno_motorista',
    embarque_id: input.embarque_id ?? null,
    motorista_id: input.motorista_id ?? motorista?.id ?? null,
    motorista_nome:
      input.motorista_nome ??
      ([motorista?.nome, motorista?.sobrenome].filter(Boolean).join(' ') || null),
    match_id: input.match_id ?? null,
    aceite: input.aceite ?? null,
    precisa_intervencao_humana: Boolean(input.precisa_intervencao_humana),
    valor_aceito: input.valor_aceito ?? null,
    valor_ofertado: input.valor_ofertado ?? null,
    valor_pedido_motorista: input.valor_pedido_motorista ?? null,
    valor_minimo: input.valor_minimo ?? null,
    valor_maximo: input.valor_maximo ?? null,
    origem: input.origem ?? null,
    destino: input.destino ?? null,
    motivo: input.motivo ?? null,
    observacao: input.observacao ?? null,
  };

  return directusPost('historico_ofertas', {
    status: 'published',
    tipo_evento: payload.tipo_evento,
    match_id: payload.match_id,
    descricao: JSON.stringify(payload),
  });
}

function decodificarEvento(item: EventoHistoricoOferta): EventoHistoricoOfertaDecodificado {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(item.descricao ?? '{}') as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { ...item, payload };
}

export async function listarHistoricoOfertaPorEmbarque(
  embarqueId: string | number,
  limite = 80,
): Promise<EventoHistoricoOfertaDecodificado[]> {
  const needle = `"embarque_id":${JSON.stringify(paraNumero(embarqueId) ?? String(embarqueId))}`;
  const lista = await directusListar<EventoHistoricoOferta>('historico_ofertas', {
    'filter[descricao][_contains]': needle,
    sort: '-date_created',
    limit: String(limite),
    fields: 'id,tipo_evento,descricao,date_created,match_id',
  }).catch(() => []);
  return lista.map(decodificarEvento);
}

export async function verificarHistoricoOfertaNoErp(opts: {
  telefone: string;
  eventoId?: string;
  subtipo?: string;
  embarqueId?: string | number | null;
}): Promise<{ ok: boolean; evento?: EventoHistoricoOfertaDecodificado; motivo?: string }> {
  if (opts.eventoId) {
    const listaEvento = await directusListar<EventoHistoricoOferta>('historico_ofertas', {
      'filter[descricao][_contains]': `"evento_id":"${opts.eventoId}"`,
      sort: '-date_created',
      limit: '5',
      fields: 'id,tipo_evento,descricao,date_created,match_id',
    }).catch(() => []);
    const evento = listaEvento.map(decodificarEvento)[0];
    if (!evento) {
      return { ok: false, motivo: `historico_ofertas sem evento_id ${opts.eventoId}` };
    }
    return { ok: true, evento };
  }

  const telefone = normalizarTelefone(opts.telefone);
  const lista = await directusListar<EventoHistoricoOferta>('historico_ofertas', {
    'filter[descricao][_contains]': telefone,
    sort: '-date_created',
    limit: '20',
    fields: 'id,tipo_evento,descricao,date_created,match_id',
  }).catch(() => []);

  const evento = lista
    .map(decodificarEvento)
    .find((item) => {
      const subtipoOk = !opts.subtipo || item.payload.subtipo === opts.subtipo;
      const embarquePayload = paraNumero(item.payload.embarque_id) ?? paraString(item.payload.embarque_id);
      const embarqueEsperado = opts.embarqueId == null
        ? null
        : paraNumero(opts.embarqueId) ?? String(opts.embarqueId);
      const embarqueOk = embarqueEsperado == null || embarquePayload === embarqueEsperado;
      return subtipoOk && embarqueOk;
    });

  if (!evento) {
    return {
      ok: false,
      motivo: `historico_ofertas sem evento${opts.subtipo ? ` ${opts.subtipo}` : ''} para ${telefone}`,
    };
  }
  return { ok: true, evento };
}

export async function resumirHistoricoNominalOfertasPorEmbarque(
  embarqueId: string | number,
): Promise<{
  recusas: Array<Record<string, unknown>>;
  escalonamentos: Array<Record<string, unknown>>;
  aceites: Array<Record<string, unknown>>;
}> {
  const itens = await listarHistoricoOfertaPorEmbarque(embarqueId, 120);
  const mapear = (item: EventoHistoricoOfertaDecodificado) => ({
    id: item.id,
    evento_id: paraString(item.payload.evento_id),
    data: item.date_created ?? null,
    telefone: paraString(item.payload.telefone),
    motorista_id: paraNumero(item.payload.motorista_id),
    motorista_nome: paraString(item.payload.motorista_nome),
    origem: paraString(item.payload.origem),
    destino: paraString(item.payload.destino),
    subtipo: paraString(item.payload.subtipo),
    motivo: paraString(item.payload.motivo),
    observacao: paraString(item.payload.observacao),
    valor_ofertado: paraNumero(item.payload.valor_ofertado),
    valor_aceito: paraNumero(item.payload.valor_aceito),
    valor_pedido_motorista: paraNumero(item.payload.valor_pedido_motorista),
  });

  return {
    recusas: itens
      .filter((item) => String(item.payload.subtipo ?? '').includes('recusa'))
      .map(mapear),
    escalonamentos: itens
      .filter((item) => String(item.payload.subtipo ?? '').includes('escalon'))
      .map(mapear),
    aceites: itens
      .filter((item) => String(item.payload.subtipo ?? '').includes('aceite'))
      .map(mapear),
  };
}
