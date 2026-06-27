/**
 * Gera propostas de patch para configuracoes reais da IA.
 * Encontra trechos relacionados antes de sugerir a mudanca.
 * Mantem confirmacao explicita para aplicar lote de ajustes com preview real.
 */
import pg from 'pg';
import { config } from '../config.js';
import { chatCompletionRaw } from './chat-providers.js';
import {
  montarContextoBuscaTreinamento,
  type TrechoTreinamentoRelacionado,
} from './treinamento-config-busca.js';
import {
  type AlvoPatchTreinamento,
  type OperacaoPatchTreinamento,
  type PatchTreinamentoAplicavel,
} from './treinamento-config-alvos.js';
import {
  aplicarLotePatchesTreinamento,
  simularLotePatchesTreinamento,
  type PreviewPatchTreinamento,
} from './treinamento-config-lote.js';
import {
  montarRespostaHumanaPatch,
  montarResumoPreviewTexto,
} from './treinamento-config-resposta.js';
import {
  cortar,
  normalizarOperacoes,
  parseLista,
  telefoneSeguro,
} from './treinamento-config-patch-utils.js';
import { recuperarTrechosTreinamento } from './treinamento-config-recuperacao.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

export interface PatchConfiguracaoPendente {
  id: number;
  canal: string;
  telefone_autor: string;
  nome_autor: string | null;
  alvo: AlvoPatchTreinamento;
  chave_alvo: string | null;
  operacao: OperacaoPatchTreinamento;
  trecho_atual: string | null;
  texto_proposto: string;
  resumo: string;
  justificativa: string | null;
  pergunta_confirmacao: string | null;
  preview_antes: string;
  preview_depois: string;
  origem_texto: string;
  status: 'pendente' | 'aprovado' | 'cancelado';
  confirmado_por: string | null;
  operacoes_json: PatchTreinamentoAplicavel[];
  trechos_relacionados_json: TrechoTreinamentoRelacionado[];
  previews_json: PreviewPatchTreinamento[];
  resposta_treinador: string | null;
  criado_em: string;
  atualizado_em: string;
}

interface PatchConfiguracaoSugerido {
  operacoes: PatchTreinamentoAplicavel[];
  resumo: string;
  justificativa?: string;
  perguntaConfirmacao?: string;
}

function normalizarPatchPendente(row: PatchConfiguracaoPendente): PatchConfiguracaoPendente {
  return {
    ...row,
    operacoes_json: normalizarOperacoes(row.operacoes_json),
    trechos_relacionados_json: parseLista<TrechoTreinamentoRelacionado>(row.trechos_relacionados_json),
    previews_json: parseLista<PreviewPatchTreinamento>(row.previews_json),
    resposta_treinador: row.resposta_treinador ? String(row.resposta_treinador) : null,
  };
}

export async function inicializarTreinamentoConfigPatches(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_config_patches_pendentes (
      id SERIAL PRIMARY KEY,
      canal TEXT NOT NULL DEFAULT 'whatsapp',
      telefone_autor TEXT NOT NULL,
      nome_autor TEXT,
      alvo TEXT NOT NULL,
      chave_alvo TEXT,
      operacao TEXT NOT NULL,
      trecho_atual TEXT,
      texto_proposto TEXT NOT NULL,
      resumo TEXT NOT NULL,
      justificativa TEXT,
      pergunta_confirmacao TEXT,
      preview_antes TEXT NOT NULL,
      preview_depois TEXT NOT NULL,
      origem_texto TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      confirmado_por TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE whatsapp_config_patches_pendentes
    ADD COLUMN IF NOT EXISTS operacoes_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await pool.query(`
    ALTER TABLE whatsapp_config_patches_pendentes
    ADD COLUMN IF NOT EXISTS trechos_relacionados_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await pool.query(`
    ALTER TABLE whatsapp_config_patches_pendentes
    ADD COLUMN IF NOT EXISTS previews_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await pool.query(`
    ALTER TABLE whatsapp_config_patches_pendentes
    ADD COLUMN IF NOT EXISTS resposta_treinador TEXT
  `);
}

async function sugerirPatchPorTexto(
  texto: string,
  trechos: TrechoTreinamentoRelacionado[],
): Promise<PatchConfiguracaoSugerido> {
  const contexto = montarContextoBuscaTreinamento(texto, trechos);
  const resposta = await chatCompletionRaw(
    [
      {
        role: 'system',
        content:
          'Voce e um editor tecnico da GMX. Leia os trechos relacionados e proponha um lote objetivo de ajustes. Responda SOMENTE JSON com {"operacoes":[{"alvo":"prompt_sistema|orquestracao_texto|mensagens_fluxo|ocr_prompt|ocr_prompt_forcado|ocr_documentos_schema","chave":"... ou null","operacao":"replace|append|prepend","trechoAtual":"...","textoProposto":"..."}],"resumo":"...","justificativa":"...","perguntaConfirmacao":"..."}. Use replace quando o pedido falar em trocar, corrigir ou substituir trecho. Use append para redundancia/reforco. Edite todos os trechos relevantes encontrados, mas no maximo 6 operacoes. Se o alvo for mensagens_fluxo, a chave deve ser um nome real do catalogo. Se o alvo for orquestracao_texto, a chave deve ser camadaHumana ou instrucaoFormatacao. Se o alvo for ocr_documentos_schema, a chave deve ser o id do documento (cnh, crlv, antt, endereco, foto) e o textoProposto deve ser um JSON valido do schema completo.',
      },
      {
        role: 'user',
        content: contexto,
      },
    ],
    { temperature: 0.15, max_tokens: 900 },
  );
  const match = resposta.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Nao consegui estruturar a proposta de patch');
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  const patch: PatchConfiguracaoSugerido = {
    operacoes: normalizarOperacoes(
      Array.isArray(parsed.operacoes)
        ? parsed.operacoes
        : [
            {
              alvo: parsed.alvo,
              chave: parsed.chave,
              operacao: parsed.operacao,
              trechoAtual: parsed.trechoAtual,
              textoProposto: parsed.textoProposto,
            },
          ],
    ),
    resumo: String(parsed.resumo || '').trim(),
    justificativa: parsed.justificativa ? String(parsed.justificativa) : '',
    perguntaConfirmacao: parsed.perguntaConfirmacao ? String(parsed.perguntaConfirmacao) : '',
  };
  if (!patch.operacoes.length || !patch.resumo) {
    throw new Error('A proposta veio incompleta para aplicar no treinador');
  }
  return patch;
}

export async function criarPropostaPatchConfiguracao(opts: {
  texto: string;
  telefoneAutor?: string;
  nomeAutor?: string;
  canal?: 'whatsapp' | 'dashboard';
}): Promise<PatchConfiguracaoPendente> {
  await inicializarTreinamentoConfigPatches();
  const trechos = await recuperarTrechosTreinamento(opts.texto);
  const patch = await sugerirPatchPorTexto(opts.texto, trechos);
  const previews = await simularLotePatchesTreinamento(patch.operacoes).catch((error) => {
    throw new Error(error instanceof Error ? error.message : 'Falha ao montar preview do patch');
  });
  const respostaTreinador = montarRespostaHumanaPatch({
    resumo: patch.resumo,
    justificativa: patch.justificativa,
    perguntaConfirmacao: patch.perguntaConfirmacao,
    trechos,
    previews,
  });
  const primeira = patch.operacoes[0];
  const res = await pool.query<PatchConfiguracaoPendente>(
    `INSERT INTO whatsapp_config_patches_pendentes (
      canal, telefone_autor, nome_autor, alvo, chave_alvo, operacao, trecho_atual,
      texto_proposto, resumo, justificativa, pergunta_confirmacao, preview_antes,
      preview_depois, origem_texto, operacoes_json, trechos_relacionados_json,
      previews_json, resposta_treinador, status, atualizado_em
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,'pendente',NOW())
    RETURNING *`,
    [
      opts.canal || 'whatsapp',
      telefoneSeguro(opts.telefoneAutor),
      opts.nomeAutor?.trim() || null,
      primeira.alvo,
      primeira.chave || null,
      primeira.operacao,
      primeira.trechoAtual || null,
      primeira.textoProposto,
      patch.resumo,
      patch.justificativa || null,
      patch.perguntaConfirmacao || null,
      cortar(montarResumoPreviewTexto(previews, 'antes')),
      cortar(montarResumoPreviewTexto(previews, 'depois')),
      opts.texto.trim(),
      JSON.stringify(patch.operacoes),
      JSON.stringify(trechos),
      JSON.stringify(previews),
      respostaTreinador,
    ],
  );
  const item = normalizarPatchPendente(res.rows[0]);
  item.resposta_treinador = montarRespostaHumanaPatch({
    id: item.id,
    resumo: item.resumo,
    justificativa: item.justificativa,
    perguntaConfirmacao: item.pergunta_confirmacao,
    trechos: item.trechos_relacionados_json,
    previews: item.previews_json,
  });
  return item;
}

export async function listarPatchesConfiguracaoPendentes(): Promise<PatchConfiguracaoPendente[]> {
  await inicializarTreinamentoConfigPatches();
  const res = await pool.query<PatchConfiguracaoPendente>(
    'SELECT * FROM whatsapp_config_patches_pendentes ORDER BY criado_em DESC, id DESC LIMIT 80',
  );
  return res.rows.map(normalizarPatchPendente);
}

export async function obterUltimoPatchPendentePorTelefone(
  telefone: string,
): Promise<PatchConfiguracaoPendente | null> {
  await inicializarTreinamentoConfigPatches();
  const res = await pool.query<PatchConfiguracaoPendente>(
    `SELECT * FROM whatsapp_config_patches_pendentes
     WHERE telefone_autor = $1 AND status = 'pendente'
     ORDER BY criado_em DESC, id DESC LIMIT 1`,
    [telefoneSeguro(telefone)],
  );
  return res.rows[0] ? normalizarPatchPendente(res.rows[0]) : null;
}

export async function obterPatchPendentePorId(id: number): Promise<PatchConfiguracaoPendente | null> {
  await inicializarTreinamentoConfigPatches();
  const res = await pool.query<PatchConfiguracaoPendente>(
    'SELECT * FROM whatsapp_config_patches_pendentes WHERE id = $1 LIMIT 1',
    [id],
  );
  return res.rows[0] ? normalizarPatchPendente(res.rows[0]) : null;
}

export async function aprovarPatchConfiguracao(id: number, confirmadoPor: string) {
  const patch = await obterPatchPendentePorId(id);
  if (!patch) throw new Error('Patch pendente nao encontrado');
  if (patch.status !== 'pendente') throw new Error('O patch ja foi encerrado');
  await aplicarLotePatchesTreinamento(
    patch.operacoes_json.length
      ? patch.operacoes_json
      : [
          {
            alvo: patch.alvo,
            chave: patch.chave_alvo,
            operacao: patch.operacao,
            trechoAtual: patch.trecho_atual,
            textoProposto: patch.texto_proposto,
          },
        ],
    `treinador_patch:${confirmadoPor}`,
  );
  await pool.query(
    `UPDATE whatsapp_config_patches_pendentes
     SET status = 'aprovado', confirmado_por = $2, atualizado_em = NOW()
     WHERE id = $1`,
    [id, confirmadoPor],
  );
}

export async function cancelarPatchConfiguracao(id: number, confirmadoPor: string) {
  const patch = await obterPatchPendentePorId(id);
  if (!patch) throw new Error('Patch pendente nao encontrado');
  if (patch.status !== 'pendente') throw new Error('O patch ja foi encerrado');
  await pool.query(
    `UPDATE whatsapp_config_patches_pendentes
     SET status = 'cancelado', confirmado_por = $2, atualizado_em = NOW()
     WHERE id = $1`,
    [id, confirmadoPor],
  );
}
