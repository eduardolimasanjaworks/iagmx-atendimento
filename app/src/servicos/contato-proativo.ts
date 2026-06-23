import { config } from '../config.js';
import { pool } from './prompt.js';
import { directusConfigurado, directusListar } from './directus.js';
import { tentarEnviarResposta } from './enviar-resposta.js';
import { adicionarAoHistorico } from './historico.js';
import { marcarEnvioIa } from './envio-ia.js';
import { logEvento } from '../util/log-eventos.js';
import { normalizarTelefone, telefoneParaJid } from '../util/telefone.js';

export interface LoteContatoProativo {
  id: number;
  data_referencia: string;
  status: string;
  total_sugeridos: number;
  criterios_json: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ItemContatoProativo {
  id: number;
  lote_id: number;
  motorista_id: number;
  telefone: string;
  nome: string | null;
  cidade: string | null;
  estado: string | null;
  operacao: string | null;
  status_item: string;
  prioridade_score: number;
  score_tempo: number;
  score_geo: number;
  score_status: number;
  horas_sem_contato: number | null;
  horas_sem_posicao: number | null;
  justificativa: string | null;
  ultima_conversa_em: string | null;
  ultima_posicao_em: string | null;
  localizacao_atual: string | null;
  observacao: string | null;
  aprovado_em: string | null;
  aprovado_por: string | null;
  disparado_em: string | null;
  disparado_por: string | null;
  erro_envio: string | null;
  adiar_ate: string | null;
}

export interface HistoricoContatoProativoItem extends ItemContatoProativo {
  data_referencia: string;
}

interface MotoristaBase {
  id: number;
  nome?: string | null;
  sobrenome?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  estado?: string | null;
  tipo_rota?: string | null;
  ia_pausada?: boolean | null;
  precisa_atendimento?: boolean | null;
  ultima_intencao_em?: string | null;
  status_cadastro?: string | null;
  observacao?: string | null;
}

interface DisponibilidadeAtual {
  id: number;
  motorista_id?: number | { id?: number } | null;
  disponivel?: boolean | null;
  status?: string | null;
  localizacao_atual?: string | null;
  date_updated?: string | null;
  date_created?: string | null;
}

interface SugestaoContato {
  motoristaId: number;
  telefone: string;
  nome: string;
  cidade: string | null;
  estado: string | null;
  operacao: string | null;
  prioridadeScore: number;
  scoreTempo: number;
  scoreGeo: number;
  scoreStatus: number;
  horasSemContato: number | null;
  horasSemPosicao: number | null;
  justificativa: string;
  ultimaConversaEm: string | null;
  ultimaPosicaoEm: string | null;
  localizacaoAtual: string | null;
  observacao: string | null;
}

function inicioDoDiaBr(): string {
  return new Date().toISOString().slice(0, 10);
}

function horasDesde(iso?: string | null): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / 36e5);
}

function nomeMotorista(motorista: MotoristaBase): string {
  const nome = `${motorista.nome ?? ''} ${motorista.sobrenome ?? ''}`.trim();
  return nome || `Motorista ${motorista.id}`;
}

function dataDisponibilidade(disponibilidade?: DisponibilidadeAtual | null): string | null {
  return disponibilidade?.date_updated ?? disponibilidade?.date_created ?? null;
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

function normalizarMotoristaId(valor: DisponibilidadeAtual['motorista_id']): number | null {
  if (typeof valor === 'number') return valor;
  if (valor && typeof valor === 'object' && typeof valor.id === 'number') return valor.id;
  return null;
}

function montarMensagemContatoProativo(item: ItemContatoProativo): string {
  return item.localizacao_atual
    ? `Bom dia parceiro, a GMX esta atualizando a localizacao da frota de hoje, me confirma por favor sua localizacao atual, no ultimo registro voce estava em ${item.localizacao_atual}`
    : 'Bom dia parceiro, a GMX esta atualizando a localizacao da frota de hoje, me confirma por favor sua localizacao atual com cidade e estado';
}

function scoreLocalizacao(disponibilidade?: DisponibilidadeAtual | null): {
  score: number;
  horasSemPosicao: number | null;
} {
  const horasSemPosicao = horasDesde(dataDisponibilidade(disponibilidade));
  if (!disponibilidade?.localizacao_atual) {
    return { score: 999, horasSemPosicao };
  }
  if (horasSemPosicao == null) {
    return { score: 888, horasSemPosicao };
  }
  return { score: Math.round(horasSemPosicao * 100) / 100, horasSemPosicao };
}

function podeSugerirContato(
  motorista: MotoristaBase,
  disponibilidade?: DisponibilidadeAtual | null,
): boolean {
  const telefone = normalizarTelefone(motorista.telefone || '');
  if (!telefone || telefone.length < 10) return false;
  if (bool(motorista.ia_pausada) || bool(motorista.precisa_atendimento)) return false;
  const horasPosicao = horasDesde(dataDisponibilidade(disponibilidade));
  if ((horasPosicao ?? Infinity) < config.contatoProativoMinHorasSemPosicao) {
    return false;
  }
  return true;
}

function criarSugestao(
  motorista: MotoristaBase,
  disponibilidade?: DisponibilidadeAtual | null,
): SugestaoContato | null {
  if (!podeSugerirContato(motorista, disponibilidade)) return null;
  const telefone = normalizarTelefone(motorista.telefone || '');
  const localizacao = scoreLocalizacao(disponibilidade);
  const prioridadeScore = localizacao.score;
  const local = disponibilidade?.localizacao_atual ?? null;
  const partes = [
    local
      ? (localizacao.horasSemPosicao == null
          ? `posicao ${local} sem data confiavel`
          : `${Math.round(localizacao.horasSemPosicao)}h desde a ultima localizacao registrada em ${local}`)
      : 'sem localizacao registrada ainda',
  ];

  return {
    motoristaId: motorista.id,
    telefone,
    nome: nomeMotorista(motorista),
    cidade: motorista.cidade ?? null,
    estado: motorista.estado ?? null,
    operacao: motorista.tipo_rota ?? null,
    prioridadeScore,
    scoreTempo: prioridadeScore,
    scoreGeo: 0,
    scoreStatus: 0,
    horasSemContato: null,
    horasSemPosicao: localizacao.horasSemPosicao,
    justificativa: partes.join(', '),
    ultimaConversaEm: null,
    ultimaPosicaoEm: dataDisponibilidade(disponibilidade),
    localizacaoAtual: local,
    observacao: motorista.observacao ?? null,
  };
}

export async function inicializarContatoProativo(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contato_proativo_lote (
      id SERIAL PRIMARY KEY,
      data_referencia DATE NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'aberto',
      total_sugeridos INTEGER NOT NULL DEFAULT 0,
      criterios_json TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contato_proativo_item (
      id SERIAL PRIMARY KEY,
      lote_id INTEGER NOT NULL REFERENCES contato_proativo_lote(id) ON DELETE CASCADE,
      motorista_id INTEGER NOT NULL,
      telefone TEXT NOT NULL,
      nome TEXT,
      cidade TEXT,
      estado TEXT,
      operacao TEXT,
      status_item TEXT NOT NULL DEFAULT 'pendente',
      prioridade_score NUMERIC(10,2) NOT NULL DEFAULT 0,
      score_tempo NUMERIC(10,2) NOT NULL DEFAULT 0,
      score_geo NUMERIC(10,2) NOT NULL DEFAULT 0,
      score_status NUMERIC(10,2) NOT NULL DEFAULT 0,
      horas_sem_contato NUMERIC(10,2),
      horas_sem_posicao NUMERIC(10,2),
      justificativa TEXT,
      ultima_conversa_em TIMESTAMPTZ,
      ultima_posicao_em TIMESTAMPTZ,
      localizacao_atual TEXT,
      observacao TEXT,
      aprovado_em TIMESTAMPTZ,
      aprovado_por TEXT,
      disparado_em TIMESTAMPTZ,
      disparado_por TEXT,
      erro_envio TEXT,
      adiar_ate TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (lote_id, motorista_id)
    )
  `);

  await pool.query(`
    ALTER TABLE contato_proativo_item
    ADD COLUMN IF NOT EXISTS adiar_ate TIMESTAMPTZ
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contato_proativo_item_lote_status
    ON contato_proativo_item (lote_id, status_item, prioridade_score DESC)
  `);
}

async function carregarMotoristasBase(): Promise<MotoristaBase[]> {
  return directusListar<MotoristaBase>('cadastro_motorista', {
    limit: '2500',
    sort: '-date_created',
    fields:
      'id,nome,sobrenome,telefone,cidade,estado,tipo_rota,ia_pausada,precisa_atendimento,ultima_intencao_em,status_cadastro,observacao',
  });
}

async function carregarDisponibilidadesBase(): Promise<Map<number, DisponibilidadeAtual>> {
  const rows = await directusListar<DisponibilidadeAtual>('disponivel', {
    limit: '5000',
    sort: '-date_updated,-date_created',
    fields: 'id,motorista_id,disponivel,status,localizacao_atual,date_updated,date_created',
  });
  const map = new Map<number, DisponibilidadeAtual>();
  for (const row of rows) {
    const motoristaId = normalizarMotoristaId(row.motorista_id);
    if (!motoristaId || map.has(motoristaId)) continue;
    map.set(motoristaId, row);
  }
  return map;
}

async function carregarMotoristasAdiados(dataReferencia: string): Promise<Set<number>> {
  const res = await pool.query<{ motorista_id: number }>(
    `SELECT DISTINCT motorista_id
     FROM contato_proativo_item
     WHERE adiar_ate IS NOT NULL
       AND adiar_ate >= $1::date`,
    [dataReferencia],
  );
  return new Set(res.rows.map((row) => row.motorista_id));
}

export async function gerarLoteContatoProativo(opts?: {
  force?: boolean;
  dataReferencia?: string;
}): Promise<{ lote: LoteContatoProativo; itens: ItemContatoProativo[] }> {
  await inicializarContatoProativo();
  const dataReferencia = opts?.dataReferencia ?? inicioDoDiaBr();

  const existente = await pool.query<LoteContatoProativo>(
    'SELECT * FROM contato_proativo_lote WHERE data_referencia = $1 LIMIT 1',
    [dataReferencia],
  );

  if (existente.rowCount && !opts?.force) {
    return obterLoteContatoProativoAtual(dataReferencia);
  }

  if (!directusConfigurado()) {
    throw new Error('Directus não configurado para gerar fila de contato proativo');
  }

  const [motoristas, disponibilidades, motoristasAdiados] = await Promise.all([
    carregarMotoristasBase(),
    carregarDisponibilidadesBase(),
    carregarMotoristasAdiados(dataReferencia),
  ]);

  const sugestoes = motoristas
    .filter((motorista) => !motoristasAdiados.has(motorista.id))
    .map((motorista) => criarSugestao(motorista, disponibilidades.get(motorista.id)))
    .filter((item): item is SugestaoContato => Boolean(item))
    .sort((a, b) => b.prioridadeScore - a.prioridadeScore)
    .slice(0, config.contatoProativoLimiteDiario);

  const criterios = JSON.stringify({
    limiteDiario: config.contatoProativoLimiteDiario,
    minHorasSemPosicao: config.contatoProativoMinHorasSemPosicao,
    criterioPrincipal: 'tempo_desde_ultima_localizacao',
    geradoEm: new Date().toISOString(),
  });

  let loteId: number;
  if (existente.rowCount) {
    loteId = existente.rows[0].id;
    await pool.query(
      `UPDATE contato_proativo_lote
       SET status = 'aberto', total_sugeridos = $2, criterios_json = $3, atualizado_em = NOW()
       WHERE id = $1`,
      [loteId, sugestoes.length, criterios],
    );
    await pool.query('DELETE FROM contato_proativo_item WHERE lote_id = $1', [loteId]);
  } else {
    const insert = await pool.query<{ id: number }>(
      `INSERT INTO contato_proativo_lote (data_referencia, status, total_sugeridos, criterios_json)
       VALUES ($1, 'aberto', $2, $3)
       RETURNING id`,
      [dataReferencia, sugestoes.length, criterios],
    );
    loteId = insert.rows[0].id;
  }

  for (const item of sugestoes) {
    await pool.query(
      `INSERT INTO contato_proativo_item (
        lote_id, motorista_id, telefone, nome, cidade, estado, operacao, status_item,
        prioridade_score, score_tempo, score_geo, score_status, horas_sem_contato,
        horas_sem_posicao, justificativa, ultima_conversa_em, ultima_posicao_em,
        localizacao_atual, observacao
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,'pendente',
        $8,$9,$10,$11,$12,
        $13,$14,$15,$16,
        $17,$18
      )`,
      [
        loteId,
        item.motoristaId,
        item.telefone,
        item.nome,
        item.cidade,
        item.estado,
        item.operacao,
        item.prioridadeScore,
        item.scoreTempo,
        item.scoreGeo,
        item.scoreStatus,
        item.horasSemContato,
        item.horasSemPosicao,
        item.justificativa,
        item.ultimaConversaEm,
        item.ultimaPosicaoEm,
        item.localizacaoAtual,
        item.observacao,
      ],
    );
  }

  logEvento('contato_proativo', 'Lote diário gerado', {
    data_referencia: dataReferencia,
    total: sugestoes.length,
  });

  return obterLoteContatoProativoAtual(dataReferencia);
}

export async function obterLoteContatoProativoAtual(
  dataReferencia?: string,
): Promise<{ lote: LoteContatoProativo; itens: ItemContatoProativo[] }> {
  await inicializarContatoProativo();
  const data = dataReferencia ?? inicioDoDiaBr();
  const loteRes = await pool.query<LoteContatoProativo>(
    'SELECT * FROM contato_proativo_lote WHERE data_referencia = $1 LIMIT 1',
    [data],
  );
  if (!loteRes.rowCount) {
    return gerarLoteContatoProativo({ dataReferencia: data });
  }
  const lote = loteRes.rows[0];
  const itensRes = await pool.query<ItemContatoProativo>(
    `SELECT * FROM contato_proativo_item
     WHERE lote_id = $1
     ORDER BY prioridade_score DESC NULLS LAST, id ASC`,
    [lote.id],
  );
  return { lote, itens: itensRes.rows };
}

export async function atualizarStatusContatoProativo(
  itemId: number,
  status: 'aprovado' | 'rejeitado' | 'adiado',
  autor = 'portal',
  observacao?: string,
  opts?: { adiarDias?: number },
): Promise<ItemContatoProativo> {
  await inicializarContatoProativo();
  const adiarDias = Math.max(0, Number(opts?.adiarDias ?? 0));
  const res = await pool.query<ItemContatoProativo>(
    `UPDATE contato_proativo_item
     SET status_item = $2,
         aprovado_em = CASE
           WHEN $2 = 'aprovado' THEN NOW()
           WHEN $2 IN ('adiado', 'rejeitado') THEN NULL
           ELSE aprovado_em
         END,
         aprovado_por = CASE
           WHEN $2 = 'aprovado' THEN $3
           ELSE aprovado_por
         END,
         adiar_ate = CASE
           WHEN $2 = 'adiado' AND $5 > 0 THEN NOW() + ($5 || ' days')::interval
           WHEN $2 = 'rejeitado' THEN NULL
           ELSE adiar_ate
         END,
         observacao = COALESCE($4, observacao),
         atualizado_em = NOW()
     WHERE id = $1
     RETURNING *`,
    [itemId, status, autor, observacao ?? null, adiarDias],
  );
  if (!res.rowCount) throw new Error('Item de contato proativo não encontrado');
  return res.rows[0];
}

export async function adiarContatoProativo(
  itemId: number,
  dias: number,
  autor = 'portal',
  observacao?: string,
): Promise<ItemContatoProativo> {
  const diasNormalizados = Math.max(1, Math.round(dias));
  return atualizarStatusContatoProativo(
    itemId,
    'adiado',
    autor,
    observacao ?? `Contato adiado por ${diasNormalizados} dia(s)`,
    { adiarDias: diasNormalizados },
  );
}

export async function dispararContatoProativo(
  itemId: number,
  autor = 'portal',
): Promise<{ item: ItemContatoProativo; enviado: boolean; motivo?: string; filaId?: string }> {
  await inicializarContatoProativo();
  const itemRes = await pool.query<ItemContatoProativo>(
    'SELECT * FROM contato_proativo_item WHERE id = $1 LIMIT 1',
    [itemId],
  );
  if (!itemRes.rowCount) throw new Error('Item de contato proativo não encontrado');
  const item = itemRes.rows[0];
  if (item.status_item !== 'aprovado') {
    throw new Error('Somente itens aprovados podem ser disparados');
  }

  const texto = montarMensagemContatoProativo(item);
  const remoteJid = telefoneParaJid(item.telefone);
  const envio = await tentarEnviarResposta(item.telefone, texto, config.evolutionInstance, {
    remoteJid,
    mensagensEntrada: 0,
    origem: 'evolution',
    fragmentar: false,
    agendarAtrasoInicial: false,
  });

  if (envio.enviado) {
    await marcarEnvioIa(item.telefone, 8);
    await adicionarAoHistorico(remoteJid, 'empresa', texto);
    const atualizado = await pool.query<ItemContatoProativo>(
      `UPDATE contato_proativo_item
       SET status_item = 'disparado',
           disparado_em = NOW(),
           disparado_por = $2,
           erro_envio = NULL,
           atualizado_em = NOW()
       WHERE id = $1
       RETURNING *`,
      [itemId, autor],
    );
    logEvento('contato_proativo', 'Mensagem proativa enviada', {
      item_id: itemId,
      telefone: item.telefone,
      motorista_id: item.motorista_id,
    });
    return { item: atualizado.rows[0], enviado: true };
  }

  const atualizado = await pool.query<ItemContatoProativo>(
    `UPDATE contato_proativo_item
     SET erro_envio = $2,
         atualizado_em = NOW()
     WHERE id = $1
     RETURNING *`,
    [itemId, envio.motivo ?? 'falha_envio'],
  );
  return { item: atualizado.rows[0], enviado: false, motivo: envio.motivo, filaId: envio.filaId };
}

export async function aprovarItensContatoProativo(
  itemIds: number[],
  autor = 'portal',
): Promise<ItemContatoProativo[]> {
  const ids = [...new Set(itemIds)].filter((id) => Number.isFinite(id));
  const itens: ItemContatoProativo[] = [];
  for (const id of ids) {
    itens.push(await atualizarStatusContatoProativo(id, 'aprovado', autor));
  }
  return itens;
}

export async function adiarItensContatoProativo(
  itemIds: number[],
  dias: number,
  autor = 'portal',
  observacao?: string,
): Promise<ItemContatoProativo[]> {
  const ids = [...new Set(itemIds)].filter((id) => Number.isFinite(id));
  const itens: ItemContatoProativo[] = [];
  for (const id of ids) {
    itens.push(await adiarContatoProativo(id, dias, autor, observacao));
  }
  return itens;
}

export async function listarHistoricoContatoProativo(limit = 100): Promise<HistoricoContatoProativoItem[]> {
  await inicializarContatoProativo();
  const max = Math.min(500, Math.max(1, limit));
  const res = await pool.query<HistoricoContatoProativoItem>(
    `SELECT i.*, l.data_referencia
     FROM contato_proativo_item i
     INNER JOIN contato_proativo_lote l ON l.id = i.lote_id
     WHERE i.disparado_em IS NOT NULL
     ORDER BY i.disparado_em DESC, i.id DESC
     LIMIT $1`,
    [max],
  );
  return res.rows;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dispararContatosProativoEmLote(opts: {
  itemIds: number[];
  autor?: string;
  intervaloMs?: number;
}): Promise<{
  enviados: Array<{ id: number; telefone: string }>;
  falhas: Array<{ id: number; telefone?: string; motivo: string }>;
}> {
  const ids = [...new Set(opts.itemIds)].filter((id) => Number.isFinite(id));
  const autor = opts.autor ?? 'portal';
  const intervaloMs = Math.max(60_000, opts.intervaloMs ?? 60_000);
  const enviados: Array<{ id: number; telefone: string }> = [];
  const falhas: Array<{ id: number; telefone?: string; motivo: string }> = [];

  for (let idx = 0; idx < ids.length; idx++) {
    const id = ids[idx];
    try {
      const resultado = await dispararContatoProativo(id, autor);
      if (resultado.enviado) {
        enviados.push({ id, telefone: resultado.item.telefone });
      } else {
        falhas.push({
          id,
          telefone: resultado.item.telefone,
          motivo: resultado.motivo ?? 'nao_enviado',
        });
      }
    } catch (error) {
      falhas.push({
        id,
        motivo: error instanceof Error ? error.message : 'falha_desconhecida',
      });
    }

    if (idx < ids.length - 1 && intervaloMs > 0) {
      await esperar(intervaloMs);
    }
  }

  return { enviados, falhas };
}
