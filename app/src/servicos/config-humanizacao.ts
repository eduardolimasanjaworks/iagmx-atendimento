/**
 * Configurações de humanização de envio (Postgres + cache em memória).
 */
import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const CHAVE = 'humanizacao_envio';

export interface ConfigHumanizacao {
  /** Atraso antes do primeiro envio da resposta completa (ms) */
  atrasoInicialMinMs: number;
  atrasoInicialMaxMs: number;
  /** Delay aleatório entre mensagens (ms) */
  delayMinMs: number;
  delayMaxMs: number;
  /** Duração aleatória do "digitando..." antes de cada fragmento (ms) */
  digitandoMinMs: number;
  digitandoMaxMs: number;
  /** Ativa sendPresence composing na Evolution */
  digitandoAtivo: boolean;
}

export const HUMANIZACAO_PADRAO: ConfigHumanizacao = {
  atrasoInicialMinMs: 300_000,
  atrasoInicialMaxMs: 600_000,
  delayMinMs: 1800,
  delayMaxMs: 4200,
  digitandoMinMs: 1200,
  digitandoMaxMs: 3200,
  digitandoAtivo: true,
};

let cache: ConfigHumanizacao | null = null;
let cacheEm = 0;
const CACHE_TTL_MS = 5000;

function normalizar(partial: Partial<ConfigHumanizacao>): ConfigHumanizacao {
  const base = { ...HUMANIZACAO_PADRAO, ...partial };
  const atrasoInicialMinMs = Math.max(60_000, Math.min(base.atrasoInicialMinMs, base.atrasoInicialMaxMs));
  const atrasoInicialMaxMs = Math.min(900_000, Math.max(atrasoInicialMinMs, base.atrasoInicialMaxMs));
  const delayMinMs = Math.max(1200, Math.min(base.delayMinMs, base.delayMaxMs));
  const delayMaxMs = Math.min(10000, Math.max(delayMinMs, base.delayMaxMs));
  const digitandoMinMs = Math.max(1000, Math.min(base.digitandoMinMs, base.digitandoMaxMs));
  const digitandoMaxMs = Math.min(12000, Math.max(digitandoMinMs, base.digitandoMaxMs));
  return {
    atrasoInicialMinMs,
    atrasoInicialMaxMs,
    delayMinMs,
    delayMaxMs,
    digitandoMinMs,
    digitandoMaxMs,
    digitandoAtivo: Boolean(base.digitandoAtivo),
  };
}

export async function obterConfigHumanizacao(): Promise<ConfigHumanizacao> {
  if (cache && Date.now() - cacheEm < CACHE_TTL_MS) return cache;

  try {
    const res = await pool.query('SELECT valor FROM configuracao WHERE chave = $1', [CHAVE]);
    if (res.rowCount && res.rows[0]?.valor) {
      const parsed = JSON.parse(res.rows[0].valor as string) as Partial<ConfigHumanizacao>;
      cache = normalizar(parsed);
      cacheEm = Date.now();
      return cache;
    }
  } catch {
    /* tabela pode não existir ainda */
  }

  cache = { ...HUMANIZACAO_PADRAO };
  cacheEm = Date.now();
  return cache;
}

export async function salvarConfigHumanizacao(dados: Partial<ConfigHumanizacao>): Promise<ConfigHumanizacao> {
  const normalizado = normalizar(dados);
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

/** Inteiro aleatório inclusivo entre min e max */
export function aleatorioEntre(min: number, max: number): number {
  const a = Math.floor(min);
  const b = Math.floor(max);
  if (b <= a) return a;
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function aguardar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
