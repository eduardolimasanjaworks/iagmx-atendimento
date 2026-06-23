/**
 * Persistência do prompt do sistema no Postgres + indexação Qdrant.
 */
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import { config } from '../config.js';
import { indexarPrompt, montarPromptComRag } from './vetorizacao.js';
import { registrarHistoricoConfiguracao } from './historico-configuracao.js';
import { obterBlocoTreinamentoWhatsapp } from './treinamento-whatsapp.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

/** Localiza arquivo de prompt inicial no disco */
function localizarPromptInicial(): string | null {
  for (const caminho of config.promptArquivoInicial) {
    if (existsSync(caminho)) return readFileSync(caminho, 'utf-8');
  }
  return null;
}

/** Cria tabelas e importa prompt inicial se necessário */
export async function inicializarBanco(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracao (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      atualizado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const existe = await pool.query(
    'SELECT valor FROM configuracao WHERE chave = $1',
    ['prompt_sistema'],
  );

  const promptArquivo = localizarPromptInicial();

  if (existe.rowCount === 0) {
    const promptInicial = promptArquivo ?? config.promptPadrao;
    await pool.query(
      'INSERT INTO configuracao (chave, valor) VALUES ($1, $2)',
      ['prompt_sistema', promptInicial],
    );
    console.log(`[prompt] Prompt inicial importado (${promptInicial.length} chars)`);
  }
  // Não sobrescreve prompt editado no admin ao reiniciar — só seed na primeira vez.
}

/** Retorna prompt bruto do banco */
export async function obterPromptBruto(): Promise<string> {
  const res = await pool.query(
    'SELECT valor FROM configuracao WHERE chave = $1',
    ['prompt_sistema'],
  );
  return res.rows[0]?.valor ?? config.promptPadrao;
}

export async function obterPromptMeta(): Promise<{
  prompt: string;
  caracteres: number;
  atualizadoEm: string | null;
}> {
  const res = await pool.query(
    'SELECT valor, atualizado_em FROM configuracao WHERE chave = $1',
    ['prompt_sistema'],
  );
  const prompt = (res.rows[0]?.valor as string) ?? config.promptPadrao;
  return {
    prompt,
    caracteres: prompt.length,
    atualizadoEm: res.rows[0]?.atualizado_em
      ? new Date(res.rows[0].atualizado_em as string).toISOString()
      : null,
  };
}

/**
 * Retorna prompt montado para inferência (com RAG se necessário).
 */
export async function obterPromptParaInferencia(
  mensagemUsuario: string,
): Promise<string> {
  const promptCompleto = await obterPromptBruto();
  const blocoTreino = await obterBlocoTreinamentoWhatsapp().catch(() => '');
  const promptFinal = [promptCompleto, blocoTreino].filter(Boolean).join('\n\n');
  return montarPromptComRag(promptFinal, mensagemUsuario);
}

/** Atualiza prompt e reindexa no Qdrant */
export async function salvarPrompt(
  prompt: string,
  origem = 'api_admin',
): Promise<{ qdrantOk: boolean }> {
  const atual = await obterPromptBruto();
  await pool.query(
    `INSERT INTO configuracao (chave, valor, atualizado_em)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = NOW()`,
    ['prompt_sistema', prompt],
  );
  await registrarHistoricoConfiguracao({
    chave: 'prompt_sistema',
    antes: atual,
    depois: prompt,
    origem,
  });
  let qdrantOk = true;
  try {
    await indexarPrompt(prompt);
  } catch (err) {
    qdrantOk = false;
    console.error('[prompt] Erro ao indexar no Qdrant:', err);
  }
  return { qdrantOk };
}

/** Indexa prompt atual no Qdrant (chamado na inicialização) */
export async function sincronizarVetores(): Promise<void> {
  const prompt = await obterPromptBruto();
  const indexacao = indexarPrompt(prompt);
  const timeoutMs = 45_000;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`timeout de ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    if (prompt.length <= config.limitePromptRag) {
      console.log('[prompt] Prompt curto — indexação Qdrant opcional');
    }
    await Promise.race([indexacao, timeout]);
  } catch (err) {
    // Falha de indexação não pode bloquear subida da API.
    console.error(
      '[prompt] Falha ao sincronizar vetores (seguindo sem bloquear boot):',
      err instanceof Error ? err.message : err,
    );
  }
}

export async function verificarPostgres(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export { pool };
