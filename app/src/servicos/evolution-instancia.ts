/**
 * Operações de instância WhatsApp na Evolution API.
 */
import { config } from '../config.js';

interface AlvoWhatsapp {
  nomeLogico: 'ia_local' | 'chatwoot_futuro';
  url: string;
  apiKey: string;
  instancia: string;
  origem: string;
}

const headers = (apiKey: string) => ({
  'Content-Type': 'application/json',
  apikey: apiKey,
});

export interface StatusConexao {
  instance: string;
  state: string;
  conectado: boolean;
  motivoDesconexao?: string;
  podeEnviar: boolean;
  alvo: 'ia_local' | 'chatwoot_futuro';
  origem: string;
  servidor: string;
  numeroConectado?: string | null;
  nomePerfil?: string | null;
  atualizadoEm?: string | null;
}

interface InstanciaEvolution {
  name?: string;
  connectionStatus?: string;
  ownerJid?: string | null;
  profileName?: string | null;
  number?: string | null;
  updatedAt?: string | null;
  disconnectionReasonCode?: number;
  disconnectionObject?: string;
}

/**
 * A IA opera exclusivamente nesta conexão local por enquanto.
 * Quando a integração com o outro servidor entrar, ela deve usar outro alvo
 * explícito para evitar reconectar ou derrubar a sessão errada.
 */
function alvoIaLocal(): AlvoWhatsapp {
  return {
    nomeLogico: 'ia_local',
    url: config.whatsappIaUrl,
    apiKey: config.whatsappIaApiKey,
    instancia: config.whatsappIaInstance,
    origem: config.whatsappIaOrigem,
  };
}

/**
 * Preparado para o futuro, mas desabilitado por padrão.
 * Não usar este alvo nas rotas atuais da IA antes de uma virada controlada.
 */
function alvoChatwootFuturo(): AlvoWhatsapp {
  if (!config.whatsappChatwootFuturoHabilitado) {
    throw new Error('Integração futura com servidor externo ainda não foi habilitada.');
  }
  if (
    !config.whatsappChatwootFuturoUrl ||
    !config.whatsappChatwootFuturoApiKey ||
    !config.whatsappChatwootFuturoInstance
  ) {
    throw new Error('Integração futura configurada de forma incompleta.');
  }
  return {
    nomeLogico: 'chatwoot_futuro',
    url: config.whatsappChatwootFuturoUrl,
    apiKey: config.whatsappChatwootFuturoApiKey,
    instancia: config.whatsappChatwootFuturoInstance,
    origem: 'externo_futuro',
  };
}

function servidorVisivel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function extrairNumeroConectado(inst?: InstanciaEvolution | null): string | null {
  const raw = inst?.number || inst?.ownerJid || '';
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits || null;
}

/** Estado da conexão WhatsApp */
async function obterStatusConexaoPorAlvo(alvo: AlvoWhatsapp): Promise<StatusConexao> {
  const url = `${alvo.url}/instance/connectionState/${alvo.instancia}`;
  const res = await fetch(url, { headers: headers(alvo.apiKey), signal: AbortSignal.timeout(15000) });
  if (res.status === 404) {
    return {
      instance: alvo.instancia,
      state: 'not_found',
      conectado: false,
      motivoDesconexao: 'Instância WhatsApp não criada — escaneie o QR em /whatsapp',
      podeEnviar: false,
      alvo: alvo.nomeLogico,
      origem: alvo.origem,
      servidor: servidorVisivel(alvo.url),
    };
  }
  if (!res.ok) {
    const corpo = await res.text();
    throw new Error(`connectionState falhou (${res.status}): ${corpo}`);
  }
  const dados = (await res.json()) as { instance?: { state?: string } };
  const state = dados.instance?.state ?? 'desconhecido';
  const conectado = state === 'open';

  let motivoDesconexao: string | undefined;
  let instanciaDetalhe: InstanciaEvolution | undefined;
  if (!conectado) {
    try {
      const listRes = await fetch(`${alvo.url}/instance/fetchInstances`, {
        headers: headers(alvo.apiKey),
        signal: AbortSignal.timeout(15000),
      });
      if (listRes.ok) {
        const lista = (await listRes.json()) as InstanciaEvolution[];
        const inst = lista.find((i) => i.name === alvo.instancia);
        instanciaDetalhe = inst;
        if (inst?.disconnectionObject) {
          const parsed = JSON.parse(inst.disconnectionObject) as {
            error?: { data?: { attrs?: { type?: string } } };
          };
          const tipo = parsed.error?.data?.attrs?.type;
          if (tipo === 'device_removed') {
            motivoDesconexao =
              'Sessao removida pelo WhatsApp. Isso pode acontecer por outro dispositivo conectado ou por instabilidade da versao atual da conexao.';
          } else if (tipo) {
            motivoDesconexao = `Desconectado: ${tipo}`;
          }
        }
      }
    } catch {
      /* ignora */
    }
  }

  if (!instanciaDetalhe) {
    try {
      const listRes = await fetch(`${alvo.url}/instance/fetchInstances`, {
        headers: headers(alvo.apiKey),
        signal: AbortSignal.timeout(15000),
      });
      if (listRes.ok) {
        const lista = (await listRes.json()) as InstanciaEvolution[];
        instanciaDetalhe = lista.find((i) => i.name === alvo.instancia);
      }
    } catch {
      /* ignora */
    }
  }

  return {
    instance: alvo.instancia,
    state,
    conectado,
    motivoDesconexao,
    podeEnviar: conectado,
    alvo: alvo.nomeLogico,
    origem: alvo.origem,
    servidor: servidorVisivel(alvo.url),
    numeroConectado: extrairNumeroConectado(instanciaDetalhe),
    nomePerfil: instanciaDetalhe?.profileName ?? null,
    atualizadoEm: instanciaDetalhe?.updatedAt ?? null,
  };
}

/** Estado da conexão ativa da IA */
export async function obterStatusConexao(): Promise<StatusConexao> {
  return obterStatusConexaoPorAlvo(alvoIaLocal());
}

export interface QrCodeResposta {
  base64: string | null;
  pairingCode: string | null;
  count?: number;
}

/** Gera ou atualiza QR code para pareamento */
async function obterQrCodePorAlvo(alvo: AlvoWhatsapp): Promise<QrCodeResposta> {
  const url = `${alvo.url}/instance/connect/${alvo.instancia}`;
  const res = await fetch(url, { headers: headers(alvo.apiKey), signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    const corpo = await res.text();
    throw new Error(`connect falhou (${res.status}): ${corpo}`);
  }
  const dados = (await res.json()) as QrCodeResposta;
  return {
    base64: dados.base64 ?? null,
    pairingCode: dados.pairingCode ?? null,
    count: dados.count,
  };
}

/** QR da conexão ativa da IA */
export async function obterQrCode(): Promise<QrCodeResposta> {
  return obterQrCodePorAlvo(alvoIaLocal());
}

/** Desconecta sessão e gera novo QR */
async function reconectarPorAlvo(alvo: AlvoWhatsapp): Promise<QrCodeResposta> {
  const logoutUrl = `${alvo.url}/instance/logout/${alvo.instancia}`;
  await fetch(logoutUrl, {
    method: 'DELETE',
    headers: headers(alvo.apiKey),
    signal: AbortSignal.timeout(15000),
  }).catch(() => {
    /* logout pode falhar se já desconectado */
  });
  await new Promise((r) => setTimeout(r, 1500));
  return obterQrCodePorAlvo(alvo);
}

/** Reconexão da conexão ativa da IA */
export async function reconectar(): Promise<QrCodeResposta> {
  return reconectarPorAlvo(alvoIaLocal());
}

/**
 * Preparo para o futuro: permite descobrir as instâncias do outro servidor
 * somente quando a integração externa estiver habilitada por .env.
 */
export async function listarInstanciasChatwootFuturo(): Promise<InstanciaEvolution[]> {
  const alvo = alvoChatwootFuturo();
  const res = await fetch(`${alvo.url}/instance/fetchInstances`, {
    headers: headers(alvo.apiKey),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const corpo = await res.text();
    throw new Error(`fetchInstances falhou (${res.status}): ${corpo}`);
  }
  return (await res.json()) as InstanciaEvolution[];
}
