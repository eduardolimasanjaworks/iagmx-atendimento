/**
 * Busca trechos editaveis do treinador por assunto pedido.
 * Quebra os alvos reais em blocos menores para evitar edicao cega.
 * Mantem a recuperacao deterministica por termos, sem depender de vetor externo.
 */
import { obterConfigMensagensFluxo } from './config-mensagens-fluxo.js';
import { obterPromptOcr, obterPromptOcrForcado } from './config-ocr.js';
import { obterConfigOrquestracaoTexto } from './config-orquestracao-texto.js';
import { obterPromptBruto } from './prompt.js';
import { listarOcrDocumentos } from './config-ocr-documentos.js';
import type { AlvoPatchTreinamento } from './treinamento-config-alvos.js';

const STOPWORDS = new Set([
  'a',
  'ao',
  'aos',
  'as',
  'com',
  'como',
  'da',
  'das',
  'de',
  'dele',
  'dela',
  'deles',
  'delas',
  'do',
  'dos',
  'e',
  'ela',
  'ele',
  'em',
  'essa',
  'esse',
  'esta',
  'este',
  'eu',
  'fazer',
  'isso',
  'mais',
  'mas',
  'me',
  'meu',
  'minha',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'ou',
  'para',
  'por',
  'pra',
  'que',
  'se',
  'sem',
  'ser',
  'seu',
  'sua',
  'suas',
  'ter',
  'um',
  'uma',
  'voce',
]);

export interface TrechoCatalogado {
  alvo: AlvoPatchTreinamento;
  chave: string | null;
  rotulo: string;
  texto: string;
}

export interface TrechoTreinamentoRelacionado {
  alvo: AlvoPatchTreinamento;
  chave: string | null;
  rotulo: string;
  texto: string;
  score: number;
  termos: string[];
  motivo: string;
  origemBusca: 'lexical' | 'vetorial' | 'fallback';
}

function normalizarBusca(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resumirTexto(texto: string, limite = 260): string {
  const base = String(texto || '').replace(/\s+/g, ' ').trim();
  return base.length <= limite ? base : `${base.slice(0, limite - 3)}...`;
}

function quebrarBlocosTexto(texto: string): string[] {
  const bruto = String(texto || '').trim();
  if (!bruto) return [];
  const blocos = bruto
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return blocos.flatMap((bloco) => {
    if (bloco.length <= 520) return [bloco];
    return bloco
      .split(/(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .reduce<string[]>((acc, frase) => {
        const atual = acc[acc.length - 1] || '';
        if (!atual || atual.length + frase.length + 1 > 520) {
          acc.push(frase);
          return acc;
        }
        acc[acc.length - 1] = `${atual} ${frase}`.trim();
        return acc;
      }, []);
  });
}

function extrairTermosBusca(texto: string): string[] {
  return Array.from(
    new Set(
      normalizarBusca(texto)
        .split(' ')
        .map((item) => item.trim())
        .filter((item) => item.length >= 3 && !STOPWORDS.has(item)),
    ),
  ).slice(0, 14);
}

function pontuarTrecho(
  pedido: string,
  termos: string[],
  trecho: TrechoCatalogado,
): TrechoTreinamentoRelacionado {
  const textoNormalizado = normalizarBusca(trecho.texto);
  const rotuloNormalizado = normalizarBusca(`${trecho.alvo} ${trecho.chave || ''} ${trecho.rotulo}`);
  const pedidoNormalizado = normalizarBusca(pedido);
  const termosEncontrados = termos.filter(
    (termo) => textoNormalizado.includes(termo) || rotuloNormalizado.includes(termo),
  );
  let score = 0;

  for (const termo of termosEncontrados) {
    score += textoNormalizado.includes(termo) ? 3 : 0;
    score += rotuloNormalizado.includes(termo) ? 2 : 0;
  }

  if (pedidoNormalizado.length >= 10 && textoNormalizado.includes(pedidoNormalizado)) score += 9;
  if (pedidoNormalizado.length >= 10 && rotuloNormalizado.includes(pedidoNormalizado)) score += 6;
  if (trecho.chave && termos.some((termo) => trecho.chave?.toLowerCase().includes(termo))) score += 3;
  if (termos.length && termosEncontrados.length === termos.length) score += 4;

  return {
    alvo: trecho.alvo,
    chave: trecho.chave,
    rotulo: trecho.rotulo,
    texto: trecho.texto,
    score,
    termos: termosEncontrados,
    motivo: termosEncontrados.length
      ? `coincide com ${termosEncontrados.slice(0, 5).join(', ')}`
      : 'contexto geral proximo do pedido',
    origemBusca: 'lexical',
  };
}

export async function montarCatalogoTrechosTreinamento(): Promise<TrechoCatalogado[]> {
  const [prompt, orquestracao, mensagens, ocr, ocrForcado, ocrDocumentos] = await Promise.all([
    obterPromptBruto(),
    obterConfigOrquestracaoTexto(),
    obterConfigMensagensFluxo(),
    obterPromptOcr(),
    obterPromptOcrForcado(),
    listarOcrDocumentos(),
  ]);
  const catalogo: TrechoCatalogado[] = [];

  for (const bloco of quebrarBlocosTexto(prompt)) {
    catalogo.push({
      alvo: 'prompt_sistema',
      chave: null,
      rotulo: 'Prompt principal',
      texto: bloco,
    });
  }

  for (const bloco of quebrarBlocosTexto(ocr)) {
    catalogo.push({
      alvo: 'ocr_prompt',
      chave: null,
      rotulo: 'Prompt de Extracao OCR',
      texto: bloco,
    });
  }

  for (const bloco of quebrarBlocosTexto(ocrForcado)) {
    catalogo.push({
      alvo: 'ocr_prompt_forcado',
      chave: null,
      rotulo: 'Prompt OCR com Tipo Forcado',
      texto: bloco,
    });
  }

  for (const doc of ocrDocumentos.filter((d) => d.ativo && d.dicaPrompt)) {
    for (const bloco of quebrarBlocosTexto(doc.dicaPrompt)) {
      catalogo.push({
        alvo: 'ocr_documentos_schema',
        chave: doc.id,
        rotulo: `Dica OCR - ${doc.rotulo} (${doc.tipoDocumento})`,
        texto: bloco,
      });
    }
  }

  for (const chave of ['camadaHumana', 'instrucaoFormatacao'] as const) {
    for (const bloco of quebrarBlocosTexto(String(orquestracao[chave] || ''))) {
      catalogo.push({
        alvo: 'orquestracao_texto',
        chave,
        rotulo: `orquestracao_texto.${chave}`,
        texto: bloco,
      });
    }
  }

  for (const [chave, valor] of Object.entries(mensagens)) {
    const texto = Array.isArray(valor)
      ? valor.map((item) => String(item).trim()).filter(Boolean).join('\n')
      : String(valor || '').trim();
    for (const bloco of quebrarBlocosTexto(texto)) {
      catalogo.push({
        alvo: 'mensagens_fluxo',
        chave,
        rotulo: `mensagens_fluxo.${chave}`,
        texto: bloco,
      });
    }
  }

  return catalogo;
}

export function buscarTrechosRelacionadosEmCatalogoParaTeste(
  pedido: string,
  catalogo: Array<{ alvo: AlvoPatchTreinamento; chave?: string | null; rotulo: string; texto: string }>,
  limite = 8,
): TrechoTreinamentoRelacionado[] {
  const termos = extrairTermosBusca(pedido);
  return catalogo
    .map((item) =>
      pontuarTrecho(pedido, termos, {
        alvo: item.alvo,
        chave: item.chave ?? null,
        rotulo: item.rotulo,
        texto: item.texto,
      }),
    )
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.rotulo.localeCompare(b.rotulo))
    .slice(0, limite);
}

export async function buscarTrechosRelacionadosTreinamento(
  pedido: string,
  limite = 8,
): Promise<TrechoTreinamentoRelacionado[]> {
  const catalogo = await montarCatalogoTrechosTreinamento();
  const resultados = buscarTrechosRelacionadosEmCatalogoParaTeste(pedido, catalogo, limite);
  if (resultados.length) return resultados;
  return catalogo.slice(0, Math.min(limite, 4)).map((item) => ({
    alvo: item.alvo,
    chave: item.chave,
    rotulo: item.rotulo,
    texto: item.texto,
    score: 0,
    termos: [],
    motivo: 'fallback de contexto geral editavel',
    origemBusca: 'fallback',
  }));
}

export function montarContextoBuscaTreinamento(
  pedido: string,
  trechos: TrechoTreinamentoRelacionado[],
): string {
  return [
    '=== PEDIDO DO TREINADOR ===',
    pedido.trim(),
    '',
    '=== TRECHOS RELACIONADOS ENCONTRADOS ===',
    ...trechos.map(
      (trecho, idx) =>
        `[${idx + 1}] ${trecho.rotulo} | score=${trecho.score} | ${trecho.motivo}\n${resumirTexto(
          trecho.texto,
          420,
        )}`,
    ),
  ].join('\n\n');
}

export function montarResumoHumanoTrechos(
  trechos: TrechoTreinamentoRelacionado[],
  limite = 4,
): string[] {
  return trechos.slice(0, limite).map((trecho, idx) => {
    const alvo = trecho.chave ? `${trecho.alvo}.${trecho.chave}` : trecho.alvo;
    return `${idx + 1}. ${alvo}: ${resumirTexto(trecho.texto, 180)}`;
  });
}
