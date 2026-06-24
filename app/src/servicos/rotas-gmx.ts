/**
 * Consulta rotas de negociação no Directus GMX (portal /root/gmx).
 */
import { config } from '../config.js';
import { chaveRotaOperacional } from './rota-operacional.js';

type RegrasOperacionais = NonNullable<ConfigRotaGmx['regras_operacionais']>;

export interface ConfigRotaGmx {
  id: number;
  origem: string;
  destino: string;
  operacao?: string;
  capacidade?: string | null;
  valor_minimo: number;
  valor_maximo: number;
  ativo?: boolean;
  evidencia?: string | null;
  preferencia_proximidade?: 'agora' | 'coleta' | null;
  gps_max_horas?: number | string | null;
  passo_negociacao_modo?: 'proporcional' | 'fixo' | null;
  passo_negociacao_valor?: number | string | null;
  escalar_humano_no_teto?: boolean | null;
  regras_operacionais?: {
    preferencia_proximidade?: 'agora' | 'coleta';
    gps_max_horas?: number;
    passo_negociacao_modo?: 'proporcional' | 'fixo';
    passo_negociacao_valor?: number;
    escalar_humano_no_teto?: boolean;
  };
}

export interface TelefoneNotificacaoGmx {
  id: number;
  nome: string;
  telefone: string;
  ativo?: boolean;
}

function headersDirectus() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.directusToken}`,
  };
}

function parseRegrasLegado(raw?: string | null): RegrasOperacionais {
  const texto = String(raw ?? '').trim();
  if (!texto.startsWith('GMX_RULES::')) return {};
  try {
    const parsed = JSON.parse(texto.slice('GMX_RULES::'.length)) as Record<string, unknown>;
    return {
      preferencia_proximidade:
        parsed.preferencia_proximidade === 'agora' ? 'agora' : parsed.preferencia_proximidade === 'coleta' ? 'coleta' : undefined,
      gps_max_horas: Number.isFinite(Number(parsed.gps_max_horas)) ? Number(parsed.gps_max_horas) : undefined,
      passo_negociacao_modo:
        parsed.passo_negociacao_modo === 'fixo' ? 'fixo' : parsed.passo_negociacao_modo === 'proporcional' ? 'proporcional' : undefined,
      passo_negociacao_valor:
        Number.isFinite(Number(parsed.passo_negociacao_valor)) ? Number(parsed.passo_negociacao_valor) : undefined,
      escalar_humano_no_teto:
        parsed.escalar_humano_no_teto === true ? true : undefined,
    };
  } catch {
    return {};
  }
}

function parseRegrasRota(rota?: Partial<ConfigRotaGmx> | null): RegrasOperacionais {
  const legado = parseRegrasLegado(rota?.evidencia);
  return {
    preferencia_proximidade:
      rota?.preferencia_proximidade === 'agora'
        ? 'agora'
        : rota?.preferencia_proximidade === 'coleta'
          ? 'coleta'
          : legado.preferencia_proximidade,
    gps_max_horas:
      Number.isFinite(Number(rota?.gps_max_horas)) && Number(rota?.gps_max_horas) > 0
        ? Number(rota?.gps_max_horas)
        : legado.gps_max_horas,
    passo_negociacao_modo:
      rota?.passo_negociacao_modo === 'fixo'
        ? 'fixo'
        : rota?.passo_negociacao_modo === 'proporcional'
          ? 'proporcional'
          : legado.passo_negociacao_modo,
    passo_negociacao_valor:
      Number.isFinite(Number(rota?.passo_negociacao_valor)) && Number(rota?.passo_negociacao_valor) > 0
        ? Number(rota?.passo_negociacao_valor)
        : legado.passo_negociacao_valor,
    escalar_humano_no_teto:
      rota?.escalar_humano_no_teto === false
        ? false
        : rota?.escalar_humano_no_teto === true
          ? true
          : legado.escalar_humano_no_teto,
  };
}

async function lerRotasAtivas(): Promise<ConfigRotaGmx[]> {
  if (!config.directusToken || !config.directusUrl) return [];
  const url = `${config.directusUrl}/items/config_rotas?filter[ativo][_eq]=true&limit=5000`;
  const res = await fetch(url, { headers: headersDirectus(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: ConfigRotaGmx[] };
  return (body.data ?? []).map((rota) => ({
    ...rota,
    regras_operacionais: parseRegrasRota(rota),
  }));
}

export async function listarConfigRotasAtivas(): Promise<ConfigRotaGmx[]> {
  const lista = await lerRotasAtivas();
  return [...lista].sort((a, b) => {
    const origem = a.origem.localeCompare(b.origem, 'pt-BR');
    if (origem !== 0) return origem;
    const destino = a.destino.localeCompare(b.destino, 'pt-BR');
    if (destino !== 0) return destino;
    return String(a.operacao || '').localeCompare(String(b.operacao || ''), 'pt-BR');
  });
}

/** Busca rota por origem/destino/operação (operação exata normalizada). */
export async function buscarConfigRota(opts: {
  id?: number | string | null;
  origem?: string;
  destino?: string;
  operacao?: string;
  capacidade?: string | null;
}): Promise<ConfigRotaGmx | null> {
  if (!config.directusToken || !config.directusUrl) return null;

  const rotaId = Number(opts.id);
  if (Number.isFinite(rotaId) && rotaId > 0) {
    const res = await fetch(`${config.directusUrl}/items/config_rotas/${rotaId}`, {
      headers: headersDirectus(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: ConfigRotaGmx };
    const rota = body.data ?? null;
    if (!rota || rota.ativo === false) return null;
    return { ...rota, regras_operacionais: parseRegrasRota(rota) };
  }

  const lista = await lerRotasAtivas();
  const alvo = chaveRotaOperacional({
    origem: opts.origem ?? '',
    destino: opts.destino ?? '',
    operacao: opts.operacao ?? null,
    capacidade: opts.capacidade ?? null,
  });

  const match = lista.find((r) => {
    const chave = chaveRotaOperacional({
      origem: r.origem,
      destino: r.destino,
      operacao: r.operacao ?? null,
      capacidade: r.capacidade ?? null,
    });
    return chave === alvo;
  });

  return match ?? null;
}

export async function listarTelefonesNotificacao(): Promise<TelefoneNotificacaoGmx[]> {
  if (!config.directusToken || !config.directusUrl) return [];

  const url = `${config.directusUrl}/items/telefones_notificacao?filter[ativo][_eq]=true&limit=50`;
  const res = await fetch(url, { headers: headersDirectus(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];

  const body = (await res.json()) as { data?: TelefoneNotificacaoGmx[] };
  return body.data ?? [];
}

/** Texto injetado no prompt quando há rota configurada. */
export function formatarContextoRotaNegociacao(
  rota: ConfigRotaGmx,
  valorOfertadoMensagem?: number,
): string {
  const min = Number(rota.valor_minimo);
  const max = Number(rota.valor_maximo);
  const oferta = valorOfertadoMensagem ?? min;
  return `=== ROTA CONFIGURADA (portal GMX — obrigatório) ===
Origem: ${rota.origem}
Destino: ${rota.destino}
Operação: ${rota.operacao || '—'}
Valor mínimo negociável: R$ ${min.toFixed(0)}
Valor máximo negociável: R$ ${max.toFixed(0)}
Valor inicial da oferta na mensagem: R$ ${oferta.toFixed(0)}

Regras:
- NUNCA aceite abaixo de R$ ${min.toFixed(0)} nem acima de R$ ${max.toFixed(0)}
- Preferencia de proximidade: ${rota.regras_operacionais?.preferencia_proximidade === 'agora' ? 'local atual' : 'local na data de coleta'}
- GPS maximo aceito: ${rota.regras_operacionais?.gps_max_horas ?? 24}h
- Degrau de negociacao: ${rota.regras_operacionais?.passo_negociacao_modo === 'fixo' ? `fixo de R$ ${(rota.regras_operacionais?.passo_negociacao_valor ?? 100).toFixed(0)}` : 'proporcional à faixa'}
- Escalar humano no teto: ${rota.regras_operacionais?.escalar_humano_no_teto === false ? 'nao' : 'sim'}
- Se motorista contrapropõe, suba GRADUALMENTE dentro da faixa (não pule direto pro máximo)
- Após 3 rodadas sem acordo ou pedido abaixo do mínimo: use ferramenta escalonar_negociacao e pause`;
}
