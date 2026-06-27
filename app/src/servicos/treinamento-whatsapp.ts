import pg from 'pg';
import { config } from '../config.js';
import { normalizarTelefone } from '../util/telefone.js';
import { chatCompletionRaw } from './chat-providers.js';
import { adicionarAoHistorico, obterHistorico } from './historico.js';
import { registrarHistoricoConfiguracao } from './historico-configuracao.js';
import {
  aprovarPatchConfiguracao,
  cancelarPatchConfiguracao,
  criarPropostaPatchConfiguracao,
  listarPatchesConfiguracaoPendentes,
  obterUltimoPatchPendentePorTelefone,
} from './treinamento-config-patches.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

export interface TelefoneTreinador {
  id: number;
  telefone: string;
  nome: string | null;
  cargo: string | null;
  observacoes: string | null;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface AprendizadoWhatsapp {
  id: number;
  telefone_autor: string;
  nome_autor: string | null;
  instrucao: string;
  resumo: string | null;
  origem_texto: string;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface PropostaAprendizadoWhatsapp {
  id: number;
  telefone_autor: string;
  nome_autor: string | null;
  instrucao_sugerida: string;
  resumo_sugerido: string | null;
  origem_texto: string;
  status: 'pendente' | 'aprovado' | 'cancelado';
  confirmado_em: string | null;
  confirmado_por: string | null;
  criado_em: string;
  atualizado_em: string;
}

function paraBoolean(valor: unknown): boolean {
  return valor === true || valor === 'true' || valor === 1;
}

export async function inicializarTreinamentoWhatsapp(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_telefones_treinadores (
      id SERIAL PRIMARY KEY,
      telefone TEXT NOT NULL UNIQUE,
      nome TEXT,
      cargo TEXT,
      observacoes TEXT,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_aprendizados (
      id SERIAL PRIMARY KEY,
      telefone_autor TEXT NOT NULL,
      nome_autor TEXT,
      instrucao TEXT NOT NULL,
      resumo TEXT,
      origem_texto TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_whatsapp_treinadores_telefone
    ON whatsapp_telefones_treinadores (telefone, ativo)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_whatsapp_aprendizados_ativo
    ON whatsapp_aprendizados (ativo, criado_em DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_aprendizados_pendentes (
      id SERIAL PRIMARY KEY,
      telefone_autor TEXT NOT NULL,
      nome_autor TEXT,
      instrucao_sugerida TEXT NOT NULL,
      resumo_sugerido TEXT,
      origem_texto TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      confirmado_em TIMESTAMPTZ,
      confirmado_por TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_whatsapp_aprendizados_pendentes_status
    ON whatsapp_aprendizados_pendentes (status, criado_em DESC)
  `);
}

export async function listarTelefonesTreinadores(): Promise<TelefoneTreinador[]> {
  await inicializarTreinamentoWhatsapp();
  const res = await pool.query<TelefoneTreinador>(
    'SELECT * FROM whatsapp_telefones_treinadores ORDER BY ativo DESC, nome NULLS LAST, id DESC',
  );
  return res.rows.map((row) => ({ ...row, ativo: paraBoolean(row.ativo) }));
}

export async function criarTelefoneTreinador(body: {
  telefone: string;
  nome?: string;
  cargo?: string;
  observacoes?: string;
  ativo?: boolean;
}): Promise<TelefoneTreinador> {
  await inicializarTreinamentoWhatsapp();
  const telefone = normalizarTelefone(body.telefone || '');
  if (!telefone || telefone.length < 10) {
    throw new Error('Telefone invalido para treinamento via WhatsApp');
  }
  const res = await pool.query<TelefoneTreinador>(
    `INSERT INTO whatsapp_telefones_treinadores (telefone, nome, cargo, observacoes, ativo, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [
      telefone,
      body.nome?.trim() || null,
      body.cargo?.trim() || null,
      body.observacoes?.trim() || null,
      body.ativo ?? true,
    ],
  );
  return { ...res.rows[0], ativo: paraBoolean(res.rows[0].ativo) };
}

export async function atualizarTelefoneTreinador(
  id: number,
  body: { telefone?: string; nome?: string; cargo?: string; observacoes?: string; ativo?: boolean },
): Promise<TelefoneTreinador> {
  await inicializarTreinamentoWhatsapp();
  const atual = await pool.query<TelefoneTreinador>(
    'SELECT * FROM whatsapp_telefones_treinadores WHERE id = $1 LIMIT 1',
    [id],
  );
  if (!atual.rowCount) throw new Error('Telefone treinador nao encontrado');
  const row = atual.rows[0];
  const telefone = body.telefone !== undefined ? normalizarTelefone(body.telefone) : row.telefone;
  if (!telefone || telefone.length < 10) {
    throw new Error('Telefone invalido para treinamento via WhatsApp');
  }
  const res = await pool.query<TelefoneTreinador>(
    `UPDATE whatsapp_telefones_treinadores
     SET telefone = $2,
         nome = $3,
         cargo = $4,
         observacoes = $5,
         ativo = $6,
         atualizado_em = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      telefone,
      body.nome !== undefined ? body.nome.trim() || null : row.nome,
      body.cargo !== undefined ? body.cargo.trim() || null : row.cargo,
      body.observacoes !== undefined ? body.observacoes.trim() || null : row.observacoes,
      body.ativo ?? paraBoolean(row.ativo),
    ],
  );
  return { ...res.rows[0], ativo: paraBoolean(res.rows[0].ativo) };
}

export async function excluirTelefoneTreinador(id: number): Promise<void> {
  await inicializarTreinamentoWhatsapp();
  await pool.query('DELETE FROM whatsapp_telefones_treinadores WHERE id = $1', [id]);
}

export async function telefoneAutorizadoTreinamento(telefone: string): Promise<boolean> {
  await inicializarTreinamentoWhatsapp();
  const numero = normalizarTelefone(telefone);
  if (!numero) return false;
  const res = await pool.query(
    'SELECT 1 FROM whatsapp_telefones_treinadores WHERE telefone = $1 AND ativo = TRUE LIMIT 1',
    [numero],
  );
  return Number(res.rowCount ?? 0) > 0;
}

export async function listarAprendizadosWhatsapp(): Promise<AprendizadoWhatsapp[]> {
  await inicializarTreinamentoWhatsapp();
  const res = await pool.query<AprendizadoWhatsapp>(
    'SELECT * FROM whatsapp_aprendizados ORDER BY ativo DESC, criado_em DESC LIMIT 80',
  );
  return res.rows.map((row) => ({ ...row, ativo: paraBoolean(row.ativo) }));
}

export async function listarPendenciasAprendizadoWhatsapp(): Promise<PropostaAprendizadoWhatsapp[]> {
  await inicializarTreinamentoWhatsapp();
  const res = await pool.query<PropostaAprendizadoWhatsapp>(
    'SELECT * FROM whatsapp_aprendizados_pendentes ORDER BY criado_em DESC LIMIT 80',
  );
  return res.rows as PropostaAprendizadoWhatsapp[];
}

export async function excluirAprendizadoWhatsapp(id: number): Promise<void> {
  await inicializarTreinamentoWhatsapp();
  const antes = await obterBlocoTreinamentoWhatsapp();
  await pool.query('DELETE FROM whatsapp_aprendizados WHERE id = $1', [id]);
  const depois = await obterBlocoTreinamentoWhatsapp();
  await registrarHistoricoConfiguracao({
    chave: 'whatsapp_aprendizados',
    origem: 'api_admin',
    antes,
    depois,
  });
}

async function obterPropostaPendentePorId(id: number): Promise<PropostaAprendizadoWhatsapp | null> {
  await inicializarTreinamentoWhatsapp();
  const res = await pool.query<PropostaAprendizadoWhatsapp>(
    'SELECT * FROM whatsapp_aprendizados_pendentes WHERE id = $1 LIMIT 1',
    [id],
  );
  return res.rows[0] ?? null;
}

async function obterUltimaPropostaPendentePorTelefone(
  telefone: string,
): Promise<PropostaAprendizadoWhatsapp | null> {
  await inicializarTreinamentoWhatsapp();
  const res = await pool.query<PropostaAprendizadoWhatsapp>(
    `SELECT * FROM whatsapp_aprendizados_pendentes
     WHERE telefone_autor = $1 AND status = 'pendente'
     ORDER BY criado_em DESC, id DESC
     LIMIT 1`,
    [normalizarTelefone(telefone)],
  );
  return res.rows[0] ?? null;
}

async function aplicarPropostaAprendizado(
  proposta: PropostaAprendizadoWhatsapp,
  confirmadoPor: string,
): Promise<AprendizadoWhatsapp> {
  const antes = await obterBlocoTreinamentoWhatsapp();
  const insert = await pool.query<AprendizadoWhatsapp>(
    `INSERT INTO whatsapp_aprendizados (
      telefone_autor, nome_autor, instrucao, resumo, origem_texto, ativo, atualizado_em
    ) VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
    RETURNING *`,
    [
      proposta.telefone_autor,
      proposta.nome_autor,
      proposta.instrucao_sugerida,
      proposta.resumo_sugerido,
      proposta.origem_texto,
    ],
  );
  await pool.query(
    `UPDATE whatsapp_aprendizados_pendentes
     SET status = 'aprovado', confirmado_em = NOW(), confirmado_por = $2, atualizado_em = NOW()
     WHERE id = $1`,
    [proposta.id, confirmadoPor],
  );
  const depois = await obterBlocoTreinamentoWhatsapp();
  await registrarHistoricoConfiguracao({
    chave: 'whatsapp_aprendizados',
    origem: `whatsapp_treinador_confirmado:${confirmadoPor}`,
    antes,
    depois,
  });
  return { ...insert.rows[0], ativo: paraBoolean(insert.rows[0].ativo) };
}

export async function aprovarPendenciaAprendizadoWhatsapp(
  id: number,
  confirmadoPor: string,
): Promise<AprendizadoWhatsapp> {
  const proposta = await obterPropostaPendentePorId(id);
  if (!proposta) throw new Error('Proposta pendente nao encontrada');
  if (proposta.status !== 'pendente') throw new Error('A proposta ja foi encerrada');
  return aplicarPropostaAprendizado(proposta, confirmadoPor);
}

export async function cancelarPendenciaAprendizadoWhatsapp(
  id: number,
  confirmadoPor: string,
): Promise<void> {
  const proposta = await obterPropostaPendentePorId(id);
  if (!proposta) throw new Error('Proposta pendente nao encontrada');
  if (proposta.status !== 'pendente') throw new Error('A proposta ja foi encerrada');
  await pool.query(
    `UPDATE whatsapp_aprendizados_pendentes
     SET status = 'cancelado', confirmado_em = NOW(), confirmado_por = $2, atualizado_em = NOW()
     WHERE id = $1`,
    [id, confirmadoPor],
  );
}

async function obterPromptBaseAtual(): Promise<string> {
  const res = await pool.query('SELECT valor FROM configuracao WHERE chave = $1', ['prompt_sistema']);
  return (res.rows[0]?.valor as string) || config.promptPadrao;
}

export async function obterBlocoTreinamentoWhatsapp(): Promise<string> {
  await inicializarTreinamentoWhatsapp();
  const res = await pool.query<AprendizadoWhatsapp>(
    `SELECT * FROM whatsapp_aprendizados
     WHERE ativo = TRUE
     ORDER BY criado_em ASC, id ASC
     LIMIT 60`,
  );
  const linhas = res.rows
    .map((row, idx) => `- Regra ${idx + 1}: ${row.instrucao}`)
    .join('\n');
  return linhas
    ? `=== TREINAMENTO VIA WHATSAPP AUTORIZADO ===\nAs regras abaixo foram ensinadas por telefones autorizados da GMX e alteram o comportamento da IA com efeito imediato:\n${linhas}`
    : '';
}

async function resumirInstrucaoTreinamento(texto: string): Promise<{ instrucao: string; resumo: string }> {
  const resposta = await chatCompletionRaw(
    [
      {
        role: 'system',
        content:
          'Voce transforma pedidos de treinamento em regras operacionais curtas para uma IA de atendimento da GMX. Responda SOMENTE JSON com {"instrucao":"...","resumo":"..."}',
      },
      {
        role: 'user',
        content: `Converta o texto abaixo em uma regra clara, objetiva e acionavel, sem perder intencao:\n\n${texto}`,
      },
    ],
    { temperature: 0.2, max_tokens: 220 },
  );

  const match = resposta.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { instrucao?: string; resumo?: string };
      const instrucao = parsed.instrucao?.trim();
      const resumo = parsed.resumo?.trim();
      if (instrucao) {
        return { instrucao, resumo: resumo || instrucao };
      }
    } catch {
    }
  }

  const sane = texto.replace(/\s+/g, ' ').trim();
  return {
    instrucao: sane,
    resumo: sane.slice(0, 180),
  };
}

async function classificarIntencaoTreinamento(texto: string): Promise<'aprendizado' | 'patch' | 'pergunta' | 'normal'> {
  const resposta = await chatCompletionRaw(
    [
      {
        role: 'system',
        content: 'Voce classifica mensagens de treinadores autorizados de uma IA de atendimento. Responda SOMENTE uma palavra: "aprendizado" se for ensinar uma nova regra/comportamento, "patch" se for editar/corrigir textos existentes, "pergunta" se for perguntar sobre como a IA funciona, ou "normal" para conversa comum.',
      },
      {
        role: 'user',
        content: texto,
      },
    ],
    { temperature: 0.1, max_tokens: 20 },
  );
  const classificacao = resposta.toLowerCase().trim();
  if (classificacao.includes('aprendizado') || classificacao.includes('regra') || classificacao.includes('comportamento')) return 'aprendizado';
  if (classificacao.includes('patch') || classificacao.includes('editar') || classificacao.includes('corrigir') || classificacao.includes('substituir')) return 'patch';
  if (classificacao.includes('pergunta') || classificacao.includes('como') || classificacao.includes('o que')) return 'pergunta';
  return 'normal';
}

function parecePedidoDeAprendizado(texto: string): boolean {
  return /(aprenda|aprender|adicione|inclua|grave|guarde|nova regra|regra:|treino:|a partir de agora|sempre|nunca|quando .* voce|mude seu comportamento|quero que voce)/i.test(
    texto,
  );
}

function parecePerguntaSobrePrompt(texto: string): boolean {
  return /(prompt|comportamento|como voce responde|o que voce aprendeu|quais regras|resuma|explique como vai agir)/i.test(
    texto,
  );
}

function matchConfirmacao(texto: string): number | null {
  const match = texto.match(/^(confirmar|aprovar)(?:\s+(?:aprendizado|regra|proposta))?(?:\s*#?\s*(\d+))?$/i);
  if (!match) return null;
  return match[2] ? Number(match[2]) : -1;
}

function matchCancelamento(texto: string): number | null {
  const match = texto.match(/^(cancelar|rejeitar|descartar)(?:\s+(?:aprendizado|regra|proposta))?(?:\s*#?\s*(\d+))?$/i);
  if (!match) return null;
  return match[2] ? Number(match[2]) : -1;
}

function matchConfirmacaoPatch(texto: string): number | null {
  const match = texto.match(/^(confirmar|aprovar)(?:\s+patch)?(?:\s*#?\s*(\d+))?$/i);
  if (!match || !/patch/i.test(texto)) return null;
  return match[2] ? Number(match[2]) : -1;
}

function matchCancelamentoPatch(texto: string): number | null {
  const match = texto.match(/^(cancelar|rejeitar|descartar)(?:\s+patch)?(?:\s*#?\s*(\d+))?$/i);
  if (!match || !/patch/i.test(texto)) return null;
  return match[2] ? Number(match[2]) : -1;
}

function parecePedidoDePatch(texto: string): boolean {
  return /(substitu|troc|corrig|reescrev|acrescent|adicione|reforc|redundan|bloco|trecho|prompt|mensagem|orquestr|estilo|tom|fluxo|ajuste esse texto|mude esse texto)/i.test(
    texto,
  );
}

export async function processarMensagemTreinamentoWhatsapp(opts: {
  telefone: string;
  remoteJid: string;
  textoUsuario: string;
  pushName?: string;
}): Promise<string> {
  await inicializarTreinamentoWhatsapp();
  const texto = opts.textoUsuario.trim();
  await adicionarAoHistorico(opts.remoteJid, 'user', texto);

  const intencao = await classificarIntencaoTreinamento(texto);
  
  if (intencao === 'patch') {
    try {
      const patch = await criarPropostaPatchConfiguracao({
        texto,
        telefoneAutor: opts.telefone,
        nomeAutor: opts.pushName,
        canal: 'whatsapp',
      });
      await aprovarPatchConfiguracao(patch.id, normalizarTelefone(opts.telefone));
      const resposta = `Aplicado: ${patch.resumo}. O alvo ${patch.alvo}${patch.chave_alvo ? `.${patch.chave_alvo}` : ''} foi atualizado.`;
      await adicionarAoHistorico(opts.remoteJid, 'assistant', resposta);
      return resposta;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'falha desconhecida';
      const detail = (message === 'A proposta veio incompleta para aplicar no treinador' || message === 'Nao consegui estruturar a proposta de patch')
        ? 'O pedido pareceu vago ou a IA não conseguiu interpretar o alvo. Tente ser mais específico sobre o que trocar e onde.'
        : message;
      const resposta = `Nao consegui aplicar a mudanca: ${detail}. Pode reformular?`;
      await adicionarAoHistorico(opts.remoteJid, 'assistant', resposta);
      return resposta;
    }
  }

  if (intencao === 'aprendizado') {
    const cleaned = texto.replace(/(aprenda|aprender|adicione|inclua|grave|guarde|nova regra|regra:|treino:|a partir de agora|sempre|nunca|quando .* voce|mude seu comportamento|quero que voce)\s*/i, '').trim();
    const alphanumericCount = cleaned.replace(/[^a-zA-Z0-9À-ÿ]/g, '').length;
    if (alphanumericCount < 5) {
      const resposta = 'Para criar uma nova regra, forneça uma instrução mais clara ou detalhada, com palavras reais.';
      await adicionarAoHistorico(opts.remoteJid, 'assistant', resposta);
      return resposta;
    }

    const { instrucao, resumo } = await resumirInstrucaoTreinamento(texto);
    const aprendizadoRes = await pool.query<AprendizadoWhatsapp>(
      `INSERT INTO whatsapp_aprendizados (
        telefone_autor, nome_autor, instrucao, resumo, origem_texto, ativo, atualizado_em
      ) VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
      RETURNING *`,
      [
        normalizarTelefone(opts.telefone),
        opts.pushName?.trim() || null,
        instrucao,
        resumo,
        texto,
      ],
    );
    const aprendizado = aprendizadoRes.rows[0];
    const resposta = `Regra aplicada: ${resumo || instrucao}. A IA já está usando esta nova instrução.`;
    await adicionarAoHistorico(opts.remoteJid, 'assistant', resposta);
    return resposta;
  }

  if (/listar.*(aprendizados|regras)|quais regras|o que voce aprendeu/i.test(texto)) {
    const aprendizados = await listarAprendizadosWhatsapp();
    const ativos = aprendizados.filter((item) => item.ativo).slice(0, 12);
    const resposta = ativos.length
      ? `Estou usando estas regras: ${ativos
          .map((item, idx) => `${idx + 1}) ${item.resumo || item.instrucao}`)
          .join(' | ')}`
      : 'Ainda não tenho regras personalizadas ativas.';
    await adicionarAoHistorico(opts.remoteJid, 'assistant', resposta);
    return resposta;
  }

  const promptAtual = await obterPromptBaseAtual();
  const blocoTreino = await obterBlocoTreinamentoWhatsapp();
  const historico = (await obterHistorico(opts.remoteJid)).slice(-8);
  const resposta = await chatCompletionRaw(
    [
      {
        role: 'system',
        content: `Voce esta em um canal de treino da GMX no WhatsApp.
Converse como um operador tecnico claro e objetivo.
Explique o comportamento atual da IA, incluindo prompt base e aprendizados ativos.
No modo treinador, nunca diga que vai pausar, escalar para humano ou encerrar por falta de autonomia.
Se houver erro interno, explique o erro e peca um novo comando sem sair do modo treinador.
Se o usuario estiver so perguntando, responda normalmente.
Se o usuario quiser alterar comportamento, a IA vai aplicar diretamente.

PROMPT BASE ATUAL:
${promptAtual}

${blocoTreino || 'SEM APRENDIZADOS ADICIONAIS ATIVOS NO MOMENTO'}`,
      },
      ...historico,
      {
        role: 'user',
        content: texto,
      },
    ],
    { temperature: 0.25, max_tokens: 420 },
  );
  await adicionarAoHistorico(opts.remoteJid, 'assistant', resposta);
  return resposta;
}
