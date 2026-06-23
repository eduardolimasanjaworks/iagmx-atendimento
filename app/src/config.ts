/**
 * Configuração central da aplicação.
 * Lê tokens do .env do usuário com fallbacks; demais valores têm defaults internos.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Carrega variáveis do arquivo .env na raiz do projeto. */
function carregarEnv(): void {
  const caminhos = [
    resolve(process.cwd(), '../.env'),
    resolve(process.cwd(), '.env'),
    '/app/.env',
  ];
  for (const caminho of caminhos) {
    if (!existsSync(caminho)) continue;
    const conteudo = readFileSync(caminho, 'utf-8');
    for (const linha of conteudo.split('\n')) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('#')) continue;
      const idx = limpa.indexOf('=');
      if (idx === -1) continue;
      const chave = limpa.slice(0, idx).trim();
      const valor = limpa.slice(idx + 1).trim();
      if (!process.env[chave]) process.env[chave] = valor;
    }
    break;
  }
}

carregarEnv();

function resolverArquivoGoogle(...caminhos: string[]): string {
  for (const c of caminhos) {
    if (existsSync(c)) return c;
  }
  return caminhos[0];
}

/** Resolve URL: Docker usa hostname `redis`; host local usa porta publicada no compose. */
function resolverRedisUrl(): string {
  const env = process.env.REDIS_URL?.trim();
  if (env) return env;
  if (existsSync('/.dockerenv')) return 'redis://redis:6379/0';
  return 'redis://127.0.0.1:6380/0';
}

/** Resolve token com fallbacks de nomenclatura */
function token(...chaves: string[]): string {
  for (const chave of chaves) {
    const valor = process.env[chave]?.trim();
    if (valor) return valor;
  }
  return '';
}

function bool(chave: string, padrao = false): boolean {
  const valor = process.env[chave]?.trim().toLowerCase();
  if (!valor) return padrao;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(valor);
}

function normalizarUrlSemBarra(url: string): string {
  return url.trim().replace(/\/$/, '').toLowerCase();
}

/**
 * Regras de separação das conexões WhatsApp.
 *
 * Hoje a IA usa a instância local deste servidor.
 * O servidor externo ligado ao outro fluxo pode ser configurado depois, mas
 * fica isolado por padrão para evitar reconectar o número errado ou expulsar
 * uma sessão em produção por acidente.
 */
const whatsappIaUrl = process.env.WHATSAPP_IA_URL ?? process.env.EVOLUTION_URL ?? 'http://evolution-api:8080';
const whatsappIaApiKey =
  process.env.WHATSAPP_IA_API_KEY ?? process.env.EVOLUTION_API_KEY ?? 'iagmx-evolution-key-2026';
const whatsappIaInstance =
  process.env.WHATSAPP_IA_INSTANCE ?? process.env.EVOLUTION_INSTANCE ?? 'gmx-atendimento';

const whatsappChatwootFuturoHabilitado = bool('WHATSAPP_CHATWOOT_FUTURO_HABILITADO', false);
const whatsappChatwootFuturoUrl = process.env.WHATSAPP_CHATWOOT_FUTURO_URL ?? '';
const whatsappChatwootFuturoApiKey = process.env.WHATSAPP_CHATWOOT_FUTURO_API_KEY ?? '';
const whatsappChatwootFuturoInstance = process.env.WHATSAPP_CHATWOOT_FUTURO_INSTANCE ?? '';
const whatsappPermitirInstanciaCompartilhada = bool('WHATSAPP_PERMITIR_INSTANCIA_COMPARTILHADA', false);
const openrouterToken = token('openroutertoken', 'OPENROUTER_API_KEY');
const openrouterHabilitado = bool('OPENROUTER_HABILITADO', Boolean(openrouterToken));
const provedorChatPreferido = (
  process.env.PROVEDOR_CHAT_PREFERIDO ??
  (openrouterHabilitado ? 'openrouter' : 'claude')
).trim().toLowerCase();

if (whatsappChatwootFuturoHabilitado) {
  const faltando = [
    !whatsappChatwootFuturoUrl ? 'WHATSAPP_CHATWOOT_FUTURO_URL' : '',
    !whatsappChatwootFuturoApiKey ? 'WHATSAPP_CHATWOOT_FUTURO_API_KEY' : '',
    !whatsappChatwootFuturoInstance ? 'WHATSAPP_CHATWOOT_FUTURO_INSTANCE' : '',
  ].filter(Boolean);

  if (faltando.length > 0) {
    throw new Error(
      `Configuração futura do WhatsApp externo incompleta: faltam ${faltando.join(', ')}`,
    );
  }

  const mesmoServidor =
    normalizarUrlSemBarra(whatsappIaUrl) === normalizarUrlSemBarra(whatsappChatwootFuturoUrl);
  const mesmaInstancia =
    whatsappIaInstance.trim().toLowerCase() === whatsappChatwootFuturoInstance.trim().toLowerCase();

  if (mesmoServidor && mesmaInstancia && !whatsappPermitirInstanciaCompartilhada) {
    throw new Error(
      'Bloqueado por segurança: a conexão futura externa não pode reutilizar a mesma instância da IA local. Defina outra instância ou habilite explicitamente WHATSAPP_PERMITIR_INSTANCIA_COMPARTILHADA=true apenas quando a unificação for intencional e controlada.',
    );
  }
}

export const config = {
  porta: 8095,

  /** Token OpenAI — embeddings, Whisper e fallback de chat/vision */
  openaiToken: token('openaitoken', 'tokenopenai', 'OPENAI_API_KEY'),

  /** Token Anthropic (Claude) — chat primário e OCR */
  anthropicToken: token('claudetoken', 'CLAUDETOKEN', 'ANTHROPIC_API_KEY'),

  /** Token Groq — fallback de chat quando Claude/OpenAI falharem */
  groqToken: token('groqtoken', 'GROQ_API_KEY'),

  /** Token OpenRouter — camada extra de modelos compatíveis com API OpenAI */
  openrouterToken,
  openrouterHabilitado,
  openrouterBaseUrl: (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
  openrouterReferer: process.env.OPENROUTER_REFERER?.trim() || 'https://iagmx.sanjaworks.com',
  openrouterAppName: process.env.OPENROUTER_APP_NAME?.trim() || 'iagmx-atendimento',
  provedorChatPreferido,

  /**
   * Conexão ativa da IA hoje.
   * Mantida em aliases antigos EVOLUTION_* para não quebrar deploy atual.
   */
  evolutionUrl: whatsappIaUrl,
  evolutionApiKey: whatsappIaApiKey,
  evolutionInstance: whatsappIaInstance,
  whatsappIaUrl,
  whatsappIaApiKey,
  whatsappIaInstance,
  whatsappIaOrigem: process.env.WHATSAPP_IA_ORIGEM ?? 'local',

  /**
   * Conexão futura do outro fluxo.
   * Não é usada agora nas rotas da IA; existe só para preparar a integração com
   * o outro servidor sem misturar as sessões antes da hora.
   */
  whatsappChatwootFuturoHabilitado,
  whatsappChatwootFuturoUrl,
  whatsappChatwootFuturoApiKey,
  whatsappChatwootFuturoInstance,
  whatsappPermitirInstanciaCompartilhada,

  redisUrl: resolverRedisUrl(),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://iagmx:iagmx_secret@postgres:5432/iagmx',

  /** URL do Qdrant (vetorização do prompt) */
  qdrantUrl: process.env.QDRANT_URL ?? 'http://qdrant:6333',
  qdrantColecao: 'prompt_gmx',
  qdrantColecaoLinguagem: 'linguagem_motorista_gmx',
  qdrantColecaoMemoriaContato: 'memoria_contato_gmx',

  debounceMs: parseInt(process.env.DEBOUNCE_MS ?? '2200', 10),
  debounceWorkerMs: 300,

  buildId: process.env.IAGMX_BUILD_ID ?? '2026-06-18a-fila-localizacao',

  modeloChat: (process.env.MODELO_CHAT ?? 'gpt-4o') as string,
  modeloChatClaude: (process.env.MODELO_CHAT_CLAUDE ?? 'claude-sonnet-4-20250514') as string,
  modeloChatGroq: (process.env.MODELO_CHAT_GROQ ?? 'llama-3.3-70b-versatile') as string,
  modeloChatOpenRouter: (process.env.MODELO_CHAT_OPENROUTER ?? 'z-ai/glm-5.2') as string,
  modeloChatOpenRouterAuditoria: (
    process.env.MODELO_CHAT_OPENROUTER_AUDITORIA ?? 'anthropic/claude-fable-5'
  ) as string,
  redundanciaDisponibilidadeHabilitada: bool('REDUNDANCIA_DISPONIBILIDADE_HABILITADA', true),
  modeloVisaoClaude: (process.env.MODELO_VISAO_CLAUDE ?? 'claude-sonnet-4-20250514') as string,
  modeloVisaoOpenAI: (process.env.MODELO_VISAO_OPENAI ?? 'gpt-4o') as string,
  modeloStt: 'whisper-1' as const,
  modeloEmbedding: 'text-embedding-3-large' as const,

  /** Limite de caracteres para usar RAG em vez do prompt inteiro */
  limitePromptRag: 6000,

  /** Quantidade de chunks recuperados do Qdrant */
  chunksRag: 6,

  /** Mensagens brutas mantidas no Redis para memoria do mesmo dia */
  historicoMaxMensagens: 80,

  /** Delay entre mensagens fragmentadas no WhatsApp (ms) */
  delayEntreMensagens: 1800,

  /** Inferências LLM simultâneas (resto aguarda na fila interna) */
  inferenciaConcorrenciaMax: Math.min(
    5,
    Math.max(1, parseInt(process.env.INFERENCIA_CONCORRENCIA_MAX ?? '4', 10)),
  ),

  /** Caminho do arquivo de prompt inicial (host e container) */
  promptArquivoInicial: [
    resolve(process.cwd(), '../prompt inicial para avaliarmos dificuldade'),
    resolve(process.cwd(), 'prompt inicial para avaliarmos dificuldade'),
    '/app/prompt-inicial.txt',
  ],

  promptPadrao: `Você é a assistente virtual de atendimento da GMX no WhatsApp.
Responda sempre em português brasileiro, de forma clara, profissional e objetiva.
Em vários fluxos operacionais, a própria GMX inicia a conversa de forma proativa para atualizar agenda, disponibilidade, localização, documentos ou negociar uma oferta.
Quando houver gatilho operacional explícito no contexto do ERP, histórico recente ou instruções do fluxo, assuma que a mensagem inicial parte da GMX e conduza a abordagem como equipe operacional.
Quando não houver esse gatilho explícito, nunca invente contato proativo da empresa.`,

  /** Instrução de formatação WhatsApp injetada em toda resposta */
  instrucaoFormatacao: `
FORMATAÇÃO WHATSAPP:
- Uma linha só, sem enter/parágrafo
- Máximo 3 vírgulas (4 mensagens no máximo)
- NUNCA ponto final (.)
- Cada trecho entre vírgulas = uma bolha separada no celular
- Tom de conversa entre parceiros de estrada, direto e leve`,

  /** Directus GMX — ferramentas (OCR, disponibilidade, etc.) */
  directusUrl: (process.env.DIRECTUS_URL ?? 'https://gmx.sanjaworks.com/api').replace(/\/$/, ''),
  directusToken: token('directustoken', 'DIRECTUS_TOKEN', 'VITE_DIRECTUS_TOKEN'),

  /** Chave opcional para endpoints /api/pausa */
  adminKey: token('iagmxadminkey', 'IAGMX_ADMIN_KEY'),

  /** Login do painel web do IAGMX */
  painelAdminEmail: process.env.PAINEL_ADMIN_EMAIL?.trim() || 'admin@gmx.com',
  painelAdminSenha: process.env.PAINEL_ADMIN_SENHA?.trim() || '789632145',
  painelEquipeEmail: process.env.PAINEL_EQUIPE_EMAIL?.trim() || 'equipe@gmx.com',
  painelEquipeSenha: process.env.PAINEL_EQUIPE_SENHA?.trim() || '123',
  painelSessaoSecret:
    process.env.PAINEL_SESSAO_SECRET?.trim() ||
    token('IAGMX_ADMIN_KEY') ||
    'iagmx-painel-secret-2026',

  /** Idade máxima para drenar resposta enfileirada (evita disparo tardio sem contexto) */
  filaRespostaMaxIdadeMs: Math.max(
    60_000,
    parseInt(process.env.FILA_RESPOSTA_MAX_IDADE_MS ?? String(15 * 60 * 1000), 10),
  ),

  /** TTL Redis de itens na fila de respostas */
  filaRespostaTtlSegundos: Math.max(
    300,
    parseInt(process.env.FILA_RESPOSTA_TTL_SEGUNDOS ?? String(30 * 60), 10),
  ),

  /** Reconciliação ERP ↔ conversas WhatsApp (disponibilidade/localização) */
  reconciliacaoIntervaloMs: Math.max(
    5 * 60_000,
    parseInt(process.env.RECONCILIACAO_INTERVALO_MS ?? String(30 * 60 * 1000), 10),
  ),
  reconciliacaoJanelaHoras: Math.max(
    1,
    parseInt(process.env.RECONCILIACAO_JANELA_HORAS ?? '48', 10),
  ),
  reconciliacaoMaxMensagens: Math.max(
    10,
    parseInt(process.env.RECONCILIACAO_MAX_MENSAGENS ?? '40', 10),
  ),
  reconciliacaoMaxIaPorCiclo: Math.max(
    1,
    parseInt(process.env.RECONCILIACAO_MAX_IA_POR_CICLO ?? '25', 10),
  ),
  /** Tempo máximo de um ciclo de reconciliação (ms) */
  reconciliacaoTimeoutMs: Math.max(
    30_000,
    parseInt(process.env.RECONCILIACAO_TIMEOUT_MS ?? String(2 * 60 * 1000), 10),
  ),
  /** Máximo de chaves Redis inspecionadas por ciclo (scan) */
  reconciliacaoMaxChavesScan: Math.max(
    20,
    parseInt(process.env.RECONCILIACAO_MAX_CHAVES_SCAN ?? '300', 10),
  ),
  /** Mensagens finais lidas por chave no pré-filtro do scan */
  reconciliacaoPrefetchMensagens: Math.max(
    4,
    parseInt(process.env.RECONCILIACAO_PREFETCH_MSG ?? '12', 10),
  ),

  /** Abordagem proativa GMX — lote diário com aprovação humana */
  contatoProativoIntervaloMs: Math.max(
    60 * 60_000,
    parseInt(process.env.CONTATO_PROATIVO_INTERVALO_MS ?? String(24 * 60 * 60 * 1000), 10),
  ),
  contatoProativoLimiteDiario: Math.max(
    50,
    parseInt(process.env.CONTATO_PROATIVO_LIMITE_DIARIO ?? '300', 10),
  ),
  contatoProativoMinHorasSemContato: Math.max(
    6,
    parseInt(process.env.CONTATO_PROATIVO_MIN_HORAS_SEM_CONTATO ?? '48', 10),
  ),
  contatoProativoMinHorasSemPosicao: Math.max(
    6,
    parseInt(process.env.CONTATO_PROATIVO_MIN_HORAS_SEM_POSICAO ?? '24', 10),
  ),

  /** Autoavaliacao ciclica da IA sobre traces recentes */
  autoavaliacaoIntervaloMs: Math.max(
    15 * 60_000,
    parseInt(process.env.AUTOAVALIACAO_INTERVALO_MS ?? String(2 * 60 * 60 * 1000), 10),
  ),
  autoavaliacaoMaxTraces: Math.min(
    200,
    Math.max(20, parseInt(process.env.AUTOAVALIACAO_MAX_TRACES ?? '60', 10)),
  ),
  autoavaliacaoLentidaoMs: Math.max(
    5_000,
    parseInt(process.env.AUTOAVALIACAO_LENTIDAO_MS ?? '18000', 10),
  ),

  /** Google Drive — espelho de arquivos WhatsApp (credenciais do ERP gmx) */
  googleDriveRootFolderId:
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? '1WSKCajrztXNyQ1Yy8dJkeN8-LeDzE_vk',
  googleOAuthClientFile: resolverArquivoGoogle(
    process.env.GOOGLE_OAUTH_CLIENT_FILE ?? '/app/secrets/google-oauth-client.json',
    resolve(process.cwd(), '../gmx/google-oauth-client.json'),
    '/root/gmx/google-oauth-client.json',
  ),
  googleTokenFile: resolverArquivoGoogle(
    process.env.GOOGLE_TOKEN_FILE ?? '/app/secrets/.google-token.json',
    resolve(process.cwd(), '../gmx/.google-token.json'),
    '/root/gmx/.google-token.json',
  ),
};
