/**
 * Operações de motorista no Directus GMX (/root/gmx).
 */
import {
  directusAssetUrl,
  directusListar,
  directusPatch,
  directusPost,
  directusUploadArquivo,
  directusConfigurado,
} from './directus.js';
import { normalizarTelefone } from '../util/telefone.js';
import type { MidiaCacheada } from './midia-cache.js';
import { espelharMidiaWhatsappNoDrive } from './google-drive-motorista.js';
import { resolverMapeamentoOcr } from './config-ocr-documentos.js';
import { registrarOcrPendenteGmx } from './ocr-pendencias-gmx.js';

/** Primeiro toque no WhatsApp — ainda não comprovou ser motorista */
export const STATUS_CONTATO_WHATSAPP = 'CONTATO WHATSAPP';

export interface MotoristaGmx {
  id: number;
  nome?: string;
  sobrenome?: string;
  telefone?: string;
  cpf?: string;
  cidade?: string;
  estado?: string;
  status_cadastro?: string;
  status_validade_cnh?: string;
  tipo_veiculo?: string;
  tipo_carroceria?: string;
  quantidade_eixo?: string;
  observacao?: string;
  forma_pagamento?: string;
  [chave: string]: unknown;
}

/** Gera variantes de telefone para busca (5511..., 11...) */
function variantesTelefone(telefone: string): string[] {
  const n = normalizarTelefone(telefone);
  const set = new Set<string>([n]);
  if (n.startsWith('55') && n.length >= 12) set.add(n.slice(2));
  if (!n.startsWith('55') && n.length >= 10) set.add(`55${n}`);
  return [...set];
}

function separarCidadeUf(local: string | undefined): { cidade?: string; estado?: string } {
  const t = String(local ?? '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*)\s+([A-Z]{2})$/);
  if (!m) return {};
  return { cidade: m[1].trim(), estado: m[2].trim() };
}

/** Busca motorista pelo telefone no cadastro GMX */
export async function buscarMotoristaPorTelefone(telefone: string): Promise<MotoristaGmx | null> {
  if (!directusConfigurado()) return null;

  for (const tel of variantesTelefone(telefone)) {
    const lista = await directusListar<MotoristaGmx>('cadastro_motorista', {
      'filter[telefone][_eq]': tel,
      limit: '1',
      fields:
        'id,nome,sobrenome,telefone,cpf,cidade,estado,status_cadastro,status_validade_cnh,tipo_carroceria,forma_pagamento,vencimento_cx,ia_pausada,ia_pausa_motivo,precisa_atendimento,precisa_atendimento_motivo,ultima_intencao_whatsapp,ultima_intencao_em',
    });
    if (lista[0]) return lista[0];
  }
  return null;
}

/** Atualiza campos do motorista */
export async function atualizarMotorista(
  motoristaId: number,
  campos: Record<string, unknown>,
): Promise<MotoristaGmx> {
  const permitidos = [
    'nome',
    'sobrenome',
    'telefone',
    'cpf',
    'cidade',
    'estado',
    'cep_residencia',
    'status_cadastro',
    'status_validade_cnh',
    'tipo_veiculo',
    'tipo_carroceria',
    'tipo_rota',
    'quantidade_eixo',
    'observacao',
    'forma_pagamento',
    'vencimento_cx',
    'venc_cx',
    'cadastro_cx',
    'card_cx',
    'cliente',
    'pis',
    'nome_mae',
    'data_nascimento',
    'quinta_roda',
    'rastreador',
    'proprietario_rastreador',
  ];
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campos)) {
    if (permitidos.includes(k) && v !== undefined && v !== null && v !== '') {
      payload[k] = v;
    }
  }
  if (Object.keys(payload).length === 0) {
    throw new Error('Nenhum campo válido para atualizar');
  }
  return directusPatch<MotoristaGmx>('cadastro_motorista', motoristaId, payload);
}

/** Cria registro mínimo no primeiro contato WhatsApp */
export async function criarContatoWhatsApp(
  telefone: string,
  nome?: string,
): Promise<MotoristaGmx> {
  const tel = normalizarTelefone(telefone);
  return directusPost<MotoristaGmx>('cadastro_motorista', {
    telefone: tel,
    nome: nome ?? 'Contato',
    status_cadastro: STATUS_CONTATO_WHATSAPP,
  });
}

/** Cria motorista mínimo se não existir (fluxos de cadastro/ferramentas) */
export async function criarMotoristaMinimo(
  telefone: string,
  nome?: string,
): Promise<MotoristaGmx> {
  const tel = normalizarTelefone(telefone);
  return directusPost<MotoristaGmx>('cadastro_motorista', {
    telefone: tel,
    nome: nome ?? 'Motorista',
    status_cadastro: 'FALTA DOCS',
  });
}

/** Garante motorista existente (busca ou cria) */
export async function garantirMotorista(
  telefone: string,
  nome?: string,
): Promise<MotoristaGmx> {
  const existente = await buscarMotoristaPorTelefone(telefone);
  if (existente) return existente;
  return criarMotoristaMinimo(telefone, nome);
}

/** Registra ou atualiza disponibilidade */
export async function registrarDisponibilidade(dados: {
  telefone: string;
  disponivel?: boolean;
  status?: string;
  localizacao_atual?: string;
  local_disponibilidade?: string;
  latitude?: number;
  longitude?: number;
  data_previsao_disponibilidade?: string;
  observacao?: string;
}): Promise<Record<string, unknown>> {
  const motorista = await garantirMotorista(dados.telefone);
  const tel = normalizarTelefone(dados.telefone);

  const ultimos = await directusListar<Record<string, unknown>>('disponivel', {
    'filter[motorista_id][_eq]': String(motorista.id),
    sort: '-date_created',
    limit: '1',
    fields: 'id',
  });

  const statusErp =
    dados.status ??
    (dados.disponivel === false ? 'carregado' : 'disponivel');

  const payload: Record<string, unknown> = {
    motorista_id: motorista.id,
    telefone: tel,
    disponivel: dados.disponivel ?? statusErp === 'disponivel',
    status: statusErp,
    localizacao_atual: dados.localizacao_atual,
    local_disponibilidade: dados.local_disponibilidade ?? dados.localizacao_atual,
    latitude: dados.latitude,
    longitude: dados.longitude,
    data_previsao_disponibilidade: dados.data_previsao_disponibilidade,
    ...(dados.observacao ? { observacao: dados.observacao } : {}),
  };

  let registro: Record<string, unknown>;
  if (ultimos[0]?.id) {
    registro = (await directusPatch('disponivel', ultimos[0].id as number, payload)) as Record<
      string,
      unknown
    >;
  } else {
    registro = (await directusPost('disponivel', payload)) as Record<string, unknown>;
  }

  console.log(
    `[erp-disponibilidade] gravado motorista_id=${motorista.id} status=${statusErp} atual=${dados.localizacao_atual ?? '—'} libera_em=${dados.local_disponibilidade ?? '—'}`,
  );

  const patchLocal = separarCidadeUf(dados.localizacao_atual);
  if (patchLocal.cidade && patchLocal.estado) {
    await atualizarMotorista(motorista.id, patchLocal).catch(() => undefined);
  }
  return registro;
}

/** Último registro de disponibilidade do motorista no ERP. */
export async function buscarUltimaDisponibilidade(
  motoristaId: number,
): Promise<Record<string, unknown> | null> {
  const lista = await directusListar<Record<string, unknown>>('disponivel', {
    'filter[motorista_id][_eq]': String(motoristaId),
    sort: '-date_updated,-date_created',
    limit: '1',
    fields:
      'id,motorista_id,disponivel,status,localizacao_atual,local_disponibilidade,latitude,longitude,data_previsao_disponibilidade,observacao,date_updated,date_created',
  });
  return lista[0] ?? null;
}

/** Confirma leitura pós-gravação no Directus. */
export async function verificarDisponibilidadeNoErp(
  telefone: string,
  esperado: {
    disponivel?: boolean;
    localizacao_atual?: string;
    local_disponibilidade?: string;
    status?: string;
  },
): Promise<{ ok: boolean; registro?: Record<string, unknown>; motivo?: string }> {
  const motorista = await buscarMotoristaPorTelefone(telefone);
  if (!motorista) {
    return { ok: false, motivo: 'motorista não encontrado' };
  }

  const registro = await buscarUltimaDisponibilidade(motorista.id);
  if (!registro?.id) {
    return { ok: false, motivo: 'registro disponivel ausente no ERP' };
  }

  if (esperado.disponivel !== undefined && registro.disponivel !== esperado.disponivel) {
    return {
      ok: false,
      registro,
      motivo: `disponivel ERP=${String(registro.disponivel)} esperado=${String(esperado.disponivel)}`,
    };
  }

  if (esperado.status) {
    const st = String(registro.status ?? '').toLowerCase();
    if (st && st !== esperado.status.toLowerCase()) {
      return { ok: false, registro, motivo: `status ERP=${st} esperado=${esperado.status}` };
    }
  }

  if (esperado.localizacao_atual) {
    const locErp = String(
      registro.localizacao_atual ?? registro.local_disponibilidade ?? '',
    ).toLowerCase();
    const locEsp = esperado.localizacao_atual.toLowerCase();
    const cidadeEsp = locEsp.split(/\s+/)[0];
    if (cidadeEsp.length > 2 && !locErp.includes(cidadeEsp)) {
      return { ok: false, registro, motivo: `localização ERP="${locErp}" não contém "${cidadeEsp}"` };
    }
  }

  if (esperado.local_disponibilidade) {
    const locErp = String(registro.local_disponibilidade ?? '').toLowerCase();
    const locEsp = esperado.local_disponibilidade.toLowerCase();
    const cidadeEsp = locEsp.split(/\s+/)[0];
    if (cidadeEsp.length > 2 && !locErp.includes(cidadeEsp)) {
      return {
        ok: false,
        registro,
        motivo: `local_disponibilidade ERP="${locErp}" não contém "${cidadeEsp}"`,
      };
    }
  }

  return { ok: true, registro };
}

type TipoDocumento = 'cnh' | 'crlv' | 'antt' | 'endereco' | 'comprovante' | 'foto' | 'outro';

const TIPOS_COM_SUGESTAO_PENDENTE = new Set<string>(['cnh', 'crlv', 'antt', 'endereco', 'comprovante']);

const MAPA_COLECAO: Record<string, string> = {
  cnh: 'cnh',
  crlv: 'crlv',
  antt: 'antt',
  endereco: 'comprovante_endereco',
  comprovante: 'comprovante_endereco',
  comprovante_entrega: 'comprovante_endereco',
  foto: 'fotos',
  carreta_1: 'carreta_1',
  carreta_2: 'carreta_2',
  carreta_3: 'carreta_3',
};

/** Grava documento (OCR/comprovante) no Directus GMX */
export async function gravarDocumentoMotorista(opts: {
  telefone: string;
  midia: MidiaCacheada;
  tipo?: TipoDocumento | string;
  textoExtraido?: string;
  campos?: Record<string, unknown>;
}): Promise<{
  fileId: string;
  fileUrl: string;
  colecao: string;
  registroId: unknown;
  pendente?: boolean;
  arquivoOriginalId?: unknown;
  sugestaoId?: unknown;
}> {
  const motorista = await garantirMotorista(opts.telefone);
  const tel = normalizarTelefone(opts.telefone);
  const tipo = (opts.tipo ?? 'outro').toLowerCase() as TipoDocumento;
  const mapeado = await resolverMapeamentoOcr(tipo, opts.campos, opts.textoExtraido);
  const colecao = mapeado.colecao ?? MAPA_COLECAO[tipo] ?? 'cnh';

  if (TIPOS_COM_SUGESTAO_PENDENTE.has(tipo)) {
    return registrarOcrPendenteGmx({
      motoristaId: motorista.id,
      telefone: tel,
      tipoDocumento: tipo,
      colecaoDestino: colecao,
      midia: opts.midia,
      textoExtraido: opts.textoExtraido,
      camposExtraidos: opts.campos,
      sugestaoDocumento: mapeado.documento,
      sugestaoMotorista: mapeado.motorista,
    });
  }

  const fileId = await directusUploadArquivo(
    opts.midia.buffer,
    opts.midia.fileName,
    opts.midia.mimetype,
  );
  const fileUrl = directusAssetUrl(fileId);

  const base: Record<string, unknown> = {
    motorista_id: motorista.id,
    telefone: tel,
    link: fileUrl,
    ...(mapeado.documento || opts.campos || {}),
  };

  if (opts.textoExtraido) {
    base.observacao = opts.textoExtraido.slice(0, 4000);
  }

  if (colecao === 'cnh' && opts.textoExtraido) {
    base.n_registro_cnh = base.n_registro_cnh ?? extrairCampo(opts.textoExtraido, /registro[:\s]*(\d{9,11})/i);
    base.cpf = base.cpf ?? extrairCampo(opts.textoExtraido, /cpf[:\s]*([\d.\-]{11,14})/i);
  }

  const ultimos = await directusListar<Record<string, unknown>>(colecao, {
    'filter[motorista_id][_eq]': String(motorista.id),
    sort: '-date_created',
    limit: '1',
    fields: 'id',
  });

  let registro: Record<string, unknown>;
  if (ultimos[0]?.id) {
    registro = (await directusPatch(colecao, ultimos[0].id as number, base)) as Record<string, unknown>;
  } else {
    registro = (await directusPost(colecao, base)) as Record<string, unknown>;
  }

  const patchMotorista: Record<string, unknown> = { ...mapeado.motorista };
  if (colecao === 'cnh') {
    if (base.cpf && !patchMotorista.cpf) patchMotorista.cpf = base.cpf;
    if (base.nome && typeof base.nome === 'string' && !patchMotorista.nome) patchMotorista.nome = base.nome;
  }
  if (Object.keys(patchMotorista).length > 0) {
    await atualizarMotorista(motorista.id, patchMotorista).catch(() => undefined);
  }

  espelharMidiaWhatsappNoDrive({
    motorista,
    midia: { ...opts.midia, midiaId: opts.midia.midiaId },
    tipoDocumento: tipo,
  });

  return { fileId, fileUrl, colecao, registroId: registro.id };
}

export async function verificarDocumentoMotoristaNoErp(opts: {
  telefone: string;
  colecao: string;
  fileUrl?: string;
}): Promise<{ ok: boolean; registro?: Record<string, unknown>; motivo?: string }> {
  const motorista = await buscarMotoristaPorTelefone(opts.telefone);
  if (!motorista) {
    return { ok: false, motivo: 'motorista não encontrado' };
  }
  const lista = await directusListar<Record<string, unknown>>(opts.colecao, {
    'filter[motorista_id][_eq]': String(motorista.id),
    sort: '-date_updated,-date_created',
    limit: '3',
    fields: 'id,link,motorista_id,date_updated,date_created',
  }).catch(() => []);
  const registro = lista.find((item) => {
    if (!opts.fileUrl) return true;
    return String(item.link ?? '') === opts.fileUrl;
  });
  if (!registro) {
    return { ok: false, motivo: `documento não encontrado em ${opts.colecao}` };
  }
  return { ok: true, registro };
}

const COLECAO_CARRETA: Record<1 | 2 | 3, string> = {
  1: 'carreta_1',
  2: 'carreta_2',
  3: 'carreta_3',
};

/** Cria ou atualiza carreta (1, 2 ou 3) do motorista. */
export async function salvarCarretaMotorista(opts: {
  telefone: string;
  indice: 1 | 2 | 3;
  campos: Record<string, unknown>;
  midia?: MidiaCacheada;
}): Promise<Record<string, unknown>> {
  const motorista = await garantirMotorista(opts.telefone);
  const colecao = COLECAO_CARRETA[opts.indice];
  const tel = normalizarTelefone(opts.telefone);

  const base: Record<string, unknown> = {
    motorista_id: motorista.id,
    telefone: tel,
    ...opts.campos,
  };

  if (opts.midia) {
    const fileId = await directusUploadArquivo(
      opts.midia.buffer,
      opts.midia.fileName,
      opts.midia.mimetype,
    );
    base.link = directusAssetUrl(fileId);
  }

  const ultimos = await directusListar<Record<string, unknown>>(colecao, {
    'filter[motorista_id][_eq]': String(motorista.id),
    sort: '-date_updated,-date_created',
    limit: '1',
    fields: 'id',
  });

  if (ultimos[0]?.id) {
    const registro = (await directusPatch(colecao, ultimos[0].id as number, base)) as Record<
      string,
      unknown
    >;
    if (opts.midia) {
      espelharMidiaWhatsappNoDrive({
        motorista,
        midia: opts.midia,
        tipoDocumento: `carreta_${opts.indice}`,
      });
    }
    return registro;
  }
  const registro = (await directusPost(colecao, base)) as Record<string, unknown>;
  if (opts.midia) {
    espelharMidiaWhatsappNoDrive({
      motorista,
      midia: opts.midia,
      tipoDocumento: `carreta_${opts.indice}`,
    });
  }
  return registro;
}

function extrairCampo(texto: string, regex: RegExp): string | undefined {
  const m = texto.match(regex);
  return m?.[1];
}

/**
 * Contexto estruturado do motorista para TODA inferência.
 * @deprecated use montarContextoErpCompleto
 */
export async function obterContextoMotoristaCompleto(
  telefone: string,
  nomeContato?: string,
): Promise<string> {
  const { montarContextoErpCompleto } = await import('./contexto-erp-motorista.js');
  return montarContextoErpCompleto(telefone, nomeContato);
}

/** Registra aceite/recusa/negociação de oferta no histórico do ERP */
export async function registrarRespostaOfertaCarga(dados: {
  telefone: string;
  event_id?: string;
  aceite: boolean;
  valor_aceito?: number;
  valor_ofertado?: number;
  origem?: string;
  destino?: string;
  observacao?: string;
  embarque_id?: number | string;
  motorista_id?: number | string;
  match_id?: number | null;
}): Promise<Record<string, unknown>> {
  await garantirMotorista(dados.telefone);

  const temContraproposta =
    dados.valor_aceito != null &&
    dados.valor_ofertado != null &&
    dados.valor_aceito !== dados.valor_ofertado;

  let subtipo: string;
  if (dados.aceite) {
    subtipo = temContraproposta ? 'aceite_negociado_ia' : 'aceite_ia';
  } else if (temContraproposta || dados.valor_aceito != null) {
    subtipo = 'negociacao_ia';
  } else {
    subtipo = 'recusa_ia';
  }

  const descricao = JSON.stringify({
    evento_id: dados.event_id ?? null,
    fonte: 'iagmx_ia',
    subtipo,
    telefone: normalizarTelefone(dados.telefone),
    embarque_id: dados.embarque_id ?? null,
    motorista_id: dados.motorista_id ?? null,
    aceite: dados.aceite,
    valor_aceito: dados.valor_aceito ?? null,
    valor_ofertado: dados.valor_ofertado ?? null,
    origem: dados.origem ?? null,
    destino: dados.destino ?? null,
    observacao: dados.observacao ?? null,
  });

  return directusPost('historico_ofertas', {
    status: 'published',
    tipo_evento: 'retorno_motorista',
    match_id: dados.match_id ?? null,
    descricao,
  });
}

/** @deprecated use obterContextoMotoristaCompleto */
export async function contextoMotoristaParaPrompt(telefone: string): Promise<string> {
  return obterContextoMotoristaCompleto(telefone);
}
