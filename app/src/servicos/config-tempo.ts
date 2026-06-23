/**
 * Tempos de resposta — editável no admin (Postgres).
 */
import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const CHAVE = 'config_tempo';

export interface ConfigTempo {
  debounceMs: number;
  debounceWorkerMs: number;
}

export const TEMPO_PADRAO: ConfigTempo = {
  debounceMs: 2200,
  debounceWorkerMs: 300,
};

let cache: ConfigTempo | null = null;
let cacheEm = 0;
const CACHE_TTL_MS = 3000;

function normalizar(partial: Partial<ConfigTempo>): ConfigTempo {
  const base = { ...TEMPO_PADRAO, ...partial };
  return {
    debounceMs: Math.max(1500, Math.min(8000, Math.floor(base.debounceMs))),
    debounceWorkerMs: Math.max(100, Math.min(2000, Math.floor(base.debounceWorkerMs))),
  };
}

export async function obterConfigTempo(): Promise<ConfigTempo> {
  if (cache && Date.now() - cacheEm < CACHE_TTL_MS) return cache;
  try {
    const res = await pool.query('SELECT valor FROM configuracao WHERE chave = $1', [CHAVE]);
    if (res.rowCount && res.rows[0]?.valor) {
      cache = normalizar(JSON.parse(res.rows[0].valor as string) as Partial<ConfigTempo>);
      cacheEm = Date.now();
      return cache;
    }
  } catch {
    /* ignora */
  }
  cache = {
    debounceMs: config.debounceMs,
    debounceWorkerMs: config.debounceWorkerMs,
  };
  cacheEm = Date.now();
  return cache;
}

export async function salvarConfigTempo(dados: Partial<ConfigTempo>): Promise<ConfigTempo> {
  const atual = await obterConfigTempo();
  const normalizado = normalizar({ ...atual, ...dados });
  await pool.query(
    `INSERT INTO configuracao (chave, valor, atualizado_em)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = NOW()`,
    [CHAVE, JSON.stringify(normalizado)],
  );
  cache = normalizado;
  cacheEm = Date.now();
  return normalizado;
}
