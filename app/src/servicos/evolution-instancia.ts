/**
 * Operações de instância WhatsApp na Evolution API.
 */
import { config } from '../config.js';
import { resolverStatusEvolution } from './evolution-status.js';
import { existsSync, readFileSync } from 'node:fs';
import {
  listarAlvosWhatsapp,
  obterAlvoWhatsapp,
  obterAlvoWhatsappPadrao,
  type AlvoWhatsapp,
  type AlvoWhatsappNome,
} from './whatsapp-targets.js';

const headers = (apiKey: string) => ({
  'Content-Type': 'application/json',
  apikey: apiKey,
});

function reportarDebugEvolution(
  etapa: string,
  extra?: Record<string, unknown>,
) {
  let url = 'http://127.0.0.1:7777/event';
  let sessionId = 'whatsapp-auxiliar-qr';
  try {
    const caminhos = [
      '.dbg/whatsapp-auxiliar-qr.env',
      '.dbg/whatsapp-false-open.env',
    ];
    for (const caminho of caminhos) {
      if (!existsSync(caminho)) continue;
      const env = readFileSync(caminho, 'utf8');
      url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || url;
      sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || sessionId;
      break;
    }
  } catch {
    /* noop */
  }

  // #region debug-point A:evolution-status
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      runId: 'pre-fix',
      hypothesisId: 'A',
      location: `evolution-instancia.ts:${etapa}`,
      msg: `[DEBUG] evolution ${etapa}`,
      data: {
        etapa,
        ...extra,
      },
      ts: Date.now(),
    }),
  }).catch(() => undefined);
  // #endregion
}

export interface StatusConexao {
  instance: string;
  state: string;
  conectado: boolean;
  motivoDesconexao?: string;
  podeEnviar: boolean;
  alvo: AlvoWhatsappNome;
  origem: string;
  servidor: string;
  numeroConectado?: string | null;
  nomePerfil?: string | null;
  atualizadoEm?: string | null;
  titulo: string;
  descricao: string;
  permiteReconectar: boolean;
  permiteQr: boolean;
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
    reportarDebugEvolution('connectionState:not_found', {
      instancia: alvo.instancia,
      url,
      statusCode: 404,
    });
    return {
      instance: alvo.instancia,
      state: 'not_found',
      conectado: false,
      motivoDesconexao: 'Instância WhatsApp não criada — escaneie o QR em /whatsapp',
      podeEnviar: false,
      alvo: alvo.nomeLogico,
      origem: alvo.origem,
      servidor: servidorVisivel(alvo.url),
      titulo: alvo.titulo,
      descricao: alvo.descricao,
      permiteReconectar: alvo.permiteReconectar,
      permiteQr: alvo.permiteQr,
    };
  }
  if (!res.ok) {
    const corpo = await res.text();
    reportarDebugEvolution('connectionState:error', {
      instancia: alvo.instancia,
      url,
      statusCode: res.status,
      body: corpo,
    });
    throw new Error(`connectionState falhou (${res.status}): ${corpo}`);
  }
  const dados = (await res.json()) as { instance?: { state?: string } };
  reportarDebugEvolution('connectionState:ok', {
    instancia: alvo.instancia,
    url,
    state: dados.instance?.state ?? null,
  });

  let motivoDesconexao: string | undefined;
  let instanciaDetalhe: InstanciaEvolution | undefined;

  if (!instanciaDetalhe) {
    try {
      const listRes = await fetch(`${alvo.url}/instance/fetchInstances`, {
        headers: headers(alvo.apiKey),
        signal: AbortSignal.timeout(15000),
      });
      if (listRes.ok) {
        const lista = (await listRes.json()) as InstanciaEvolution[];
        instanciaDetalhe = lista.find((i) => i.name === alvo.instancia);
        reportarDebugEvolution('fetchInstances:ok', {
          instancia: alvo.instancia,
          url: `${alvo.url}/instance/fetchInstances`,
          statusCode: listRes.status,
          found: Boolean(instanciaDetalhe),
          fetchConnectionStatus: instanciaDetalhe?.connectionStatus ?? null,
          ownerJid: instanciaDetalhe?.ownerJid ?? null,
          profileName: instanciaDetalhe?.profileName ?? null,
          disconnectionReasonCode: instanciaDetalhe?.disconnectionReasonCode ?? null,
          updatedAt: instanciaDetalhe?.updatedAt ?? null,
        });
      }
    } catch {
      /* ignora */
    }
  }

  const statusResolvido = resolverStatusEvolution({
    connectionState: dados.instance?.state,
    fetchConnectionStatus: instanciaDetalhe?.connectionStatus,
    hasOwnerJid: Boolean(instanciaDetalhe?.ownerJid),
    hasProfileName: Boolean(instanciaDetalhe?.profileName),
    fetchDisconnectionReasonCode: instanciaDetalhe?.disconnectionReasonCode ?? null,
    hasDisconnectionObject: Boolean(instanciaDetalhe?.disconnectionObject),
  });
  reportarDebugEvolution('status:resolved', {
    instancia: alvo.instancia,
    connectionState: dados.instance?.state ?? null,
    fetchConnectionStatus: instanciaDetalhe?.connectionStatus ?? null,
    hasOwnerJid: Boolean(instanciaDetalhe?.ownerJid),
    hasProfileName: Boolean(instanciaDetalhe?.profileName),
    resolvedState: statusResolvido.state,
    conectado: statusResolvido.conectado,
    fonte: statusResolvido.fonte,
    disconnectionReasonCode: instanciaDetalhe?.disconnectionReasonCode ?? null,
  });

  if (!statusResolvido.conectado && instanciaDetalhe?.disconnectionObject) {
    try {
      const parsed = JSON.parse(instanciaDetalhe.disconnectionObject) as {
        error?: { data?: { attrs?: { type?: string } } };
      };
      const tipo = parsed.error?.data?.attrs?.type;
      if (tipo === 'device_removed') {
        motivoDesconexao =
          'Sessao removida pelo WhatsApp. Isso pode acontecer por outro dispositivo conectado ou por instabilidade da versao atual da conexao.';
      } else if (tipo) {
        motivoDesconexao = `Desconectado: ${tipo}`;
      }
    } catch {
      /* ignora */
    }
  }

  if (statusResolvido.state === 'stale_open') {
    motivoDesconexao =
      'A Evolution manteve um status antigo como aberto, mas a sessao atual nao responde. Desconecte e gere um novo QR.';
  }

  return {
    instance: alvo.instancia,
    state: statusResolvido.state,
    conectado: statusResolvido.conectado,
    motivoDesconexao,
    podeEnviar: statusResolvido.conectado,
    alvo: alvo.nomeLogico,
    origem: alvo.origem,
    servidor: servidorVisivel(alvo.url),
    numeroConectado: extrairNumeroConectado(instanciaDetalhe),
    nomePerfil: instanciaDetalhe?.profileName ?? null,
    atualizadoEm: instanciaDetalhe?.updatedAt ?? null,
    titulo: alvo.titulo,
    descricao: alvo.descricao,
    permiteReconectar: alvo.permiteReconectar,
    permiteQr: alvo.permiteQr,
  };
}

/** Estado da conexão ativa da IA */
export async function obterStatusConexao(): Promise<StatusConexao> {
  return obterStatusConexaoPorAlvo(obterAlvoWhatsappPadrao());
}

export async function obterStatusConexaoPorNome(nome: string): Promise<StatusConexao> {
  const alvo = obterAlvoWhatsapp(nome);
  if (!alvo) throw new Error('Alvo WhatsApp não encontrado');
  return obterStatusConexaoPorAlvo(alvo);
}

export async function listarStatusConexaoWhatsapp(): Promise<StatusConexao[]> {
  return Promise.all(listarAlvosWhatsapp().map((alvo) => obterStatusConexaoPorAlvo(alvo)));
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
    reportarDebugEvolution('connect:error', {
      instancia: alvo.instancia,
      url,
      statusCode: res.status,
      body: corpo,
    });
    throw new Error(`connect falhou (${res.status}): ${corpo}`);
  }
  const dados = (await res.json()) as QrCodeResposta;
  reportarDebugEvolution('connect:ok', {
    instancia: alvo.instancia,
    url,
    statusCode: res.status,
    hasBase64: Boolean(dados.base64),
    hasPairingCode: Boolean(dados.pairingCode),
    count: dados.count ?? null,
  });
  return {
    base64: dados.base64 ?? null,
    pairingCode: dados.pairingCode ?? null,
    count: dados.count,
  };
}

/** QR da conexão ativa da IA */
export async function obterQrCode(): Promise<QrCodeResposta> {
  return obterQrCodePorAlvo(obterAlvoWhatsappPadrao());
}

export async function obterQrCodePorNome(nome: string): Promise<QrCodeResposta> {
  const alvo = obterAlvoWhatsapp(nome);
  if (!alvo) throw new Error('Alvo WhatsApp não encontrado');
  return obterQrCodePorAlvo(alvo);
}

/** Desconecta sessão e gera novo QR */
async function reconectarPorAlvo(alvo: AlvoWhatsapp): Promise<QrCodeResposta> {
  const logoutUrl = `${alvo.url}/instance/logout/${alvo.instancia}`;
  await fetch(logoutUrl, {
    method: 'DELETE',
    headers: headers(alvo.apiKey),
    signal: AbortSignal.timeout(15000),
  }).then(async (res) => {
    const body = await res.text().catch(() => '');
    reportarDebugEvolution('logout:result', {
      instancia: alvo.instancia,
      url: logoutUrl,
      statusCode: res.status,
      body,
    });
  }).catch((error) => {
    reportarDebugEvolution('logout:error', {
      instancia: alvo.instancia,
      url: logoutUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    /* logout pode falhar se já desconectado */
  });
  await new Promise((r) => setTimeout(r, 1500));
  return obterQrCodePorAlvo(alvo);
}

/** Reconexão da conexão ativa da IA */
export async function reconectar(): Promise<QrCodeResposta> {
  return reconectarPorAlvo(obterAlvoWhatsappPadrao());
}

export async function reconectarPorNome(nome: string): Promise<QrCodeResposta> {
  const alvo = obterAlvoWhatsapp(nome);
  if (!alvo) throw new Error('Alvo WhatsApp não encontrado');
  if (!alvo.permiteReconectar) {
    throw new Error('Este numero nao pode ser reconectado por este painel.');
  }
  return reconectarPorAlvo(alvo);
}

/**
 * Preparo para o futuro: permite descobrir as instâncias do outro servidor
 * somente quando a integração externa estiver habilitada por .env.
 */
export async function listarInstanciasChatwootFuturo(): Promise<InstanciaEvolution[]> {
  const alvo = obterAlvoWhatsapp('oficial_gmx');
  if (!alvo) {
    throw new Error('WhatsApp oficial GMX não configurado.');
  }
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
