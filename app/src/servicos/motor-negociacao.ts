/**
 * Motor determinístico de negociação (Cenário 9) — piso/teto/rodadas em código.
 * Faixa SOMENTE do ERP: embarque (valor_minimo/maximo) ou config_rotas.
 */
import { buscarConfigRota } from './rotas-gmx.js';
import { buscarMotoristaPorTelefone } from './motorista-gmx.js';
import { listarEmbarquesAtivos } from './embarque-motorista.js';

interface OfertaNegociacao {
  origem: string;
  destino: string;
  valor: number;
  operacao?: string;
  capacidade?: string;
  configRotaId?: number | null;
}

export interface FaixaNegociacao {
  origem: string;
  destino: string;
  valorOfertado: number;
  valorMinimo: number;
  valorMaximo: number;
  configRotaId?: number | null;
  fonte: 'embarque' | 'config_rotas';
}

export interface EstadoNegociacao {
  rodadas: number;
  faixa: FaixaNegociacao;
  ultimoValorPedido?: number;
  ultimaContraofertaIa?: number;
}

export type AcaoNegociacao =
  | { tipo: 'aceite'; valorAceito: number }
  | { tipo: 'recusa' }
  | { tipo: 'contraproposta_ia'; valorProposto: number; mensagem: string }
  | { tipo: 'reprompt'; mensagem: string }
  | { tipo: 'escalonar'; motivo: string; valorPedido?: number };

const RODADAS_MAX = 3;

function normalizarRota(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

function rotasCompativeis(a: string, b: string): boolean {
  const x = normalizarRota(a);
  const y = normalizarRota(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

function faixaValida(min: number, max: number): boolean {
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min;
}

async function faixaDoEmbarqueAtivo(
  telefone: string,
  oferta: OfertaNegociacao,
): Promise<{ valorMinimo: number; valorMaximo: number; configRotaId?: number | null } | null> {
  const motorista = await buscarMotoristaPorTelefone(telefone);
  if (!motorista) return null;

  const embarques = await listarEmbarquesAtivos(motorista.id);
  for (const e of embarques) {
    if (!rotasCompativeis(e.origin ?? '', oferta.origem)) continue;
    if (!rotasCompativeis(e.destination ?? '', oferta.destino)) continue;

    const valorMinimo = Number(e.valor_minimo);
    const valorMaximo = Number(e.valor_maximo);
    if (faixaValida(valorMinimo, valorMaximo)) {
      return {
        valorMinimo,
        valorMaximo,
        configRotaId: e.config_rota_id != null ? Number(e.config_rota_id) : null,
      };
    }
  }
  return null;
}

/**
 * Obtém faixa [min, max] exclusivamente do Directus (embarque ou config_rotas).
 * Retorna null se não houver rota configurada — IA não inventa piso/teto.
 */
export async function obterFaixaNegociacao(
  oferta: OfertaNegociacao,
  telefone?: string,
): Promise<FaixaNegociacao | null> {
  if (telefone) {
    const emb = await faixaDoEmbarqueAtivo(telefone, oferta);
    if (emb) {
      return {
        origem: oferta.origem,
        destino: oferta.destino,
        valorOfertado: oferta.valor,
        valorMinimo: emb.valorMinimo,
        valorMaximo: emb.valorMaximo,
        configRotaId: emb.configRotaId ?? null,
        fonte: 'embarque',
      };
    }
  }

  const rota = await buscarConfigRota({
    id: oferta.configRotaId,
    origem: oferta.origem,
    destino: oferta.destino,
    operacao: oferta.operacao,
    capacidade: oferta.capacidade,
  });

  if (rota) {
    const valorMinimo = Number(rota.valor_minimo);
    const valorMaximo = Number(rota.valor_maximo);
    if (faixaValida(valorMinimo, valorMaximo)) {
      return {
        origem: oferta.origem,
        destino: oferta.destino,
        valorOfertado: oferta.valor,
        valorMinimo,
        valorMaximo,
        configRotaId: rota.id,
        fonte: 'config_rotas',
      };
    }
  }

  return null;
}

/** Extrai valor monetário em reais (ex.: 5 mil → 5000). */
export function extrairValorMonetario(texto: string): number | null {
  const t = texto.toLowerCase();
  const mil = /\b(\d{1,2}(?:[.,]\d+)?)\s*mil\b/i.exec(t);
  if (mil) {
    const base = parseFloat(mil[1].replace(',', '.'));
    if (Number.isFinite(base)) return Math.round(base * 1000);
  }

  const quatro = t.match(/\b(\d{4,})\b/);
  if (quatro) {
    const v = parseInt(quatro[1], 10);
    if (Number.isFinite(v) && v >= 100) return v;
  }

  const m = t.match(/r\$\s*([\d.,]+)|(\d{1,3}(?:\.\d{3})+(?:,\d{2})?)/i);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;

  let v = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(v) || v < 100) return null;
  if (v < 1000 && /\bmil\b|\bk\b/i.test(t)) v *= 1000;
  return Math.round(v);
}

function formatarValor(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function motoristaRecusou(mensagem: string): boolean {
  const t = mensagem.toLowerCase();
  return /\b(n[aã]o\s+rola|recuso|sem\s+interesse|n[aã]o\s+topo|passo|muito\s+longe|to\s+longe)\b/.test(
    t,
  );
}

export function motoristaAceitou(mensagem: string): boolean {
  const t = mensagem.toLowerCase();
  return /\b(topo|fechado|aceito|confirmo|pode\s+ser|bora|fecho|fechou|combinado)\b/.test(t);
}

function valorDentroDaFaixa(valor: number, faixa: FaixaNegociacao): boolean {
  return valor >= faixa.valorMinimo && valor <= faixa.valorMaximo;
}

/**
 * Decide ação de negociação para a mensagem atual.
 * Regra: só aceita valores dentro de [valor_minimo, valor_maximo] do ERP.
 */
export function avaliarNegociacao(opts: {
  mensagem: string;
  faixa: FaixaNegociacao;
  estado: EstadoNegociacao;
}): AcaoNegociacao {
  const { mensagem, faixa, estado } = opts;
  const valorMsg = extrairValorMonetario(mensagem);

  if (motoristaRecusou(mensagem)) {
    return { tipo: 'recusa' };
  }

  if (valorMsg != null) {
    if (valorMsg < faixa.valorMinimo) {
      const rodadas = estado.rodadas + 1;
      if (rodadas >= RODADAS_MAX) {
        return {
          tipo: 'escalonar',
          motivo: 'negociacao_abaixo_piso',
          valorPedido: valorMsg,
        };
      }
      return {
        tipo: 'reprompt',
        mensagem: `O mínimo pra essa rota é R$ ${formatarValor(faixa.valorMinimo)} parceiro, consegue nesse valor?`,
      };
    }

    if (valorMsg > faixa.valorMaximo) {
      const rodadas = estado.rodadas + 1;
      if (rodadas >= RODADAS_MAX) {
        return {
          tipo: 'escalonar',
          motivo: 'negociacao_acima_teto',
          valorPedido: valorMsg,
        };
      }
      return {
        tipo: 'contraproposta_ia',
        valorProposto: faixa.valorMaximo,
        mensagem: `Entendi os R$ ${formatarValor(valorMsg)} parceiro, o máximo pra essa rota é R$ ${formatarValor(faixa.valorMaximo)}, topa nesse valor?`,
      };
    }

    if (motoristaAceitou(mensagem) || /\b(fechado|topo|aceito|fecho)\b/i.test(mensagem)) {
      return { tipo: 'aceite', valorAceito: valorMsg };
    }

    return {
      tipo: 'contraproposta_ia',
      valorProposto: valorMsg,
      mensagem: `Entendi R$ ${formatarValor(valorMsg)} parceiro, fechamos nesse valor?`,
    };
  }

  if (motoristaAceitou(mensagem)) {
    const candidato =
      estado.ultimoValorPedido != null && valorDentroDaFaixa(estado.ultimoValorPedido, faixa)
        ? estado.ultimoValorPedido
        : estado.ultimaContraofertaIa != null &&
            valorDentroDaFaixa(estado.ultimaContraofertaIa, faixa)
          ? estado.ultimaContraofertaIa
          : valorDentroDaFaixa(faixa.valorOfertado, faixa)
            ? faixa.valorOfertado
            : faixa.valorMaximo;

    return { tipo: 'aceite', valorAceito: candidato };
  }

  if (/\b(interesse|to\s+em|estou\s+em|por\s+aqui)\b/i.test(mensagem) && !valorMsg) {
    return {
      tipo: 'reprompt',
      mensagem: `Beleza parceiro, o valor da carga é R$ ${formatarValor(faixa.valorOfertado)}, topa ou quer negociar?`,
    };
  }

  return {
    tipo: 'reprompt',
    mensagem: `Me diz se topa o frete de R$ ${formatarValor(faixa.valorOfertado)} ou qual valor você precisa parceiro`,
  };
}

export function atualizarEstadoNegociacao(
  estado: EstadoNegociacao,
  acao: AcaoNegociacao,
  mensagem: string,
): EstadoNegociacao {
  const valorMsg = extrairValorMonetario(mensagem);
  const next = { ...estado };

  if (acao.tipo === 'contraproposta_ia' || acao.tipo === 'reprompt') {
    next.rodadas = estado.rodadas + 1;
    if (valorMsg != null) next.ultimoValorPedido = valorMsg;
    if (acao.tipo === 'contraproposta_ia') next.ultimaContraofertaIa = acao.valorProposto;
  }

  return next;
}
