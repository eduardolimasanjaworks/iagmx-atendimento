/**
 * Contexto ERP completo por telefone — carregado em TODA inferência (sem gatilhos).
 * Motorista + documentos + embarques ativos + docs viagem + histórico ofertas.
 */
import { directusConfigurado, directusListar } from './directus.js';
import { buscarMotoristaPorTelefone, STATUS_CONTATO_WHATSAPP, type MotoristaGmx } from './motorista-gmx.js';
import { normalizarTelefone } from '../util/telefone.js';
import { buscarConfigRota, formatarContextoRotaNegociacao } from './rotas-gmx.js';
import { resumirHistoricoNominalOfertasPorEmbarque } from './historico-ofertas-gmx.js';
import { montarBlocoPrioridadeMotorista } from './contexto-erp-prioridades.js';
import { obterDocumentosDetalhadosMotorista } from './contexto-erp-documentos.js';

const STATUS_EMBARQUE_ATIVO = [
  'new',
  'needs_attention',
  'sent',
  'waiting_confirmation',
  'confirmed',
  'in_transit',
  'waiting_receipt',
];

const ROTULO_STATUS: Record<string, string> = {
  new: 'Nova / aceita',
  needs_attention: 'Confirmada — atenção',
  sent: 'Motorista alocado',
  waiting_confirmation: 'Carregamento',
  confirmed: 'Aguardando carregamento',
  in_transit: 'Em viagem',
  waiting_receipt: 'Aguardando descarga',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
  no_show: 'No-show',
};

const CACHE_TTL_MS = 45_000;
const cache = new Map<string, { expira: number; texto: string }>();

function formatarDataBr(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso ?? '—';
  }
}

function truncar(s: string, max = 120): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

interface EmbarqueErp {
  id: number | string;
  status?: string;
  origin?: string;
  destination?: string;
  total_value?: number | string | null;
  valor_ofertado?: number | string | null;
  valor_minimo?: number | string | null;
  valor_maximo?: number | string | null;
  rota_status?: string;
  config_rota_id?: number | null;
  operacao?: string;
  produto?: string;
  pickup_date?: string;
  oferta_disparada_em?: string;
  driver_id?: number | null;
  accepted_motorista_id?: number | null;
  oferta_motorista_id?: number | null;
}

interface HistoricoOferta {
  id: number;
  tipo_evento?: string;
  descricao?: string;
  date_created?: string;
  match_id?: number | null;
}

async function obterUltimaDisponibilidade(motoristaId: number) {
  const lista = await directusListar<Record<string, unknown>>('disponivel', {
    'filter[motorista_id][_eq]': String(motoristaId),
    sort: '-date_created',
    limit: '1',
    fields:
      'disponivel,localizacao_atual,local_disponibilidade,local_destino_atual,local_liberacao_prevista,latitude,longitude,gps_timestamp,data_previsao_disponibilidade,observacao,date_updated,date_created',
  });
  return lista[0] ?? null;
}

async function obterEmbarquesMotorista(motoristaId: number): Promise<EmbarqueErp[]> {
  const campos =
    'id,status,origin,destination,total_value,valor_ofertado,valor_minimo,valor_maximo,rota_status,config_rota_id,operacao,produto,pickup_date,oferta_disparada_em,driver_id,accepted_motorista_id,oferta_motorista_id,date_updated';
  const [porDriver, porAceite, porOferta] = await Promise.all([
    directusListar<EmbarqueErp>('embarques', {
      'filter[driver_id][_eq]': String(motoristaId),
      'filter[status][_in]': STATUS_EMBARQUE_ATIVO.join(','),
      sort: '-date_updated,-date_created',
      limit: '5',
      fields: campos,
    }).catch(() => []),
    directusListar<EmbarqueErp>('embarques', {
      'filter[accepted_motorista_id][_eq]': String(motoristaId),
      'filter[status][_in]': STATUS_EMBARQUE_ATIVO.join(','),
      sort: '-date_updated,-date_created',
      limit: '5',
      fields: campos,
    }).catch(() => []),
    directusListar<EmbarqueErp>('embarques', {
      'filter[oferta_motorista_id][_eq]': String(motoristaId),
      'filter[status][_in]': STATUS_EMBARQUE_ATIVO.join(','),
      sort: '-date_updated,-date_created',
      limit: '5',
      fields: campos,
    }).catch(() => []),
  ]);
  const vistos = new Set<string>();
  const todos: EmbarqueErp[] = [];
  for (const e of [...porDriver, ...porAceite, ...porOferta]) {
    const k = String(e.id);
    if (vistos.has(k)) continue;
    vistos.add(k);
    todos.push(e);
  }
  return todos.slice(0, 5);
}

async function obterDocsEmbarque(embarqueId: string | number): Promise<string[]> {
  const sid = String(embarqueId);
  const [pagamentos, canhotos, docs] = await Promise.all([
    directusListar<Record<string, unknown>>('payment_receipts', {
      'filter[shipment_id][_eq]': sid,
      sort: '-id',
      limit: '3',
      fields: 'file_name,receipt_type,file_url',
    }).catch(() => []),
    directusListar<Record<string, unknown>>('delivery_receipts', {
      'filter[shipment_id][_eq]': sid,
      sort: '-id',
      limit: '3',
      fields: 'file_name,verified,delivery_date,file_url',
    }).catch(() => []),
    directusListar<Record<string, unknown>>('shipment_documents', {
      'filter[shipment_id][_eq]': sid,
      sort: '-id',
      limit: '5',
      fields: 'document_title,document_type,file_name,file_url',
    }).catch(() => []),
  ]);

  const linhas: string[] = [];
  if (pagamentos.length) {
    linhas.push(
      `  Pagamentos (${pagamentos.length}): ${pagamentos.map((p) => `${p.receipt_type ?? 'comprovante'} ${p.file_name ? `— ${p.file_name}` : ''}`).join('; ')}`,
    );
  } else {
    linhas.push('  Pagamento adiantamento: sem comprovante anexado');
  }
  if (canhotos.length) {
    linhas.push(
      `  Canhotos (${canhotos.length}): ${canhotos.map((c) => `${c.file_name ?? 'arquivo'}${c.verified ? ' ✓' : ''}`).join('; ')}`,
    );
  } else {
    linhas.push('  Canhoto entrega: pendente');
  }
  const ctes = docs.filter((d) =>
    /ct-?e|conhecimento/i.test(String(d.document_type ?? d.document_title ?? '')),
  );
  const outros = docs.filter((d) => !ctes.includes(d));
  if (ctes.length) {
    linhas.push(`  CT-e (${ctes.length}): ${ctes.map((d) => d.document_title ?? d.file_name).join('; ')}`);
  } else {
    linhas.push('  CT-e: não anexado no portal');
  }
  if (outros.length) {
    linhas.push(`  Outros docs (${outros.length}): ${outros.map((d) => d.document_title ?? d.file_name).join('; ')}`);
  }
  return linhas;
}

async function obterHistoricoOfertas(telefone: string, limite = 12): Promise<HistoricoOferta[]> {
  const tel = normalizarTelefone(telefone);
  const lista = await directusListar<HistoricoOferta>('historico_ofertas', {
    'filter[descricao][_contains]': tel,
    sort: '-date_created',
    limit: String(limite),
    fields: 'id,tipo_evento,descricao,date_created,match_id',
  }).catch(() => []);
  return lista;
}

function formatarHistoricoOfertas(itens: HistoricoOferta[]): string[] {
  const linhas: string[] = [];
  for (const h of itens) {
    let detalhe = h.descricao ?? '';
    try {
      const j = JSON.parse(h.descricao ?? '{}') as Record<string, unknown>;
      const partes: string[] = [];
      if (j.subtipo) partes.push(String(j.subtipo));
      if (j.origem && j.destino) partes.push(`${j.origem} → ${j.destino}`);
      if (j.valor_aceito != null) partes.push(`aceito R$ ${j.valor_aceito}`);
      else if (j.valor_ofertado != null) partes.push(`ofertado R$ ${j.valor_ofertado}`);
      if (j.aceite === true) partes.push('ACEITE');
      else if (j.aceite === false) partes.push('recusa/negociação');
      detalhe = partes.join(' | ');
    } catch {
      detalhe = truncar(detalhe, 80);
    }
    linhas.push(
      `- ${formatarDataBr(h.date_created)} [${h.tipo_evento ?? 'evento'}] ${detalhe || '—'}`,
    );
  }
  return linhas;
}

async function formatarEmbarques(embarques: EmbarqueErp[]): Promise<string[]> {
  const linhas: string[] = [];
  for (const e of embarques) {
    const valor = e.valor_ofertado ?? e.total_value;
    const statusPt = ROTULO_STATUS[e.status ?? ''] ?? e.status ?? '—';
    linhas.push(`--- Embarque #${e.id} (${statusPt}) ---`);
    linhas.push(`  Rota: ${truncar(e.origin ?? '—', 60)} → ${truncar(e.destination ?? '—', 60)}`);
    if (valor != null) linhas.push(`  Valor: R$ ${valor}`);
    if (e.rota_status) linhas.push(`  Status oferta/rota: ${e.rota_status}`);
    if (e.config_rota_id != null) linhas.push(`  Config rota ERP: #${e.config_rota_id}`);
    if (e.operacao) linhas.push(`  Operação: ${e.operacao}`);
    if (e.produto) linhas.push(`  Produto: ${truncar(String(e.produto), 50)}`);
    if (e.pickup_date) linhas.push(`  Carregamento: ${formatarDataBr(e.pickup_date)}`);
    if (e.oferta_disparada_em) {
      linhas.push(`  Oferta disparada: ${formatarDataBr(e.oferta_disparada_em)}`);
    }
    if (e.valor_minimo != null || e.valor_maximo != null) {
      linhas.push(`  Faixa negociação: R$ ${e.valor_minimo ?? '?'} – R$ ${e.valor_maximo ?? '?'}`);
    }
    const docsViagem = await obterDocsEmbarque(e.id);
    linhas.push('  Documentos da viagem:');
    linhas.push(...docsViagem);

    const historicoNominal = await resumirHistoricoNominalOfertasPorEmbarque(e.id).catch(() => null);
    if (historicoNominal) {
      linhas.push('  Retornos nominais de oferta:');
      if (historicoNominal.recusas.length === 0) {
        linhas.push('  Recusas: nenhuma registrada');
      } else {
        linhas.push(
          `  Recusas: ${historicoNominal.recusas
            .map((item) => item.motorista_nome || item.telefone || 'motorista sem nome')
            .join('; ')}`,
        );
      }
      if (historicoNominal.escalonamentos.length === 0) {
        linhas.push('  Escalonamentos: nenhum registrado');
      } else {
        linhas.push(
          `  Escalonamentos: ${historicoNominal.escalonamentos
            .map((item) =>
              `${item.motorista_nome || item.telefone || 'motorista sem nome'}${item.motivo ? ` (${item.motivo})` : ''}`,
            )
            .join('; ')}`,
        );
      }
      if (historicoNominal.aceites.length > 0) {
        linhas.push(
          `  Aceites: ${historicoNominal.aceites
            .map((item) => item.motorista_nome || item.telefone || 'motorista sem nome')
            .join('; ')}`,
        );
      }
    }

    if ((e.rota_status === 'ofertado' || e.oferta_motorista_id) && e.origin && e.destination) {
      const rota = await buscarConfigRota({
        id: e.config_rota_id,
        origem: e.origin,
        destino: e.destination,
        operacao: e.operacao,
      });
      if (rota && valor != null) {
        const neg = formatarContextoRotaNegociacao(rota, Number(valor));
        linhas.push(`  ${neg.split('\n').join('\n  ')}`);
      }
    }
  }
  return linhas;
}

/**
 * Monta bloco único de contexto ERP — sempre injetado no prompt (não depende de gatilho na mensagem).
 */
export async function montarContextoErpCompleto(
  telefone: string,
  nomeContato?: string,
): Promise<string> {
  const tel = normalizarTelefone(telefone);
  const cacheKey = tel;
  const cached = cache.get(cacheKey);
  if (cached && cached.expira > Date.now()) return cached.texto;

  const linhas: string[] = [
    '=== CONTEXTO ERP GMX (sempre atualizado por telefone) ===',
    `Telefone WhatsApp: ${tel}`,
    'Use APENAS estes dados para falar de cadastro, viagem, ofertas e documentos. Não invente.',
  ];

  if (!directusConfigurado()) {
    linhas.push('ERP: Directus indisponível — trate como motorista novo.');
    if (nomeContato) linhas.push(`Nome no WhatsApp: ${nomeContato}`);
    const texto = linhas.join('\n');
    cache.set(cacheKey, { expira: Date.now() + CACHE_TTL_MS, texto });
    return texto;
  }

  try {
    const motorista = await buscarMotoristaPorTelefone(tel);

    if (!motorista) {
      linhas.push('');
      linhas.push('CADASTRO: não encontrado — telefone ainda não vinculado ao ERP.');
      linhas.push(`status_cadastro: ${STATUS_CONTATO_WHATSAPP} (esperado após 1º contato)`);
      if (nomeContato) linhas.push(`Nome no WhatsApp: ${nomeContato}`);
      linhas.push('EMBARQUE ATIVO: nenhum (sem cadastro)');
      linhas.push('HISTÓRICO OFERTAS: vazio para este telefone');
      const texto = linhas.join('\n');
      cache.set(cacheKey, { expira: Date.now() + CACHE_TTL_MS, texto });
      return texto;
    }

    await appendMotorista(linhas, motorista, nomeContato, tel);
  } catch (err) {
    linhas.push(
      `Erro ao consultar ERP: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (nomeContato) linhas.push(`Nome no WhatsApp: ${nomeContato}`);
  }

  const texto = linhas.join('\n');
  cache.set(cacheKey, { expira: Date.now() + CACHE_TTL_MS, texto });
  return texto;
}

async function appendMotorista(
  linhas: string[],
  motorista: MotoristaGmx,
  nomeContato: string | undefined,
  tel: string,
): Promise<void> {
  const [disp, docsDetalhe, embarques, historico] = await Promise.all([
    obterUltimaDisponibilidade(motorista.id),
    obterDocumentosDetalhadosMotorista(motorista.id, formatarDataBr),
    obterEmbarquesMotorista(motorista.id),
    obterHistoricoOfertas(tel),
  ]);

  const nome =
    [motorista.nome, motorista.sobrenome].filter(Boolean).join(' ') || nomeContato || '—';

  linhas.push('');
  linhas.push('--- MOTORISTA ---');
  linhas.push(`ID: ${motorista.id} | Nome: ${nome}`);
  linhas.push(`CPF: ${motorista.cpf ?? '—'}`);
  linhas.push(`status_cadastro: ${motorista.status_cadastro ?? '—'}`);
  linhas.push(`status_validade_cnh: ${motorista.status_validade_cnh ?? '—'}`);
  linhas.push(`Cidade/UF: ${motorista.cidade ?? '—'}/${motorista.estado ?? '—'}`);
  if (motorista.tipo_carroceria) linhas.push(`Carroceria: ${motorista.tipo_carroceria}`);
  if (motorista.forma_pagamento) linhas.push(`Forma pagamento: ${motorista.forma_pagamento}`);

  linhas.push('');
  linhas.push(...await montarBlocoPrioridadeMotorista({
    documentos: docsDetalhe,
    embarques,
    disponibilidade: disp,
    formatarData: formatarDataBr,
  }));

  linhas.push('');
  linhas.push('DISPONIBILIDADE (último registro):');
  if (disp) {
    linhas.push(`- disponível: ${disp.disponivel === true ? 'sim' : disp.disponivel === false ? 'não' : '—'}`);
    linhas.push(`- local atual: ${(disp.localizacao_atual as string) || 'não informada'}`);
    if (disp.local_destino_atual) {
      linhas.push(`- destino da viagem atual: ${disp.local_destino_atual as string}`);
    }
    if (disp.local_liberacao_prevista || disp.local_disponibilidade) {
      linhas.push(`- local onde ficará livre: ${(disp.local_liberacao_prevista as string) || (disp.local_disponibilidade as string)}`);
    }
    if (disp.data_previsao_disponibilidade) {
      linhas.push(`- libera: ${formatarDataBr(disp.data_previsao_disponibilidade as string)}`);
    }
    if (disp.observacao) linhas.push(`- obs: ${disp.observacao}`);
  } else {
    linhas.push('- sem registro');
  }

  linhas.push('');
  linhas.push('DOCUMENTOS DO MOTORISTA (ERP — motorista pode atualizar enviando nova foto no WhatsApp):');
  linhas.push(...docsDetalhe.map((item) => item.detalhe));

  linhas.push('');
  linhas.push('EMBARQUES / FRETES ATIVOS (kanban):');
  if (embarques.length === 0) {
    linhas.push('- Nenhum embarque ativo vinculado a este motorista no momento.');
  } else {
    const embLinhas = await formatarEmbarques(embarques);
    linhas.push(...embLinhas);
  }

  linhas.push('');
  linhas.push(`HISTÓRICO DE OFERTAS (últimas ${historico.length} no ERP):`);
  if (historico.length === 0) {
    linhas.push('- Sem registros para este telefone.');
  } else {
    linhas.push(...formatarHistoricoOfertas(historico));
  }
}

/** Invalida cache após gravação de documento / disponibilidade / oferta */
export function invalidarCacheContextoErp(telefone: string): void {
  cache.delete(normalizarTelefone(telefone));
}
