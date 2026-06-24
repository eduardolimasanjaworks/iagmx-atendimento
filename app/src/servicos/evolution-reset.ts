/**
 * Fluxo deterministico de reset de instancia na Evolution para recuperar QR.
 * Tenta destruir o estado residual antes de pedir novo pareamento.
 * Recria a instancia auxiliar com o mesmo nome quando necessario.
 */
import type { AlvoWhatsapp } from './whatsapp-targets.js';
import type { QrCodeResposta } from './evolution-instancia.js';

const RESET_DELAYS_MS = [0, 1500, 3000, 5000] as const;

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    apikey: apiKey,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestText(
  alvo: AlvoWhatsapp,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const res = await fetch(`${alvo.url}${path}`, {
    method,
    headers: headers(alvo.apiKey),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text().catch(() => '');
  return { status: res.status, ok: res.ok, text };
}

async function connectQr(alvo: AlvoWhatsapp): Promise<QrCodeResposta> {
  const res = await requestText(alvo, 'GET', `/instance/connect/${alvo.instancia}`);
  if (!res.ok) {
    throw new Error(`connect falhou (${res.status}): ${res.text}`);
  }
  const data = JSON.parse(res.text || '{}') as QrCodeResposta;
  return {
    base64: data.base64 ?? null,
    pairingCode: data.pairingCode ?? null,
    count: data.count,
  };
}

async function logoutIfPossible(alvo: AlvoWhatsapp) {
  await requestText(alvo, 'DELETE', `/instance/logout/${alvo.instancia}`).catch(() => undefined);
}

async function deleteIfPossible(alvo: AlvoWhatsapp) {
  await requestText(alvo, 'DELETE', `/instance/delete/${alvo.instancia}`).catch(() => undefined);
}

async function createAuxiliarAgain(alvo: AlvoWhatsapp) {
  const res = await requestText(alvo, 'POST', '/instance/create', {
    instanceName: alvo.instancia,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
  });
  if (!res.ok && !res.text.includes('already in use')) {
    throw new Error(`create falhou (${res.status}): ${res.text}`);
  }
}

export async function obterQrCodeComResetDeterministico(alvo: AlvoWhatsapp): Promise<QrCodeResposta> {
  const qrAtual = await connectQr(alvo).catch(() => ({ base64: null, pairingCode: null, count: 0 }));
  if (qrAtual.base64 || qrAtual.pairingCode) {
    return qrAtual;
  }

  await logoutIfPossible(alvo);
  await sleep(1200);

  if (alvo.nomeLogico === 'auxiliar_teste') {
    await deleteIfPossible(alvo);
    await sleep(700);
    await createAuxiliarAgain(alvo);
    await sleep(1500);
  }

  let ultimo: QrCodeResposta = { base64: null, pairingCode: null, count: 0 };
  for (const delayMs of RESET_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    ultimo = await connectQr(alvo);
    if (ultimo.base64 || ultimo.pairingCode) {
      return ultimo;
    }
  }

  return ultimo;
}
