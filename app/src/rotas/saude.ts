/**
 * Rota de health check — verifica dependências e tokens.
 */
import type { FastifyInstance } from 'fastify';
import { verificarRedis } from '../servicos/debounce.js';
import { verificarPostgres } from '../servicos/prompt.js';
import { verificarEvolution } from '../servicos/evolution.js';
import { validarTokens } from '../servicos/tokens.js';
import { verificarQdrant } from '../servicos/qdrant.js';
import { verificarDirectus, directusConfigurado, validarDirectusToken } from '../servicos/directus.js';
import { obterStatusPausa } from '../servicos/pausa.js';
import { config } from '../config.js';
import { statusFilaInferencia } from '../servicos/fila-inferencia.js';
import { obterStatusWarmupPosBoot } from '../servicos/warmup-pos-boot.js';

async function comTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  } catch {
    return fallback;
  }
}

export async function rotasSaude(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    const [redis, postgres, evolution, qdrant, tokens, pausa, directusTokenOk, directusOk] =
      await Promise.all([
        comTimeout(verificarRedis(), 2000, false),
        comTimeout(verificarPostgres(), 2000, false),
        comTimeout(verificarEvolution(), 2500, false),
        comTimeout(verificarQdrant(), 2000, false),
        comTimeout(
          validarTokens(),
          3000,
          {
            openrouter: Boolean(config.openrouterHabilitado && config.openrouterToken),
            claude: Boolean(config.anthropicToken),
            openai: Boolean(config.openaiToken),
            groq: Boolean(config.groqToken),
            provedorAtivo: config.openrouterHabilitado && config.openrouterToken
              ? 'openrouter'
              : config.anthropicToken
                ? 'claude'
                : config.openaiToken
                  ? 'openai'
                  : config.groqToken
                    ? 'groq'
                    : 'nenhum',
            openaiUtilidades: Boolean(config.openaiToken),
          },
        ),
        comTimeout(obterStatusPausa(), 1000, {
          global: false,
          globalMotivo: undefined,
          modoGlobal: 'default_on',
          contatos: [],
          contatosAtivos: [],
        }),
        directusConfigurado()
          ? comTimeout(validarDirectusToken(), 2500, false)
          : Promise.resolve(false),
        directusConfigurado() ? comTimeout(verificarDirectus(), 2500, false) : Promise.resolve(false),
    ]);
    const ok = redis && postgres;
    return {
      status: ok ? 'ok' : 'degradado',
      build: config.buildId,
      servicos: {
        redis,
        postgres,
        evolution,
        qdrant,
        openrouter: tokens.openrouter,
        claude: tokens.claude,
        openai: tokens.openai,
        groq: tokens.groq,
        provedorAtivo: tokens.provedorAtivo,
        openaiUtilidades: tokens.openaiUtilidades,
        directus: directusOk,
        directusToken: directusTokenOk,
      },
      pausa,
      warmup: obterStatusWarmupPosBoot(),
      filaInferencia: statusFilaInferencia(),
      instancia: config.evolutionInstance,
    };
  });

  /** Valida tokens explicitamente */
  app.get('/api/tokens', async () => {
    const tokens = await validarTokens();
    return {
      openrouter: tokens.openrouter,
      claude: tokens.claude,
      openai: tokens.openai,
      groq: tokens.groq,
      provedorAtivo: tokens.provedorAtivo,
      openaiUtilidades: tokens.openaiUtilidades,
      openrouterConfigurado: Boolean(config.openrouterHabilitado && config.openrouterToken),
      claudeConfigurado: Boolean(config.anthropicToken),
      openaiConfigurado: Boolean(config.openaiToken),
      groqConfigurado: Boolean(config.groqToken),
    };
  });
}
