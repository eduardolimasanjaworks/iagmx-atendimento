/**
 * Rotas para conectar WhatsApp via QR code (Evolution API).
 */
import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import {
  obterStatusConexao,
  obterQrCode,
  reconectar,
} from '../servicos/evolution-instancia.js';
import { config } from '../config.js';
import { painelAutenticado, painelAdmin } from '../servicos/painel-acesso.js';

const COOLDOWN_MS = {
  status: 3000,
  qrcode: 8000,
  reconectar: 15000,
} as const;

const ULTIMA_ACAO: Record<keyof typeof COOLDOWN_MS, number> = {
  status: 0,
  qrcode: 0,
  reconectar: 0,
};

const ROTULO_ACAO: Record<keyof typeof COOLDOWN_MS, string> = {
  status: 'consultar novamente o status',
  qrcode: 'pedir outro QR code',
  reconectar: 'reiniciar a conexao',
};

function reportarDebugWhatsapp(
  req: {
    headers: Record<string, unknown>;
    url: string;
    method: string;
    ip?: string;
  },
  acao: keyof typeof COOLDOWN_MS,
  etapa: 'entrada' | 'cooldown' | 'permitido',
  extra?: Record<string, unknown>,
) {
  let url = 'http://2.24.201.28:7778/event';
  let sessionId = 'whatsapp-qr-connection';
  try {
    const caminho = '.dbg/whatsapp-qr-connection.env';
    if (existsSync(caminho)) {
      const env = readFileSync(caminho, 'utf8');
      url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || url;
      sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || sessionId;
    }
  } catch {
    /* noop */
  }

  // #region debug-point E:whatsapp-route
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      runId: 'pre-fix',
      hypothesisId: 'E',
      location: `whatsapp.ts:${acao}:${etapa}`,
      msg: `[DEBUG] rota whatsapp ${acao} ${etapa}`,
      data: {
        acao,
        etapa,
        method: req.method,
        url: req.url,
        ip: req.ip ?? null,
        host: String(req.headers.host ?? ''),
        origin: String(req.headers.origin ?? ''),
        referer: String(req.headers.referer ?? ''),
        userAgent: String(req.headers['user-agent'] ?? ''),
        hasCookie: Boolean(req.headers.cookie),
        hasAdminKey: Boolean(req.headers['x-iagmx-key']),
        ...extra,
      },
      ts: Date.now(),
    }),
  }).catch(() => undefined);
  // #endregion
}

function exigirPainel(req: Parameters<typeof painelAutenticado>[0], reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (painelAutenticado(req)) return true;
  reply.status(401).send({ erro: 'Não autenticado' });
  return false;
}

function exigirAdmin(req: Parameters<typeof painelAdmin>[0], reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (painelAdmin(req)) return true;
  reply.status(403).send({ erro: 'Apenas admin pode reconectar o número da i.a' });
  return false;
}

function aplicarCooldown(
  acao: keyof typeof COOLDOWN_MS,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
): boolean {
  const agora = Date.now();
  const restante = ULTIMA_ACAO[acao] + COOLDOWN_MS[acao] - agora;
  if (restante > 0) {
    reply.status(429).send({
      erro: `Aguarde ${Math.ceil(restante / 1000)}s antes de ${ROTULO_ACAO[acao]}.`,
      aguardeMs: restante,
      cooldownAte: new Date(agora + restante).toISOString(),
      acao,
    });
    return false;
  }
  ULTIMA_ACAO[acao] = agora;
  return true;
}

export async function rotasWhatsapp(app: FastifyInstance): Promise<void> {
  /** Status da conexão */
  app.get('/api/whatsapp/status', async (req, reply) => {
    reportarDebugWhatsapp(req, 'status', 'entrada');
    if (!exigirPainel(req, reply)) return;
    if (!aplicarCooldown('status', reply)) {
      reportarDebugWhatsapp(req, 'status', 'cooldown');
      return;
    }
    reportarDebugWhatsapp(req, 'status', 'permitido');
    const status = await obterStatusConexao();
    return {
      ...status,
      escopo: 'conexao_ativa_da_ia',
      aviso:
        'Esta rota controla apenas a conexao atual da IA neste servidor. A integracao futura com outro servidor deve ficar separada ate a virada planejada.',
      preparadoServidorExterno: config.whatsappChatwootFuturoHabilitado,
      cooldownMs: COOLDOWN_MS.status,
      cooldownAte: new Date(ULTIMA_ACAO.status + COOLDOWN_MS.status).toISOString(),
    };
  });

  /** QR code em base64 (data:image/png;base64,...) */
  app.get('/api/whatsapp/qrcode', async (req, reply) => {
    reportarDebugWhatsapp(req, 'qrcode', 'entrada');
    if (!exigirPainel(req, reply)) return;
    if (!aplicarCooldown('qrcode', reply)) {
      reportarDebugWhatsapp(req, 'qrcode', 'cooldown');
      return;
    }
    reportarDebugWhatsapp(req, 'qrcode', 'permitido');
    const status = await obterStatusConexao();
    if (status.conectado) {
      return {
        conectado: true,
        base64: null,
        mensagem: 'WhatsApp ja conectado',
        cooldownMs: COOLDOWN_MS.qrcode,
        cooldownAte: new Date(ULTIMA_ACAO.qrcode + COOLDOWN_MS.qrcode).toISOString(),
      };
    }
    const qr = await obterQrCode();
    if (!qr.base64) {
      const statusAtualizado = await obterStatusConexao();
      if (statusAtualizado.conectado) {
        return {
          conectado: true,
          base64: null,
          mensagem: 'WhatsApp ja conectado',
          cooldownMs: COOLDOWN_MS.qrcode,
          cooldownAte: new Date(ULTIMA_ACAO.qrcode + COOLDOWN_MS.qrcode).toISOString(),
        };
      }
      return reply.status(503).send({ erro: 'QR code não disponível. Tente reconectar.' });
    }
    return {
      conectado: false,
      base64: qr.base64,
      pairingCode: qr.pairingCode,
      instancia: config.whatsappIaInstance,
      escopo: 'conexao_ativa_da_ia',
      cooldownMs: COOLDOWN_MS.qrcode,
      cooldownAte: new Date(ULTIMA_ACAO.qrcode + COOLDOWN_MS.qrcode).toISOString(),
    };
  });

  /** Força logout e gera novo QR */
  app.post('/api/whatsapp/reconectar', async (req, reply) => {
    reportarDebugWhatsapp(req, 'reconectar', 'entrada');
    if (!exigirAdmin(req, reply)) return;
    if (!aplicarCooldown('reconectar', reply)) {
      reportarDebugWhatsapp(req, 'reconectar', 'cooldown');
      return;
    }
    reportarDebugWhatsapp(req, 'reconectar', 'permitido');
    const status = await obterStatusConexao();
    const qr = await reconectar();
    const statusAtualizado = await obterStatusConexao();
    if (!qr.base64 && !statusAtualizado.conectado) {
      return reply.status(503).send({
        erro: 'Nao foi possivel gerar novo QR para esta sessao.',
        instancia: config.whatsappIaInstance,
        escopo: 'conexao_ativa_da_ia',
        cooldownMs: COOLDOWN_MS.reconectar,
        cooldownAte: new Date(ULTIMA_ACAO.reconectar + COOLDOWN_MS.reconectar).toISOString(),
      });
    }
    return {
      ok: true,
      conectado: statusAtualizado.conectado,
      state: statusAtualizado.state,
      base64: qr.base64,
      pairingCode: qr.pairingCode,
      instancia: config.whatsappIaInstance,
      escopo: 'conexao_ativa_da_ia',
      estavaConectado: status.conectado,
      cooldownMs: COOLDOWN_MS.reconectar,
      cooldownAte: new Date(ULTIMA_ACAO.reconectar + COOLDOWN_MS.reconectar).toISOString(),
    };
  });
}
