/**
 * Integração Evolution API: envio de mensagens fragmentadas e download de mídia.
 */
import { config } from '../config.js';
import { enviarFragmentosHumanizado } from './envio-humanizado.js';

const headers = () => ({
  'Content-Type': 'application/json',
  apikey: config.evolutionApiKey,
});

/**
 * Envia indicador "digitando..." via Evolution API.
 * @see https://doc.evolution-api.com/v2/api-reference/chat-controller/send-presence
 */
export async function enviarDigitando(
  instance: string,
  numero: string,
  delayMs: number,
): Promise<void> {
  const url = `${config.evolutionUrl}/chat/sendPresence/${instance}`;
  const corpo = numero.replace(/\D/g, '');

  // v2.3+ aceita campos na raiz; versões antigas usam options
  const formatos = [
    { number: corpo, delay: delayMs, presence: 'composing' },
    { number: corpo, options: { delay: delayMs, presence: 'composing' } },
  ];

  for (const body of formatos) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return;
      const corpo = await res.text();
      console.warn(`[evolution] sendPresence falhou (${res.status}): ${corpo.slice(0, 200)}`);
    } catch (err) {
      console.warn('[evolution] sendPresence erro:', err instanceof Error ? err.message : err);
    }
  }
}

/** Envia uma mensagem de texto */
export async function enviarTexto(
  instance: string,
  numero: string,
  texto: string,
): Promise<void> {
  const url = `${config.evolutionUrl}/message/sendText/${instance}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ number: numero, text: texto }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const corpo = await res.text();
    throw new Error(`Evolution sendText falhou (${res.status}): ${corpo}`);
  }
}

/**
 * Envia resposta fragmentada com delay aleatório e "digitando..." entre partes.
 */
export async function enviarRespostaFragmentada(
  instance: string,
  numero: string,
  textoCompleto: string,
  opts?: { fragmentar?: boolean; ignorarAtrasoInicial?: boolean; ignorarDigitando?: boolean },
): Promise<number> {
  return enviarFragmentosHumanizado(instance, numero, textoCompleto, opts);
}

export async function baixarMidia(
  instance: string,
  messageId: string,
  remoteJid: string,
): Promise<{ buffer: Buffer; mimetype: string }> {
  const url = `${config.evolutionUrl}/chat/getBase64FromMediaMessage/${instance}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      message: { key: { id: messageId, remoteJid } },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const corpo = await res.text();
    throw new Error(`Evolution getBase64 falhou (${res.status}): ${corpo}`);
  }
  const dados = (await res.json()) as { base64?: string; mimetype?: string };
  if (!dados.base64) throw new Error('Mídia sem base64 retornado');
  return {
    buffer: Buffer.from(dados.base64, 'base64'),
    mimetype: dados.mimetype ?? 'application/octet-stream',
  };
}

export async function verificarEvolution(): Promise<boolean> {
  try {
    const res = await fetch(`${config.evolutionUrl}/`, { headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}
