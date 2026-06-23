/**
 * Vetorização do prompt completo no Qdrant.
 * Divide em chunks semânticos e gera embeddings via OpenAI.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { montarCabecalhoOrquestracao } from './config-orquestracao-texto.js';
import { gerarEmbedding } from './openai.js';
import { limparColecao, inserirChunks, buscarChunks } from './qdrant.js';

/** Divide o prompt em chunks por seções e parágrafos */
export function dividirPromptEmChunks(prompt: string): string[] {
  const porSecao = prompt.split(/(?=CENÁRIO \d+|DIRETRIZ|={3,}|BASE DE CONHECIMENTO)/i);
  const chunks: string[] = [];

  for (const secao of porSecao) {
    const limpa = secao.trim();
    if (!limpa) continue;

    if (limpa.length <= 1500) {
      chunks.push(limpa);
      continue;
    }

    // Subdivide parágrafos grandes
    const paragrafos = limpa.split(/\n{2,}/);
    let buffer = '';
    for (const p of paragrafos) {
      if ((buffer + p).length > 1200 && buffer) {
        chunks.push(buffer.trim());
        buffer = p;
      } else {
        buffer = buffer ? `${buffer}\n\n${p}` : p;
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
  }

  return chunks.length > 0 ? chunks : [prompt];
}

/** Indexa prompt completo no Qdrant */
export async function indexarPrompt(prompt: string): Promise<number> {
  const chunks = dividirPromptEmChunks(prompt);
  await limparColecao();

  const vetorizados = [];
  for (let i = 0; i < chunks.length; i++) {
    const vetor = await gerarEmbedding(chunks[i]);
    vetorizados.push({
      id: randomUUID(),
      vetor,
      texto: chunks[i],
      indice: i,
    });
  }

  await inserirChunks(vetorizados);
  console.log(`[vetorizacao] ${chunks.length} chunks indexados no Qdrant`);
  return chunks.length;
}

/**
 * Monta prompt do sistema: regras fixas + chunks relevantes via RAG.
 * Para prompts curtos, retorna o prompt inteiro.
 */
export async function montarPromptComRag(
  promptCompleto: string,
  mensagemUsuario: string,
): Promise<string> {
  const instrucao = await montarCabecalhoOrquestracao();

  if (promptCompleto.length <= config.limitePromptRag) {
    return `${promptCompleto}\n\n${instrucao}`;
  }

  // Regras críticas sempre no contexto (primeiros ~2500 chars)
  const regrasFixas = promptCompleto.slice(0, 2500);
  const consulta = mensagemUsuario.slice(0, 2000);
  const vetor = await gerarEmbedding(consulta);
  const chunks = await buscarChunks(vetor);

  const contextoRag = chunks.join('\n\n---\n\n');
  return `${regrasFixas}

=== CENÁRIOS RELEVANTES (recuperados por contexto) ===
${contextoRag}

${instrucao}`;
}
