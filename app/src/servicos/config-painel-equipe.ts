import pg from 'pg';
import { config } from '../config.js';
import { registrarHistoricoConfiguracao } from './historico-configuracao.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const CHAVE = 'painel_equipe_visibilidade';

export const BLOCOS_EQUIPE_DISPONIVEIS = [
  'resumo_operacional',
  'comando_rapido',
  'prompt_principal',
  'prompt_ocr',
  'estilo_formatacao',
  'mensagens_fluxo',
  'operacao_avancada',
  'editor_visual',
  'painel_etapas',
  'conexao_numero_ia',
] as const;

export type BlocoEquipe = (typeof BLOCOS_EQUIPE_DISPONIVEIS)[number];

export interface ConfigPainelEquipe {
  blocosVisiveis: BlocoEquipe[];
}

export const CONFIG_PAINEL_EQUIPE_PADRAO: ConfigPainelEquipe = {
  blocosVisiveis: ['resumo_operacional', 'conexao_numero_ia'],
};

function normalizar(
  partial?: Partial<ConfigPainelEquipe> | null,
): ConfigPainelEquipe {
  const permitidos = new Set(BLOCOS_EQUIPE_DISPONIVEIS);
  const blocosVisiveis = Array.isArray(partial?.blocosVisiveis)
    ? partial.blocosVisiveis.filter((item): item is BlocoEquipe => permitidos.has(item as BlocoEquipe))
    : CONFIG_PAINEL_EQUIPE_PADRAO.blocosVisiveis;

  return {
    blocosVisiveis: Array.from(new Set(blocosVisiveis)),
  };
}

export async function obterConfigPainelEquipe(): Promise<ConfigPainelEquipe> {
  try {
    const res = await pool.query('SELECT valor FROM configuracao WHERE chave = $1', [CHAVE]);
    if (res.rowCount && res.rows[0]?.valor) {
      return normalizar(JSON.parse(res.rows[0].valor as string) as Partial<ConfigPainelEquipe>);
    }
  } catch {
    /* ignora */
  }
  return { ...CONFIG_PAINEL_EQUIPE_PADRAO };
}

export async function salvarConfigPainelEquipe(
  dados: Partial<ConfigPainelEquipe>,
  origem = 'painel_admin',
): Promise<ConfigPainelEquipe> {
  const atual = await obterConfigPainelEquipe();
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
  return normalizado;
}

export async function equipePodeVer(bloco: BlocoEquipe): Promise<boolean> {
  const cfg = await obterConfigPainelEquipe();
  return cfg.blocosVisiveis.includes(bloco);
}
