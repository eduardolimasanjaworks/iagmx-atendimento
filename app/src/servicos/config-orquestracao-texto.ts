/**
 * Camadas textuais editaveis da orquestracao: estilo humano e formatacao WhatsApp.
 */
import pg from 'pg';
import { config } from '../config.js';
import { CAMADA_HUMANA } from './camada-humana.js';
import { registrarHistoricoConfiguracao } from './historico-configuracao.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const CHAVE = 'orquestracao_texto';

export interface ConfigOrquestracaoTexto {
  camadaHumana: string;
  instrucaoFormatacao: string;
}

export const ORQUESTRACAO_TEXTO_PADRAO: ConfigOrquestracaoTexto = {
  camadaHumana: CAMADA_HUMANA.trim(),
  instrucaoFormatacao: config.instrucaoFormatacao.trim(),
};

let cache: ConfigOrquestracaoTexto | null = null;
let cacheEm = 0;
const CACHE_TTL_MS = 5000;

function normalizar(
  partial?: Partial<ConfigOrquestracaoTexto> | null,
): ConfigOrquestracaoTexto {
  return {
    camadaHumana: String(partial?.camadaHumana ?? ORQUESTRACAO_TEXTO_PADRAO.camadaHumana).trim(),
    instrucaoFormatacao: String(
      partial?.instrucaoFormatacao ?? ORQUESTRACAO_TEXTO_PADRAO.instrucaoFormatacao,
    ).trim(),
  };
}

export async function obterConfigOrquestracaoTexto(): Promise<ConfigOrquestracaoTexto> {
  if (cache && Date.now() - cacheEm < CACHE_TTL_MS) return cache;

  try {
    const res = await pool.query('SELECT valor FROM configuracao WHERE chave = $1', [CHAVE]);
    if (res.rowCount && res.rows[0]?.valor) {
      const parsed = JSON.parse(res.rows[0].valor as string) as Partial<ConfigOrquestracaoTexto>;
      cache = normalizar(parsed);
      cacheEm = Date.now();
      return cache;
    }
  } catch {
    /* tabela pode nao existir ainda */
  }

  cache = { ...ORQUESTRACAO_TEXTO_PADRAO };
  cacheEm = Date.now();
  return cache;
}

export async function obterConfigOrquestracaoTextoMeta(): Promise<{
  config: ConfigOrquestracaoTexto;
  padrao: ConfigOrquestracaoTexto;
  atualizadoEm: string | null;
}> {
  try {
    const res = await pool.query(
      'SELECT valor, atualizado_em FROM configuracao WHERE chave = $1',
      [CHAVE],
    );
    if (res.rowCount && res.rows[0]?.valor) {
      const parsed = JSON.parse(res.rows[0].valor as string) as Partial<ConfigOrquestracaoTexto>;
      return {
        config: normalizar(parsed),
        padrao: ORQUESTRACAO_TEXTO_PADRAO,
        atualizadoEm: res.rows[0].atualizado_em
          ? new Date(res.rows[0].atualizado_em as string).toISOString()
          : null,
      };
    }
  } catch {
    /* ignora */
  }

  return {
    config: { ...ORQUESTRACAO_TEXTO_PADRAO },
    padrao: ORQUESTRACAO_TEXTO_PADRAO,
    atualizadoEm: null,
  };
}

export async function salvarConfigOrquestracaoTexto(
  dados: Partial<ConfigOrquestracaoTexto>,
  origem = 'api_admin',
): Promise<ConfigOrquestracaoTexto> {
  const atual = await obterConfigOrquestracaoTexto();
  const normalizado = normalizar({ ...atual, ...dados });
  await pool.query(
    `INSERT INTO configuracao (chave, valor, atualizado_em)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = NOW()`,
    [CHAVE, JSON.stringify(normalizado)],
  );
  await registrarHistoricoConfiguracao({
    chave: CHAVE,
    antes: JSON.stringify(atual, null, 2),
    depois: JSON.stringify(normalizado, null, 2),
    origem,
  });
  cache = normalizado;
  cacheEm = Date.now();
  return normalizado;
}

export async function montarCabecalhoOrquestracao(): Promise<string> {
  const cfg = await obterConfigOrquestracaoTexto();
  return `${cfg.camadaHumana}\n${cfg.instrucaoFormatacao}`.trim();
}
