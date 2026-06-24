/**
 * OpenAI: embeddings (Qdrant), Whisper (STT) e vision OCR (fallback).
 * Chat de inferência → chat-providers.ts (Claude primário).
 */
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { config } from '../config.js';
import {
  chatCompletionRaw,
  extrairTextoImagemClaude,
  inicializarProvedorChat,
  provedorChatAtivo,
} from './chat-providers.js';
import { obterPromptOcr, obterPromptOcrForcado } from './config-ocr.js';
import { montarResumoSchemaOcr } from './config-ocr-documentos.js';
import { ehRecusaOcr, textoOcrValido } from '../util/ocr-qualidade.js';
import { validarOpenAI } from './tokens.js';

export {
  chatCompletionRaw,
  inicializarProvedorChat as inicializarProvedor,
  provedorChatAtivo,
};
export type { MensagemChat } from './chat-providers.js';

let clienteOpenAI: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!clienteOpenAI) clienteOpenAI = new OpenAI({ apiKey: config.openaiToken });
  return clienteOpenAI;
}

/** @deprecated use validarTokens */
export async function validarTokenOpenAI(): Promise<boolean> {
  return validarOpenAI();
}

/**
 * Gera resposta com histórico de conversa.
 */
export async function gerarResposta(
  promptSistema: string,
  mensagensUsuario: string[],
  historico: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [],
): Promise<string> {
  const conteudoAtual = mensagensUsuario.join('\n\n');
  return chatCompletionRaw([
    { role: 'system', content: promptSistema },
    ...historico,
    { role: 'user', content: conteudoAtual },
  ]);
}

/** Gera embedding para vetorização (sempre OpenAI — Qdrant indexado com text-embedding-3) */
export async function gerarEmbedding(texto: string): Promise<number[]> {
  if (!config.openaiToken) {
    throw new Error('openaitoken necessário para embeddings (Qdrant)');
  }
  const resposta = await getOpenAI().embeddings.create({
    model: config.modeloEmbedding,
    input: texto.slice(0, 8000),
  });
  return resposta.data[0].embedding;
}

/** Transcreve áudio via Whisper (OpenAI — sem equivalente no Claude) */
export async function transcreverAudio(
  buffer: Buffer,
  mimetype: string,
): Promise<string> {
  if (!config.openaiToken) {
    throw new Error('openaitoken necessário para transcrição de áudio (Whisper)');
  }
  const mime = mimetype.toLowerCase();
  let ext = 'ogg';
  if (mime.includes('wav')) ext = 'wav';
  else if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
  else if (mime.includes('mp4') || mime.includes('m4a')) ext = 'm4a';
  else if (mime.includes('webm')) ext = 'webm';
  else if (mime.includes('ogg') || mime.includes('opus')) ext = 'ogg';
  else if (mime.includes('flac')) ext = 'flac';

  const arquivo = await toFile(buffer, `audio.${ext}`, { type: mimetype || `audio/${ext}` });
  const resultado = await getOpenAI().audio.transcriptions.create({
    model: config.modeloStt,
    file: arquivo,
    language: 'pt',
  });
  return resultado.text.trim();
}

/** Wrapper com timeout e mensagem de espera dinâmica */
async function comTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  contexto: string,
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      const mensagensEspera = [
        'Só um minutinho por favor, tô processando sua imagem',
        'Um momento, tô analisando o documento',
        'Aguarde um pouco, tô lendo sua foto',
        'Só um segundo, tô processando',
        'Um minuto, tô finalizando a leitura',
      ];
      const msgAleatoria = mensagensEspera[Math.floor(Math.random() * mensagensEspera.length)];
      reject(new Error(`${contexto}: ${msgAleatoria}`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]);
}

/** OCR / visão: Claude primário, OpenAI gpt-4o fallback. Retenta com prompt forçado se recusar. */
export async function extrairTextoImagem(
  buffer: Buffer,
  mimetype: string,
): Promise<string> {
  const tentar = async (prompt: string, comSistema = false): Promise<string> => {
    if (config.anthropicToken && !comSistema) {
      try {
        const resultado = await comTimeout(
          extrairTextoImagemClaude(buffer, mimetype, prompt),
          30000,
          'OCR Claude'
        );
        return resultado;
      } catch (err) {
        console.warn(
          '[llm] Claude vision falhou, tentando OpenAI:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (!config.openaiToken) {
      throw new Error('Vision indisponível — configure claudetoken ou openaitoken');
    }

    const base64 = buffer.toString('base64');
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = comSistema
      ? [
          {
            role: 'system',
            content:
              'Você é OCR de documentos brasileiros para cadastro de motoristas. Transcreva o texto visível. Nunca recuse.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${mimetype};base64,${base64}` },
              },
            ],
          },
        ]
      : [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:${mimetype};base64,${base64}` },
              },
            ],
          },
        ];

    const resposta = await comTimeout(
      getOpenAI().chat.completions.create({
        model: config.modeloVisaoOpenAI,
        messages,
        max_tokens: 2048,
        temperature: comSistema ? 0 : 0.1,
      }),
      30000,
      'OCR OpenAI'
    );
    const texto = resposta.choices[0]?.message?.content?.trim();
    if (!texto) throw new Error('Resposta vazia do OpenAI vision');
    return texto;
  };

  const resumoSchema = await montarResumoSchemaOcr().catch(() => '');
  const promptPadrao = [await obterPromptOcr(), resumoSchema].filter(Boolean).join('\n\n');
  const promptForcado = [await obterPromptOcrForcado(), resumoSchema].filter(Boolean).join('\n\n');
  let ultimoTexto = '';
  let ultimoErro: unknown = null;

  for (let tentativaIdx = 0; tentativaIdx < 5; tentativaIdx += 1) {
    const forcada = tentativaIdx > 0;
    try {
      const texto = await tentar(forcada ? promptForcado : promptPadrao, forcada);
      ultimoTexto = texto;
      if (textoOcrValido(texto) && !ehRecusaOcr(texto)) return texto;
      console.warn(
        `[ocr] Leitura ${tentativaIdx + 1}/5 invalida${ehRecusaOcr(texto) ? '/recusada' : ''} — repetindo`,
      );
    } catch (err) {
      ultimoErro = err;
      console.warn(
        `[ocr] Tentativa ${tentativaIdx + 1}/5 falhou`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (ultimoTexto) return ultimoTexto;
  throw ultimoErro instanceof Error ? ultimoErro : new Error('OCR falhou apos 5 tentativas');
}
