import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

export interface HistoricoConfiguracaoItem {
  id: number;
  chave: string;
  origem: string;
  antes: string | null;
  depois: string | null;
  criadoEm: string;
}

let tabelaInicializada = false;

async function garantirTabela(): Promise<void> {
  if (tabelaInicializada) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracao_historico (
      id BIGSERIAL PRIMARY KEY,
      chave TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'sistema',
      antes TEXT,
      depois TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  tabelaInicializada = true;
}

export async function registrarHistoricoConfiguracao(opts: {
  chave: string;
  antes: string | null;
  depois: string | null;
  origem?: string;
}): Promise<void> {
  if ((opts.antes ?? null) === (opts.depois ?? null)) return;
  await garantirTabela();
  await pool.query(
    `INSERT INTO configuracao_historico (chave, origem, antes, depois)
     VALUES ($1, $2, $3, $4)`,
    [opts.chave, opts.origem ?? 'sistema', opts.antes, opts.depois],
  );
}

export async function listarHistoricoConfiguracao(limite = 20): Promise<HistoricoConfiguracaoItem[]> {
  await garantirTabela();
  const res = await pool.query(
    `SELECT id, chave, origem, antes, depois, criado_em
     FROM configuracao_historico
     ORDER BY id DESC
     LIMIT $1`,
    [limite],
  );

  return res.rows.map((row) => ({
    id: Number(row.id),
    chave: String(row.chave),
    origem: String(row.origem),
    antes: row.antes ? String(row.antes) : null,
    depois: row.depois ? String(row.depois) : null,
    criadoEm: new Date(row.criado_em as string).toISOString(),
  }));
}
