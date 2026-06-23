/**
 * Cenário 9 — negociação de frete em código (motor determinístico).
 */
import { extrairOfertaGmX } from './ferramentas-contexto.js';
import { serializarBlocoFerramenta } from './ferramentas.js';
import { obterEstadoFluxo, salvarEstadoFluxo, limparEstadoFluxo } from './estado-fluxo-redis.js';
import {
  avaliarNegociacao,
  atualizarEstadoNegociacao,
  extrairValorMonetario,
  motoristaAceitou,
  motoristaRecusou,
  obterFaixaNegociacao,
  type EstadoNegociacao,
  type FaixaNegociacao,
} from './motor-negociacao.js';

export interface ResultadoFluxoNegociacao {
  textoComFerramentas: string;
  visivel: string;
  passo: string;
  fragmentar: false;
}

interface EstadoC9 extends EstadoNegociacao {
  fluxo: 'c9';
  passo: 'negociacao';
}

function montarResultado(
  visivel: string,
  ferramentas: Array<{ ferramenta: string; dados: Record<string, unknown> }> = [],
  passo = 'ok',
): ResultadoFluxoNegociacao {
  const blocos = ferramentas.map((f) => serializarBlocoFerramenta(f.ferramenta, f.dados));
  return {
    visivel,
    textoComFerramentas: blocos.length ? `${visivel}\n${blocos.join('\n')}` : visivel,
    passo,
    fragmentar: false,
  };
}

function dadosOferta(faixa: FaixaNegociacao, telefone: string) {
  return {
    origem: faixa.origem,
    destino: faixa.destino,
    config_rota_id: faixa.configRotaId ?? undefined,
    valor_ofertado: faixa.valorOfertado,
    valor_minimo: faixa.valorMinimo,
    valor_maximo: faixa.valorMaximo,
    telefone,
  };
}

/**
 * Responde negociação de oferta ativa sem LLM.
 */
export async function tentarFluxoNegociacao(opts: {
  telefone: string;
  mensagem: string;
  historico: Array<{ role: string; content: string }>;
}): Promise<ResultadoFluxoNegociacao | null> {
  const { telefone, mensagem, historico } = opts;
  const oferta = extrairOfertaGmX(historico);
  if (!oferta) return null;

  const faixa = await obterFaixaNegociacao(oferta, telefone);
  if (!faixa) {
    return montarResultado(
      'Parceiro, vou passar pra equipe confirmar o valor dessa rota e já te retornam, aguarda um pouco',
      [
        {
          ferramenta: 'escalonar_negociacao',
          dados: {
            motivo: 'rota_sem_faixa_negociacao',
            origem: oferta.origem,
            destino: oferta.destino,
            valor_ofertado: oferta.valor,
            telefone,
          },
        },
      ],
      'sem_faixa_erp',
    );
  }

  let estado = await obterEstadoFluxo<EstadoC9>(telefone);

  if (estado?.fluxo !== 'c9' || !estado.faixa || estado.faixa.valorOfertado !== faixa.valorOfertado) {
    estado = {
      fluxo: 'c9',
      passo: 'negociacao',
      rodadas: 0,
      faixa,
    };
  }

  const valorMsg = extrairValorMonetario(mensagem);
  const aceiteDireto =
    motoristaAceitou(mensagem) &&
    (valorMsg == null || (valorMsg >= faixa.valorMinimo && valorMsg <= faixa.valorMaximo));

  if (aceiteDireto && !motoristaRecusou(mensagem)) {
    const valorAceito =
      valorMsg ??
      (estado.ultimoValorPedido != null &&
      estado.ultimoValorPedido >= faixa.valorMinimo &&
      estado.ultimoValorPedido <= faixa.valorMaximo
        ? estado.ultimoValorPedido
        : faixa.valorOfertado);

    await limparEstadoFluxo(telefone);
    return montarResultado(
      `Perfeito parceiro, frete fechado em R$ ${valorAceito.toLocaleString('pt-BR')}, boa viagem`,
      [
        {
          ferramenta: 'resposta_oferta_carga',
          dados: {
            aceite: true,
            valor_aceito: valorAceito,
            ...dadosOferta(faixa, telefone),
          },
        },
      ],
      'aceite',
    );
  }

  const acao = avaliarNegociacao({ mensagem, faixa, estado });
  const novoEstado = atualizarEstadoNegociacao(estado, acao, mensagem);
  await salvarEstadoFluxo(telefone, { ...novoEstado, fluxo: 'c9', passo: 'negociacao' } satisfies EstadoC9);

  if (acao.tipo === 'recusa') {
    await limparEstadoFluxo(telefone);
    return montarResultado(
      'Combinado parceiro, fica pra próxima, boa viagem',
      [
        {
          ferramenta: 'resposta_oferta_carga',
          dados: {
            aceite: false,
            ...dadosOferta(faixa, telefone),
          },
        },
      ],
      'recusa',
    );
  }

  if (acao.tipo === 'aceite') {
    await limparEstadoFluxo(telefone);
    return montarResultado(
      `Fechado parceiro em R$ ${acao.valorAceito.toLocaleString('pt-BR')}, boa viagem`,
      [
        {
          ferramenta: 'resposta_oferta_carga',
          dados: {
            aceite: true,
            valor_aceito: acao.valorAceito,
            ...dadosOferta(faixa, telefone),
          },
        },
      ],
      'aceite_negociado',
    );
  }

  if (acao.tipo === 'escalonar') {
    await limparEstadoFluxo(telefone);
    return montarResultado(
      'Entendi parceiro, vou passar pra equipe dar uma olhada nesse valor e te retornam, aguarda um pouco',
      [
        {
          ferramenta: 'escalonar_negociacao',
          dados: {
            motivo: acao.motivo,
            valor_pedido_motorista: acao.valorPedido,
            ...dadosOferta(faixa, telefone),
          },
        },
      ],
      'escalonar',
    );
  }

  return montarResultado(acao.mensagem, [], acao.tipo);
}
