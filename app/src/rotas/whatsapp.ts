/**
 * Rotas para conectar WhatsApp via QR code (Evolution API).
 */
import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import {
  obterStatusConexao,
  obterStatusConexaoPorNome,
  listarStatusConexaoWhatsapp,
  obterQrCode,
  obterQrCodePorNome,
  reconectar,
  reconectarPorNome,
} from '../servicos/evolution-instancia.js';
import { config } from '../config.js';
import { painelAutenticado, painelAdmin } from '../servicos/painel-acesso.js';
import { obterAlvoWhatsapp } from '../servicos/whatsapp-targets.js';

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
  app.get('/api/whatsapp/alvos', async (req, reply) => {
    if (!exigirPainel(req, reply)) return;
    return {
      itens: await listarStatusConexaoWhatsapp(),
      escopo: 'conexao_dupla_ia',
      pausaGlobalInicial: config.iaGlobalDefaultOff,
    };
  });

  app.get<{ Params: { alvo: string } }>('/api/whatsapp/alvos/:alvo/status', async (req, reply) => {
    reportarDebugWhatsapp(req, 'status', 'entrada', { alvo: req.params.alvo });
    if (!exigirPainel(req, reply)) return;
    if (!obterAlvoWhatsapp(req.params.alvo)) {
      return reply.status(404).send({ erro: 'Alvo WhatsApp não encontrado' });
    }
    if (!aplicarCooldown('status', reply)) {
      reportarDebugWhatsapp(req, 'status', 'cooldown', {
        alvo: req.params.alvo,
        ultimoStatusEm: ULTIMA_ACAO.status,
        cooldownMs: COOLDOWN_MS.status,
      });
      return;
    }
    const status = await obterStatusConexaoPorNome(req.params.alvo);
    reportarDebugWhatsapp(req, 'status', 'permitido', {
      alvo: req.params.alvo,
      statusRetornado: status.state,
      conectado: status.conectado,
      podeEnviar: status.podeEnviar,
    });
    return {
      ...status,
      escopo: 'conexao_dupla_ia',
      cooldownMs: COOLDOWN_MS.status,
      cooldownAte: new Date(ULTIMA_ACAO.status + COOLDOWN_MS.status).toISOString(),
    };
  });

  app.get<{ Params: { alvo: string } }>('/api/whatsapp/alvos/:alvo/qrcode', async (req, reply) => {
    reportarDebugWhatsapp(req, 'qrcode', 'entrada', { alvo: req.params.alvo });
    if (!exigirPainel(req, reply)) return;
    const alvo = obterAlvoWhatsapp(req.params.alvo);
    if (!alvo) {
      return reply.status(404).send({ erro: 'Alvo WhatsApp não encontrado' });
    }
    if (!alvo.permiteQr) {
      return reply.status(403).send({ erro: 'Este alvo nao permite abrir QR por este painel.' });
    }
    if (!aplicarCooldown('qrcode', reply)) {
      reportarDebugWhatsapp(req, 'qrcode', 'cooldown', {
        alvo: req.params.alvo,
        ultimoQrEm: ULTIMA_ACAO.qrcode,
        cooldownMs: COOLDOWN_MS.qrcode,
      });
      return;
    }
    const status = await obterStatusConexaoPorNome(req.params.alvo);
    reportarDebugWhatsapp(req, 'qrcode', 'permitido', {
      alvo: req.params.alvo,
      statusAntesQr: status.state,
      conectadoAntesQr: status.conectado,
      podeEnviarAntesQr: status.podeEnviar,
      permiteReconectar: alvo.permiteReconectar,
    });
    if (status.conectado) {
      return {
        conectado: true,
        base64: null,
        mensagem: 'WhatsApp ja conectado',
        alvo: req.params.alvo,
        cooldownMs: COOLDOWN_MS.qrcode,
        cooldownAte: new Date(ULTIMA_ACAO.qrcode + COOLDOWN_MS.qrcode).toISOString(),
      };
    }
    const qr = await obterQrCodePorNome(req.params.alvo);
    reportarDebugWhatsapp(req, 'qrcode', 'permitido', {
      alvo: req.params.alvo,
      hasBase64: Boolean(qr.base64),
      hasPairingCode: Boolean(qr.pairingCode),
      count: qr.count ?? null,
    });
    if (!qr.base64) {
      const statusAtualizado = await obterStatusConexaoPorNome(req.params.alvo);
      reportarDebugWhatsapp(req, 'qrcode', 'permitido', {
        alvo: req.params.alvo,
        statusDepoisQr: statusAtualizado.state,
        conectadoDepoisQr: statusAtualizado.conectado,
        podeEnviarDepoisQr: statusAtualizado.podeEnviar,
      });
      if (statusAtualizado.conectado) {
        return {
          conectado: true,
          base64: null,
          mensagem: 'WhatsApp ja conectado',
          alvo: req.params.alvo,
          cooldownMs: COOLDOWN_MS.qrcode,
          cooldownAte: new Date(ULTIMA_ACAO.qrcode + COOLDOWN_MS.qrcode).toISOString(),
        };
      }
      return reply.status(503).send({ erro: 'QR code não disponível. Tente reconectar.', alvo: req.params.alvo });
    }
    return {
      conectado: false,
      base64: qr.base64,
      pairingCode: qr.pairingCode,
      instancia: status.instance,
      alvo: req.params.alvo,
      escopo: 'conexao_dupla_ia',
      cooldownMs: COOLDOWN_MS.qrcode,
      cooldownAte: new Date(ULTIMA_ACAO.qrcode + COOLDOWN_MS.qrcode).toISOString(),
    };
  });

  app.post<{ Params: { alvo: string } }>('/api/whatsapp/alvos/:alvo/reconectar', async (req, reply) => {
    reportarDebugWhatsapp(req, 'reconectar', 'entrada', { alvo: req.params.alvo });
    if (!exigirAdmin(req, reply)) return;
    const alvo = obterAlvoWhatsapp(req.params.alvo);
    if (!alvo) {
      return reply.status(404).send({ erro: 'Alvo WhatsApp não encontrado' });
    }
    if (!alvo.permiteReconectar) {
      return reply.status(403).send({ erro: 'Este numero nao pode ser reconectado por este painel.' });
    }
    if (!aplicarCooldown('reconectar', reply)) {
      reportarDebugWhatsapp(req, 'reconectar', 'cooldown', { alvo: req.params.alvo });
      return;
    }
    const status = await obterStatusConexaoPorNome(req.params.alvo);
    const qr = await reconectarPorNome(req.params.alvo);
    const statusAtualizado = await obterStatusConexaoPorNome(req.params.alvo);
    if (!qr.base64 && !statusAtualizado.conectado) {
      return reply.status(503).send({
        erro: 'Nao foi possivel gerar novo QR para esta sessao.',
        instancia: alvo.instancia,
        alvo: req.params.alvo,
        escopo: 'conexao_dupla_ia',
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
      instancia: alvo.instancia,
      alvo: req.params.alvo,
      escopo: 'conexao_dupla_ia',
      estavaConectado: status.conectado,
      cooldownMs: COOLDOWN_MS.reconectar,
      cooldownAte: new Date(ULTIMA_ACAO.reconectar + COOLDOWN_MS.reconectar).toISOString(),
    };
  });

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
    reportarDebugWhatsapp(req, 'status', 'permitido', {
      statusRetornado: status.state,
      conectado: status.conectado,
      podeEnviar: status.podeEnviar,
      numeroConectado: status.numeroConectado ?? null,
      nomePerfil: status.nomePerfil ?? null,
      motivoDesconexao: status.motivoDesconexao ?? null,
    });
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
    reportarDebugWhatsapp(req, 'qrcode', 'permitido', {
      statusAntesQr: status.state,
      conectadoAntesQr: status.conectado,
      podeEnviarAntesQr: status.podeEnviar,
    });
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
    reportarDebugWhatsapp(req, 'qrcode', 'permitido', {
      hasBase64: Boolean(qr.base64),
      hasPairingCode: Boolean(qr.pairingCode),
      count: qr.count ?? null,
    });
    if (!qr.base64) {
      const statusAtualizado = await obterStatusConexao();
      reportarDebugWhatsapp(req, 'qrcode', 'permitido', {
        statusDepoisQr: statusAtualizado.state,
        conectadoDepoisQr: statusAtualizado.conectado,
        podeEnviarDepoisQr: statusAtualizado.podeEnviar,
      });
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
    reportarDebugWhatsapp(req, 'reconectar', 'permitido', {
      statusAntesReconectar: status.state,
      conectadoAntesReconectar: status.conectado,
      statusDepoisReconectar: statusAtualizado.state,
      conectadoDepoisReconectar: statusAtualizado.conectado,
      podeEnviarDepoisReconectar: statusAtualizado.podeEnviar,
      hasBase64: Boolean(qr.base64),
      hasPairingCode: Boolean(qr.pairingCode),
      count: qr.count ?? null,
    });
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
