/**
 * Motor determinístico de negociação (Cenário 9) — piso/teto/rodadas em código.
 * Faixa SOMENTE do ERP: embarque (valor_minimo/maximo) ou config_rotas.
 */
import { buscarConfigRota } from './rotas-gmx.js';
import { buscarMotoristaPorTelefone } from './motorista-gmx.js';
import { listarEmbarquesAtivos } from './embarque-motorista.js';
import { mesmaRotaOperacional } from './rota-operacional.js';

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
  passoNegociacaoModo?: 'proporcional' | 'fixo';
  passoNegociacaoValor?: number;
  escalarHumanoNoTeto?: boolean;
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

function faixaValida(min: number, max: number): boolean {
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min;
}

async function faixaDoEmbarqueAtivo(
  telefone: string,
  oferta: OfertaNegociacao,
): Promise<{ valorMinimo: number; valorMaximo: number; configRotaId?: number | null; passoNegociacaoModo?: 'proporcional' | 'fixo'; passoNegociacaoValor?: number; escalarHumanoNoTeto?: boolean } | null> {
  const motorista = await buscarMotoristaPorTelefone(telefone);
  if (!motorista) return null;

  const embarques = await listarEmbarquesAtivos(motorista.id);
  for (const e of embarques) {
    if (
      !mesmaRotaOperacional(
        {
          origem: e.origin ?? '',
          destino: e.destination ?? '',
          operacao: e.operacao ?? null,
        },
        {
          origem: oferta.origem,
          destino: oferta.destino,
          operacao: oferta.operacao ?? null,
          capacidade: oferta.capacidade ?? null,
        },
      )
    ) {
      continue;
    }

    const valorMinimo = Number(e.valor_minimo);
    const valorMaximo = Number(e.valor_maximo);
    if (faixaValida(valorMinimo, valorMaximo)) {
      const configRotaId = e.config_rota_id != null ? Number(e.config_rota_id) : null;
      const rota = configRotaId ? await buscarConfigRota({ id: configRotaId }) : null;
      return {
        valorMinimo,
        valorMaximo,
        configRotaId,
        passoNegociacaoModo: rota?.regras_operacionais?.passo_negociacao_modo,
        passoNegociacaoValor: rota?.regras_operacionais?.passo_negociacao_valor,
        escalarHumanoNoTeto: rota?.regras_operacionais?.escalar_humano_no_teto,
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
        passoNegociacaoModo: emb.passoNegociacaoModo,
        passoNegociacaoValor: emb.passoNegociacaoValor,
        escalarHumanoNoTeto: emb.escalarHumanoNoTeto,
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
        passoNegociacaoModo: rota.regras_operacionais?.passo_negociacao_modo,
        passoNegociacaoValor: rota.regras_operacionais?.passo_negociacao_valor,
        escalarHumanoNoTeto: rota.regras_operacionais?.escalar_humano_no_teto,
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
  return /\b(topo|fechado|aceito|confirmo|pode\s+ser|bora|fecho|fechou|combinado|tenho\s+interesse|me\s+interessa|quero\s+sim|sim\b|sim\s+tenho)\b/.test(
    t,
  );
}

function valorDentroDaFaixa(valor: number, faixa: FaixaNegociacao): boolean {
  return valor >= faixa.valorMinimo && valor <= faixa.valorMaximo;
}

function passoNegociacao(faixa: FaixaNegociacao): number {
  if (faixa.passoNegociacaoModo === 'fixo') {
    const valor = Number(faixa.passoNegociacaoValor);
    return Number.isFinite(valor) && valor > 0 ? valor : 100;
  }
  const range = Math.max(0, faixa.valorMaximo - faixa.valorMinimo);
  if (range <= 0) return 0;
  return Math.max(100, Math.ceil(range / RODADAS_MAX));
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
      if (rodadas >= RODADAS_MAX && faixa.escalarHumanoNoTeto !== false) {
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

    const ofertaBase = valorDentroDaFaixa(faixa.valorOfertado, faixa)
      ? faixa.valorOfertado
      : faixa.valorMinimo;
    const ultima = estado.ultimaContraofertaIa != null && valorDentroDaFaixa(estado.ultimaContraofertaIa, faixa)
      ? estado.ultimaContraofertaIa
      : null;
    const atual = ultima ?? ofertaBase;

    const passo = passoNegociacao(faixa);
    const rodadas = estado.rodadas + 1;

    if (valorMsg <= atual) {
      return {
        tipo: 'contraproposta_ia',
        valorProposto: atual,
        mensagem: `Fechamos em R$ ${formatarValor(atual)} parceiro, pode ser?`,
      };
    }

    const proposta = Math.min(faixa.valorMaximo, Math.min(valorMsg, atual + passo));

    if (rodadas >= RODADAS_MAX && proposta < valorMsg) {
      if (faixa.escalarHumanoNoTeto === false) {
        return {
          tipo: 'contraproposta_ia',
          valorProposto: faixa.valorMaximo,
          mensagem: `Entendi os R$ ${formatarValor(valorMsg)} parceiro, o máximo que consigo nessa rota é R$ ${formatarValor(faixa.valorMaximo)}, topa?`,
        };
      }
      return {
        tipo: 'contraproposta_ia',
        valorProposto: faixa.valorMaximo,
        mensagem: `Entendi os R$ ${formatarValor(valorMsg)} parceiro, o máximo que consigo nessa rota é R$ ${formatarValor(faixa.valorMaximo)}, topa?`,
      };
    }

    return {
      tipo: 'contraproposta_ia',
      valorProposto: proposta,
      mensagem: `Consigo melhorar pra R$ ${formatarValor(proposta)} parceiro, se topar eu já confirmo aqui`,
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
