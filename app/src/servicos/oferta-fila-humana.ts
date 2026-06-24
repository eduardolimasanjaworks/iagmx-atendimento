/**
 * Fila humana auditavel para ofertas escaladas.
 * Cada item representa um caso real que precisa de decisao operacional.
 * Resolver a fila tambem limpa lock e revisao pendente do embarque.
 */
import { directusListar, directusPatch, directusPost } from './directus.js';
import { normalizarTelefone } from '../util/telefone.js';
import { limparRevisaoHumanaEmbarque } from './oferta-status-embarque.js';
import { liberarLockOfertaPorTelefone } from './oferta-lock.js';
import { despausarContato } from './pausa.js';

export interface OfertaIntervencaoHumana {
  id: number;
  embarque_id?: number | string | null;
  motorista_id?: number | string | null;
  telefone?: string | null;
  status?: string | null;
  motivo?: string | null;
  valor_ofertado?: number | null;
  valor_pedido_motorista?: number | null;
  valor_minimo?: number | null;
  valor_maximo?: number | null;
  origem?: string | null;
  destino?: string | null;
  assumido_por?: string | null;
  assumido_em?: string | null;
  resolvido_em?: string | null;
  resolucao?: string | null;
  observacao?: string | null;
}

async function buscarPendentePorTelefone(
  telefone: string,
): Promise<OfertaIntervencaoHumana | null> {
  const itens = await directusListar<OfertaIntervencaoHumana>('ofertas_intervencao_humana', {
    'filter[telefone][_eq]': normalizarTelefone(telefone),
    'filter[status][_in]': 'pendente,assumido',
    sort: '-date_created',
    limit: '1',
    fields:
      'id,embarque_id,motorista_id,telefone,status,motivo,valor_ofertado,valor_pedido_motorista,valor_minimo,valor_maximo,origem,destino,assumido_por,assumido_em,resolvido_em,resolucao,observacao',
  }).catch(() => []);
  return itens[0] ?? null;
}

export async function abrirFilaHumanaOferta(opts: {
  telefone: string;
  embarqueId?: number | string | null;
  motoristaId?: number | string | null;
  motivo: string;
  valorOfertado?: number | null;
  valorPedidoMotorista?: number | null;
  valorMinimo?: number | null;
  valorMaximo?: number | null;
  origem?: string | null;
  destino?: string | null;
  observacao?: string | null;
}): Promise<OfertaIntervencaoHumana> {
  const telefone = normalizarTelefone(opts.telefone);
  const atual = await buscarPendentePorTelefone(telefone);
  const payload = {
    embarque_id: opts.embarqueId ?? null,
    motorista_id: opts.motoristaId ?? null,
    telefone,
    status: atual?.status === 'assumido' ? 'assumido' : 'pendente',
    motivo: opts.motivo,
    valor_ofertado: opts.valorOfertado ?? null,
    valor_pedido_motorista: opts.valorPedidoMotorista ?? null,
    valor_minimo: opts.valorMinimo ?? null,
    valor_maximo: opts.valorMaximo ?? null,
    origem: opts.origem ?? null,
    destino: opts.destino ?? null,
    observacao: opts.observacao ?? null,
  };

  if (atual?.id) {
    return directusPatch<OfertaIntervencaoHumana>(
      'ofertas_intervencao_humana',
      atual.id,
      payload,
    );
  }
  return directusPost<OfertaIntervencaoHumana>('ofertas_intervencao_humana', payload);
}

export async function listarFilaHumanaOfertas(
  status = 'pendente,assumido',
): Promise<OfertaIntervencaoHumana[]> {
  return directusListar<OfertaIntervencaoHumana>('ofertas_intervencao_humana', {
    'filter[status][_in]': status,
    sort: '-date_created',
    limit: '200',
    fields:
      'id,embarque_id,motorista_id,telefone,status,motivo,valor_ofertado,valor_pedido_motorista,valor_minimo,valor_maximo,origem,destino,assumido_por,assumido_em,resolvido_em,resolucao,observacao',
  }).catch(() => []);
}

export async function assumirFilaHumanaOferta(
  id: number | string,
  assumidoPor: string,
): Promise<OfertaIntervencaoHumana> {
  return directusPatch<OfertaIntervencaoHumana>('ofertas_intervencao_humana', id, {
    status: 'assumido',
    assumido_por: assumidoPor,
    assumido_em: new Date().toISOString(),
  });
}

export async function resolverFilaHumanaOferta(opts: {
  id: number | string;
  resolucao: string;
  observacao?: string | null;
  owner?: string | null;
}): Promise<OfertaIntervencaoHumana> {
  const itens = await directusListar<OfertaIntervencaoHumana>('ofertas_intervencao_humana', {
    'filter[id][_eq]': String(opts.id),
    limit: '1',
    fields:
      'id,embarque_id,telefone,status,assumido_por,assumido_em,resolvido_em,resolucao,observacao',
  }).catch(() => []);
  const atual = itens[0];
  if (!atual?.id) throw new Error('Fila humana não encontrada');

  const resolvido = await directusPatch<OfertaIntervencaoHumana>(
    'ofertas_intervencao_humana',
    atual.id,
    {
      status: 'resolvido',
      resolucao: opts.resolucao,
      observacao: opts.observacao ?? null,
      resolvido_em: new Date().toISOString(),
      assumido_por: opts.owner ?? atual.assumido_por ?? null,
    },
  );

  if (atual.embarque_id != null) {
    await limparRevisaoHumanaEmbarque(atual.embarque_id, {
      owner: opts.owner ?? atual.assumido_por ?? null,
      observacao: opts.observacao ?? opts.resolucao,
    });
  }
  if (atual.telefone) {
    await liberarLockOfertaPorTelefone(atual.telefone);
    await despausarContato(atual.telefone).catch(() => undefined);
  }
  return resolvido;
}
