/**
 * Garante que cada conexao WhatsApp publica eventos inbound para o app.
 * Evita ficar com o QR "conectado" mas sem entregar `MESSAGES_UPSERT`.
 * Usa cache curto para nao martelar a API de webhook a cada polling.
 */
const URL_WEBHOOK_PADRAO =
  process.env.IAGMX_WEBHOOK_EVOLUTION_URL?.trim() || 'https://iagmx.sanjaworks.com/webhook/evolution';

const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'] as const;
const CACHE_MS = 60_000;
const ultimoCheckPorInstancia = new Map<string, number>();

interface AlvoWebhookEvolution {
  url: string;
  apiKey: string;
  instancia: string;
}

interface WebhookEvolutionAtual {
  url?: string | null;
  enabled?: boolean;
  events?: string[];
}

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    apikey: apiKey,
  };
}

function precisaPularCache(instancia: string, forcar: boolean): boolean {
  if (forcar) return true;
  const ultimo = ultimoCheckPorInstancia.get(instancia) ?? 0;
  return Date.now() - ultimo > CACHE_MS;
}

function webhookEhValido(atual: WebhookEvolutionAtual | null): boolean {
  if (!atual?.enabled) return false;
  if ((atual.url ?? '').trim() !== URL_WEBHOOK_PADRAO) return false;
  const eventos = new Set((atual.events ?? []).map((item) => String(item).trim().toUpperCase()));
  return EVENTOS_WEBHOOK.every((item) => eventos.has(item));
}

async function lerWebhookAtual(alvo: AlvoWebhookEvolution): Promise<WebhookEvolutionAtual | null> {
  const res = await fetch(`${alvo.url}/webhook/find/${alvo.instancia}`, {
    headers: headers(alvo.apiKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`find webhook falhou (${res.status}): ${corpo}`);
  }
  return (await res.json()) as WebhookEvolutionAtual | null;
}

async function salvarWebhook(alvo: AlvoWebhookEvolution): Promise<void> {
  const res = await fetch(`${alvo.url}/webhook/set/${alvo.instancia}`, {
    method: 'POST',
    headers: headers(alvo.apiKey),
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: URL_WEBHOOK_PADRAO,
        webhook_by_events: false,
        webhook_base64: true,
        events: [...EVENTOS_WEBHOOK],
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`set webhook falhou (${res.status}): ${corpo}`);
  }
}

export async function garantirWebhookEvolution(
  alvo: AlvoWebhookEvolution,
  opts?: { forcar?: boolean },
): Promise<boolean> {
  if (!precisaPularCache(alvo.instancia, Boolean(opts?.forcar))) return false;
  const atual = await lerWebhookAtual(alvo);
  if (!webhookEhValido(atual)) {
    await salvarWebhook(alvo);
  }
  ultimoCheckPorInstancia.set(alvo.instancia, Date.now());
  return true;
}

export function avaliarWebhookEvolutionParaTeste(atual: WebhookEvolutionAtual | null): boolean {
  return webhookEhValido(atual);
}
