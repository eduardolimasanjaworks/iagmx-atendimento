/**
 * Contexto para montar ferramentas quando o LLM omite o JSON.
 */
import type { BlocoFerramenta } from './ferramentas.js';
import { serializarBlocoFerramenta } from './ferramentas.js';
import {
  extrairValorMonetario,
  obterFaixaNegociacao,
  type FaixaNegociacao,
} from './motor-negociacao.js';

export interface OfertaGmX {
  origem: string;
  destino: string;
  valor: number;
  texto: string;
  operacao?: string;
  capacidade?: string;
  configRotaId?: number | null;
}

export interface ContextoFerramentaInferencia {
  telefone: string;
  mensagem: string;
  historico: Array<{ role: string; content: string }>;
  midiaId?: string;
}

/** Extrai oferta proativa da última mensagem GMX no histórico. */
export function extrairOfertaGmX(
  historico: Array<{ role: string; content: string }>,
): OfertaGmX | null {
  const ultimaGmx = [...historico]
    .reverse()
    .find((h) => h.role === 'assistant' && /retirada|entrega|valor\s+R\$/i.test(h.content));
  if (!ultimaGmx) return null;

  const texto = ultimaGmx.content;
  const m = texto.match(
    /retirada\s+(.+?),\s*entrega\s+(.+?),\s*valor\s+R\$\s*([\d.,]+)/i,
  );
  if (!m) return null;

  const valor = parseFloat(m[3].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(valor)) return null;

  return {
    origem: m[1].trim(),
    destino: m[2].trim(),
    valor,
    texto,
    operacao: undefined,
    capacidade: undefined,
    configRotaId: null,
  };
}

/** Tenta extrair "Cidade UF" da mensagem do motorista. */
export function extrairLocalizacaoTexto(texto: string): string | null {
  const limpo = texto.trim();
  const padroes = [
    /\b(?:em|de|para|pro|indo\s+pro?)\s+([A-Za-zÀ-ú''\s]{2,40}?)\s+([A-Za-z]{2})\b/i,
    /\b([A-Za-zÀ-ú''\s]{2,40}?)\s*\/\s*([A-Za-z]{2})\b/i,
    /\b([A-Za-zÀ-ú''\s]{2,40}?)\s+([A-Za-z]{2})\b/i,
  ];
  for (const re of padroes) {
    const m = limpo.match(re);
    if (m) {
      const cidade = m[1].replace(/\s+/g, ' ').trim();
      const uf = m[2].toUpperCase();
      if (cidade.length >= 3 && !/^(to|em|de|na|no)$/i.test(cidade)) {
        return `${cidade} ${uf}`;
      }
    }
  }
  return null;
}

function ultimaLocalizacaoMotorista(
  historico: Array<{ role: string; content: string }>,
  mensagemAtual: string,
): string | null {
  const locAtual = extrairLocalizacaoTexto(mensagemAtual);
  if (locAtual) return locAtual;

  for (const h of [...historico].reverse()) {
    if (h.role !== 'user') continue;
    const loc = extrairLocalizacaoTexto(h.content);
    if (loc) return loc;
  }
  return null;
}

function motoristaCarregado(historico: Array<{ role: string; content: string }>): boolean {
  return historico.some(
    (h) =>
      h.role === 'user' &&
      /\b(carregad|to\s+carregad|j[aá]\s+carregad|indo\s+pro?)\b/i.test(h.content),
  );
}

function inferirAceiteOferta(mensagem: string): boolean | null {
  const m = mensagem.toLowerCase();
  if (/\b(n[aã]o\s+rola|recuso|longe|sem\s+interesse|n[aã]o\s+topo|passo)\b/.test(m)) {
    return false;
  }
  if (/\b(topo|fechado|aceito|confirmo|pode\s+ser|bora|sim|fecho)\b/.test(m)) {
    return true;
  }
  return null;
}

function blocoEscalonarNegociacao(
  oferta: OfertaGmX,
  telefone: string,
  opts: {
    motivo: string;
    valorPedido?: number;
    faixa?: FaixaNegociacao | null;
  },
): BlocoFerramenta {
  return {
    ferramenta: 'escalonar_negociacao',
    dados: {
      motivo: opts.motivo,
      origem: oferta.origem,
      destino: oferta.destino,
      config_rota_id: opts.faixa?.configRotaId ?? oferta.configRotaId ?? undefined,
      valor_ofertado: oferta.valor,
      valor_pedido_motorista: opts.valorPedido,
      valor_minimo: opts.faixa?.valorMinimo,
      valor_maximo: opts.faixa?.valorMaximo,
      telefone,
    },
    raw: '',
  };
}

/** Monta JSON mínimo executável quando o plano exige ferramenta ausente. */
export async function construirFerramentaMinima(
  nome: string,
  ctx: ContextoFerramentaInferencia,
): Promise<BlocoFerramenta | null> {
  const normalizado = nome === 'escalonar_equipe' ? 'escalonar_negociacao' : nome;

  if (normalizado === 'registrar_disponibilidade') {
    const local = ultimaLocalizacaoMotorista(ctx.historico, ctx.mensagem);
    if (!local) return null;
    const carregado = motoristaCarregado(ctx.historico);
    return {
      ferramenta: 'registrar_disponibilidade',
      dados: {
        disponivel: !carregado,
        status: carregado ? 'carregado' : 'disponivel',
        localizacao_atual: local,
        telefone: ctx.telefone,
      },
      raw: '',
    };
  }

  if (normalizado === 'resposta_oferta_carga') {
    const oferta = extrairOfertaGmX(ctx.historico);
    const aceite = inferirAceiteOferta(ctx.mensagem);
    if (!oferta || aceite === null) return null;

    const faixa = await obterFaixaNegociacao(oferta, ctx.telefone);
    const valorMsg = extrairValorMonetario(ctx.mensagem);
    const valorAceito = valorMsg ?? oferta.valor;

    if (aceite) {
      if (!faixa) {
        return blocoEscalonarNegociacao(oferta, ctx.telefone, {
          motivo: 'rota_sem_faixa_negociacao',
          valorPedido: valorMsg ?? undefined,
        });
      }
      if (valorAceito < faixa.valorMinimo) {
        return blocoEscalonarNegociacao(oferta, ctx.telefone, {
          motivo: 'negociacao_abaixo_piso',
          valorPedido: valorAceito,
          faixa,
        });
      }
      if (valorAceito > faixa.valorMaximo) {
        return blocoEscalonarNegociacao(oferta, ctx.telefone, {
          motivo: 'negociacao_acima_teto',
          valorPedido: valorAceito,
          faixa,
        });
      }
    }

    return {
      ferramenta: 'resposta_oferta_carga',
      dados: {
        aceite,
        valor_aceito: aceite ? valorAceito : undefined,
        config_rota_id: faixa?.configRotaId ?? oferta.configRotaId ?? undefined,
        valor_ofertado: oferta.valor,
        valor_minimo: faixa?.valorMinimo,
        valor_maximo: faixa?.valorMaximo,
        origem: oferta.origem,
        destino: oferta.destino,
        telefone: ctx.telefone,
      },
      raw: '',
    };
  }

  if (normalizado === 'grava_ocr' && ctx.midiaId) {
    const tipo =
      /\bcnh\b/i.test(ctx.mensagem) ? 'cnh'
      : /\bcrlv\b/i.test(ctx.mensagem) ? 'crlv'
      : /\bantt\b/i.test(ctx.mensagem) ? 'antt'
      : 'cnh';
    return {
      ferramenta: 'grava_ocr',
      dados: { tipo, midia_id: ctx.midiaId, telefone: ctx.telefone },
      raw: '',
    };
  }

  if (normalizado === 'grava_comprovante' && ctx.midiaId) {
    return {
      ferramenta: 'grava_comprovante',
      dados: { midia_id: ctx.midiaId, telefone: ctx.telefone },
      raw: '',
    };
  }

  if (normalizado === 'atualizar_motorista') {
    const dados: Record<string, string> = { telefone: ctx.telefone };
    const m = ctx.mensagem.match(/\b(?:meu\s+)?nome\s+(?:é|e)\s+(.+)/i);
    if (m) dados.nome = m[1].trim();
    const loc = extrairLocalizacaoTexto(ctx.mensagem);
    if (loc) dados.cidade = loc;
    if (Object.keys(dados).length <= 1) return null;
    return { ferramenta: 'atualizar_motorista', dados, raw: '' };
  }

  if (normalizado === 'salvar_carreta' && ctx.midiaId) {
    const indice = /\bcarreta\s*2\b/i.test(ctx.mensagem) ? 2
      : /\bcarreta\s*3\b/i.test(ctx.mensagem) ? 3
      : 1;
    return {
      ferramenta: 'salvar_carreta',
      dados: { indice, midia_id: ctx.midiaId, telefone: ctx.telefone },
      raw: '',
    };
  }

  if (normalizado === 'escalonar_negociacao') {
    const oferta = extrairOfertaGmX(ctx.historico);
    if (!oferta) return null;
    const faixa = await obterFaixaNegociacao(oferta, ctx.telefone);
    const valorPedido = extrairValorMonetario(ctx.mensagem) ?? undefined;

    return blocoEscalonarNegociacao(oferta, ctx.telefone, {
      motivo: 'negociacao_sem_acordo',
      valorPedido,
      faixa,
    });
  }

  return null;
}

/** Anexa ferramentas programáticas que ainda faltam no texto. */
export async function anexarFerramentasProgramaticas(
  texto: string,
  ferramentasEsperadas: string[],
  ctx: ContextoFerramentaInferencia,
  jaPresentes: string[],
): Promise<string> {
  let saida = texto;
  const presentes = new Set(jaPresentes);

  for (const nome of ferramentasEsperadas) {
    const chave = nome === 'escalonar_equipe' ? 'escalonar_negociacao' : nome;
    if (presentes.has(chave) || presentes.has(nome)) continue;

    const bloco = await construirFerramentaMinima(nome, ctx);
    if (!bloco) continue;

    bloco.raw = serializarBlocoFerramenta(bloco.ferramenta, bloco.dados);
    saida += `\n${bloco.raw}`;
    presentes.add(bloco.ferramenta);
  }

  return saida.trim();
}
