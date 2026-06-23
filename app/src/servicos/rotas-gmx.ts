/**
 * Consulta rotas de negociação no Directus GMX (portal /root/gmx).
 */
import { config } from '../config.js';

export interface ConfigRotaGmx {
  id: number;
  origem: string;
  destino: string;
  operacao?: string;
  capacidade?: string | null;
  valor_minimo: number;
  valor_maximo: number;
  ativo?: boolean;
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

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Busca rota por origem/destino/operação (match flexível por substring). */
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
    return rota;
  }

  const url = `${config.directusUrl}/items/config_rotas?filter[ativo][_eq]=true&limit=5000`;
  const res = await fetch(url, { headers: headersDirectus(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;

  const body = (await res.json()) as { data?: ConfigRotaGmx[] };
  const lista = body.data ?? [];
  const o = normalizar(opts.origem ?? '');
  const d = normalizar(opts.destino ?? '');
  const op = opts.operacao ? normalizar(opts.operacao) : '';
  const cap = opts.capacidade ? normalizar(opts.capacidade) : '';

  const match = lista.find((r) => {
    const ro = normalizar(r.origem);
    const rd = normalizar(r.destino);
    const rop = r.operacao ? normalizar(r.operacao) : '';
    const rcap = r.capacidade ? normalizar(r.capacidade) : '';
    const origemOk = ro.includes(o) || o.includes(ro);
    const destinoOk = rd.includes(d) || d.includes(rd);
    const opOk = !op || !rop || rop.includes(op) || op.includes(rop);
    const capOk = !cap || !rcap || rcap.includes(cap) || cap.includes(rcap);
    return origemOk && destinoOk && opOk && capOk;
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
  const oferta = valorOfertadoMensagem ?? max;
  return `=== ROTA CONFIGURADA (portal GMX — obrigatório) ===
Origem: ${rota.origem}
Destino: ${rota.destino}
Operação: ${rota.operacao || '—'}
Valor mínimo negociável: R$ ${min.toFixed(0)}
Valor máximo negociável: R$ ${max.toFixed(0)}
Valor inicial da oferta na mensagem: R$ ${oferta.toFixed(0)}

Regras:
- NUNCA aceite abaixo de R$ ${min.toFixed(0)} nem acima de R$ ${max.toFixed(0)}
- Se motorista contrapropõe, suba GRADUALMENTE dentro da faixa (não pule direto pro máximo)
- Após 3 rodadas sem acordo ou pedido abaixo do mínimo: use ferramenta escalonar_negociacao e pause`;
}
