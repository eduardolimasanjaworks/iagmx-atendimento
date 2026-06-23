/**
 * Validação dos tokens de API (OpenRouter, Claude, OpenAI, Groq).
 */
import OpenAI from 'openai';
import { config } from '../config.js';

export type ProvedorAtivo = 'openrouter' | 'claude' | 'openai' | 'groq' | 'nenhum';

export interface StatusTokens {
  openrouter: boolean;
  claude: boolean;
  openai: boolean;
  groq: boolean;
  /** Provedor usado para chat/inferência */
  provedorAtivo: ProvedorAtivo;
  /** OpenAI necessário para embeddings e Whisper mesmo com Claude no chat */
  openaiUtilidades: boolean;
}

const ORDEM_FALLBACK: Array<Exclude<ProvedorAtivo, 'nenhum'>> = [
  'openrouter',
  'claude',
  'openai',
  'groq',
];

function ordemProvedoresPreferidos(): Array<Exclude<ProvedorAtivo, 'nenhum'>> {
  const preferido = config.provedorChatPreferido as Exclude<ProvedorAtivo, 'nenhum'>;
  return [...ORDEM_FALLBACK].sort((a, b) => {
    if (a === preferido) return -1;
    if (b === preferido) return 1;
    return ORDEM_FALLBACK.indexOf(a) - ORDEM_FALLBACK.indexOf(b);
  });
}

/** Testa token OpenRouter (API compatível com OpenAI) */
export async function validarOpenRouter(): Promise<boolean> {
  if (!config.openrouterHabilitado || !config.openrouterToken) return false;
  try {
    const cliente = new OpenAI({
      apiKey: config.openrouterToken,
      baseURL: config.openrouterBaseUrl,
      defaultHeaders: {
        'HTTP-Referer': config.openrouterReferer,
        'X-Title': config.openrouterAppName,
      },
    });
    await cliente.models.list();
    return true;
  } catch {
    return false;
  }
}

/** Testa token Anthropic (Claude) */
export async function validarClaude(): Promise<boolean> {
  if (!config.anthropicToken) return false;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicToken,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.modeloChatClaude,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'ok' }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Testa token OpenAI */
export async function validarOpenAI(): Promise<boolean> {
  if (!config.openaiToken) return false;
  try {
    const cliente = new OpenAI({ apiKey: config.openaiToken });
    await cliente.models.list();
    return true;
  } catch {
    return false;
  }
}

/** Testa token Groq (API compatível com OpenAI) */
export async function validarGroq(): Promise<boolean> {
  if (!config.groqToken) return false;
  try {
    const cliente = new OpenAI({
      apiKey: config.groqToken,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    await cliente.models.list();
    return true;
  } catch {
    return false;
  }
}

/** Valida todos os tokens e indica qual provedor de chat está ativo */
export async function validarTokens(): Promise<StatusTokens> {
  const [openrouter, claude, openai, groq] = await Promise.all([
    validarOpenRouter(),
    validarClaude(),
    validarOpenAI(),
    validarGroq(),
  ]);
  const disponibilidade: Record<Exclude<ProvedorAtivo, 'nenhum'>, boolean> = {
    openrouter,
    claude,
    openai,
    groq,
  };
  const provedorAtivo =
    ordemProvedoresPreferidos().find((nome) => disponibilidade[nome]) ?? 'nenhum';
  return {
    openrouter,
    claude,
    openai,
    groq,
    provedorAtivo,
    openaiUtilidades: openai,
  };
}
