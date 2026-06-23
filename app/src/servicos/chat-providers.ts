/**
 * Chat multi-provedor com prioridade configurável e fallback seguro.
 * OpenRouter, Claude, OpenAI e Groq podem ser usados sem mudar o restante da app.
 * Inferência e negociação passam por aqui — não pelo openai.ts direto.
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import { obterPromptOcr } from './config-ocr.js';
import { validarClaude, validarGroq, validarOpenAI, validarOpenRouter } from './tokens.js';
import type { UsoTokens } from '../util/custo-llm.js';

export type ProvedorChat = 'openrouter' | 'claude' | 'openai' | 'groq';

export type MensagemChat = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export interface ResultadoChatMeta {
  texto: string;
  provedor: ProvedorChat;
  modelo: string;
  uso: UsoTokens;
}

const ORDEM_FALLBACK: ProvedorChat[] = ['openrouter', 'claude', 'openai', 'groq'];
let provedorPreferido: ProvedorChat =
  (ORDEM_FALLBACK.includes(config.provedorChatPreferido as ProvedorChat)
    ? config.provedorChatPreferido
    : 'claude') as ProvedorChat;
let clienteOpenAI: OpenAI | null = null;
let clienteGroq: OpenAI | null = null;
let clienteOpenRouter: OpenAI | null = null;

function ordemProvedores(): ProvedorChat[] {
  return [...ORDEM_FALLBACK].sort((a, b) => {
    if (a === provedorPreferido) return -1;
    if (b === provedorPreferido) return 1;
    return ORDEM_FALLBACK.indexOf(a) - ORDEM_FALLBACK.indexOf(b);
  });
}

function nomeModeloProvedor(nome: ProvedorChat): string {
  if (nome === 'openrouter') return config.modeloChatOpenRouter;
  if (nome === 'claude') return config.modeloChatClaude;
  if (nome === 'openai') return config.modeloChat;
  return config.modeloChatGroq;
}

function getOpenAI(): OpenAI {
  if (!clienteOpenAI) clienteOpenAI = new OpenAI({ apiKey: config.openaiToken });
  return clienteOpenAI;
}

function getGroq(): OpenAI {
  if (!clienteGroq) {
    clienteGroq = new OpenAI({
      apiKey: config.groqToken,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return clienteGroq;
}

function getOpenRouter(): OpenAI {
  if (!clienteOpenRouter) {
    clienteOpenRouter = new OpenAI({
      apiKey: config.openrouterToken,
      baseURL: config.openrouterBaseUrl,
      defaultHeaders: {
        'HTTP-Referer': config.openrouterReferer,
        'X-Title': config.openrouterAppName,
      },
    });
  }
  return clienteOpenRouter;
}

export function provedorChatAtivo(): ProvedorChat {
  return provedorPreferido;
}

/** Define provedor de chat com base nos tokens válidos */
export async function inicializarProvedorChat(): Promise<void> {
  const disponibilidade: Record<ProvedorChat, boolean> = {
    openrouter: await validarOpenRouter(),
    claude: await validarClaude(),
    openai: await validarOpenAI(),
    groq: await validarGroq(),
  };
  for (const nome of ordemProvedores()) {
    if (!disponibilidade[nome]) continue;
    provedorPreferido = nome;
    const modelo = nomeModeloProvedor(nome);
    console.log(`[llm] Chat primário: ${nome} (${modelo})`);
    return;
  }
  console.warn('[llm] Nenhum provedor de chat disponível');
}

function ehRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate_limit|tokens per min|overloaded|capacity/i.test(msg);
}

function esperaRateLimitMs(err: unknown, tentativa: number): number {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/try again in ([\d.]+)s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 1500;
  const retryAfter = msg.match(/retry-after[:\s]+(\d+)/i);
  if (retryAfter) return parseInt(retryAfter[1], 10) * 1000 + 1000;
  return 8000 + tentativa * 5000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function separarSistema(messages: MensagemChat[]): { system: string; msgs: MensagemChat[] } {
  const systemParts: string[] = [];
  const msgs: MensagemChat[] = [];
  for (const m of messages) {
    if (m.role === 'system') systemParts.push(m.content);
    else msgs.push(m);
  }
  return { system: systemParts.join('\n\n'), msgs };
}

async function chatClaudeComRetry(
  messages: MensagemChat[],
  opts?: { temperature?: number; max_tokens?: number },
): Promise<ResultadoChatMeta> {
  const maxTentativas = 6;
  const { system, msgs } = separarSistema(messages);
  const body = {
    model: config.modeloChatClaude,
    max_tokens: opts?.max_tokens ?? 1024,
    temperature: opts?.temperature ?? 0.35,
    system: system || undefined,
    messages: msgs.map((m) => ({ role: m.role, content: m.content })),
  };

  let ultimoErro: unknown;
  for (let t = 0; t < maxTentativas; t++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.anthropicToken,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new Error(data.error?.message ?? `Claude HTTP ${res.status}`);
      }
      const texto = data.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim();
      if (texto) {
        return {
          texto,
          provedor: 'claude',
          modelo: config.modeloChatClaude,
          uso: {
            input_tokens: data.usage?.input_tokens ?? 0,
            output_tokens: data.usage?.output_tokens ?? 0,
          },
        };
      }
      throw new Error('Resposta vazia do Claude');
    } catch (err) {
      ultimoErro = err;
      if (ehRateLimit(err) && t < maxTentativas - 1) {
        const espera = esperaRateLimitMs(err, t);
        console.warn(
          `[llm] Claude rate limit, aguardando ${(espera / 1000).toFixed(0)}s (${t + 1}/${maxTentativas})`,
        );
        await sleep(espera);
        continue;
      }
      throw err;
    }
  }
  throw ultimoErro ?? new Error('Falha após retries no Claude');
}

async function chatOpenAICompatComRetry(
  cliente: OpenAI,
  modelo: string,
  nome: ProvedorChat,
  messages: MensagemChat[],
  opts?: { temperature?: number; max_tokens?: number },
): Promise<ResultadoChatMeta> {
  const maxTentativas = 6;
  const oaiMessages = messages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));

  let ultimoErro: unknown;
  for (let t = 0; t < maxTentativas; t++) {
    try {
      const resposta = await cliente.chat.completions.create({
        model: modelo,
        messages: oaiMessages,
        temperature: opts?.temperature ?? 0.35,
        max_tokens: opts?.max_tokens ?? 1024,
      });
      const texto = resposta.choices[0]?.message?.content?.trim();
      if (texto) {
        if (nome !== provedorPreferido && t === 0) {
          console.warn(`[llm] Fallback de chat: ${nome}`);
        }
        return {
          texto,
          provedor: nome,
          modelo,
          uso: {
            input_tokens: resposta.usage?.prompt_tokens ?? 0,
            output_tokens: resposta.usage?.completion_tokens ?? 0,
          },
        };
      }
      throw new Error(`Resposta vazia do ${nome}`);
    } catch (err) {
      ultimoErro = err;
      if (ehRateLimit(err) && t < maxTentativas - 1) {
        const espera = esperaRateLimitMs(err, t);
        console.warn(
          `[llm] ${nome} rate limit, aguardando ${(espera / 1000).toFixed(0)}s (${t + 1}/${maxTentativas})`,
        );
        await sleep(espera);
        continue;
      }
      throw err;
    }
  }
  throw ultimoErro ?? new Error(`Falha após retries no ${nome}`);
}

/**
 * Chat com fallback OpenRouter → Claude → OpenAI → Groq, retornando uso de tokens.
 */
export async function chatCompletionComMeta(
  messages: MensagemChat[],
  opts?: { temperature?: number; max_tokens?: number },
): Promise<ResultadoChatMeta> {
  let ultimoErro: unknown;
  for (const nome of ordemProvedores()) {
    try {
      if (nome === 'openrouter' && config.openrouterHabilitado && config.openrouterToken) {
        return await chatOpenAICompatComRetry(
          getOpenRouter(),
          config.modeloChatOpenRouter,
          'openrouter',
          messages,
          opts,
        );
      }
      if (nome === 'claude' && config.anthropicToken) {
        return await chatClaudeComRetry(messages, opts);
      }
      if (nome === 'openai' && config.openaiToken) {
        return await chatOpenAICompatComRetry(
          getOpenAI(),
          config.modeloChat,
          'openai',
          messages,
          opts,
        );
      }
      if (nome === 'groq' && config.groqToken) {
        return await chatOpenAICompatComRetry(
          getGroq(),
          config.modeloChatGroq,
          'groq',
          messages,
          opts,
        );
      }
    } catch (err) {
      ultimoErro = err;
      if (!ehRateLimit(err)) {
        console.error(`[llm] Falha no ${nome}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  throw ultimoErro ?? new Error('Nenhum provedor de chat disponível');
}

/** Chama um modelo específico do OpenRouter sem mudar o provedor principal. */
export async function chatOpenRouterModeloComMeta(
  modelo: string,
  messages: MensagemChat[],
  opts?: { temperature?: number; max_tokens?: number },
): Promise<ResultadoChatMeta> {
  if (!config.openrouterHabilitado || !config.openrouterToken) {
    throw new Error('OpenRouter não configurado');
  }
  return chatOpenAICompatComRetry(getOpenRouter(), modelo, 'openrouter', messages, opts);
}

/**
 * Chat com fallback OpenRouter → Claude → OpenAI → Groq e retry em 429.
 */
export async function chatCompletionRaw(
  messages: MensagemChat[],
  opts?: { temperature?: number; max_tokens?: number },
): Promise<string> {
  const { texto } = await chatCompletionComMeta(messages, opts);
  return texto;
}

/** OCR via Claude Vision */
export async function extrairTextoImagemClaude(
  buffer: Buffer,
  mimetype: string,
  promptCustom?: string,
): Promise<string> {
  if (!config.anthropicToken) {
    throw new Error('claudetoken necessário para vision Claude');
  }
  const base64 = buffer.toString('base64');
  const mediaType = mimetype.startsWith('image/') ? mimetype : 'image/jpeg';
  const promptOcr = promptCustom ?? (await obterPromptOcr());

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicToken,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.modeloVisaoClaude,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptOcr },
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Claude vision HTTP ${res.status}`);
  }
  const texto = data.content
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  if (!texto) throw new Error('Resposta vazia do Claude vision');
  return texto;
}
