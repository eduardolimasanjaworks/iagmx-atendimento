/**
 * Servidor Fastify — monta rotas, arquivos estáticos e plugins.
 */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { rotasSaude } from './rotas/saude.js';
import { rotasAdmin } from './rotas/admin.js';
import { rotasWebhook } from './rotas/webhook.js';
import { rotasPausa } from './rotas/pausa.js';
import { rotasDispararOferta } from './rotas/disparar-oferta.js';
import { rotasDebounceAdmin } from './rotas/debounce-admin.js';
import { rotasWhatsapp } from './rotas/whatsapp.js';
import { rotasDiagnostico } from './rotas/diagnostico.js';
import { rotasAtendimento } from './rotas/atendimento.js';
import { rotasPipelineAdmin } from './rotas/pipeline-admin.js';
import { rotasContatoProativo } from './rotas/contato-proativo.js';
import { rotasPainelAuth } from './rotas/painel-auth.js';
import { rotasMonitorTelefone } from './rotas/monitor-telefone.js';
import { rotasJornadasTeste } from './rotas/jornadas-teste.js';
import { rotasOcrDocumentos } from './rotas/ocr-documentos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORIGENS_CORS = new Set([
  'https://gmx.sanjaworks.com',
  'https://iagmx.sanjaworks.com',
]);

function aplicarCors(reply: any, origin?: string | null, reqHeaders?: string | null) {
  if (!origin || !ORIGENS_CORS.has(origin)) return;
  reply.header('Access-Control-Allow-Origin', origin);
  reply.header('Vary', 'Origin');
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  reply.header(
    'Access-Control-Allow-Headers',
    reqHeaders || 'Content-Type, x-iagmx-key, Authorization',
  );
}

export async function criarServidor() {
  const app = Fastify({ logger: true });

  // Handle empty JSON bodies gracefully
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
    if (!body || body.trim() === '') {
      done(null, {});
    } else {
      try {
        const json = JSON.parse(body);
        done(null, json);
      } catch (err) {
        done(err as Error);
      }
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    const reqHeaders =
      typeof req.headers['access-control-request-headers'] === 'string'
        ? req.headers['access-control-request-headers']
        : null;

    aplicarCors(reply, origin, reqHeaders);

    if (req.method === 'OPTIONS' && origin && ORIGENS_CORS.has(origin)) {
      return reply.code(204).send();
    }

    if (!req.url.startsWith('/api/atendimento/contato/')) return;
    // #region debug-point B:atendimento-onrequest
    fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'gmx-iagmx-integration', runId: 'pre-fix', hypothesisId: 'B', location: 'iagmx-atendimento/app/src/servidor.ts:onRequest', msg: '[DEBUG] atendimento request chegou no iagmx', data: { method: req.method, url: req.url, origin: req.headers.origin ?? null, acrMethod: req.headers['access-control-request-method'] ?? null, acrHeaders: req.headers['access-control-request-headers'] ?? null, hasAdminKey: Boolean(req.headers['x-iagmx-key']) }, ts: Date.now() }) }).catch(() => {});
    // #endregion
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    aplicarCors(reply, origin, null);
    return payload;
  });

  await app.register(fastifyStatic, {
    root: resolve(__dirname, '../public'),
    prefix: '/',
  });

  await app.register(rotasSaude);
  await app.register(rotasPainelAuth);
  await app.register(rotasAdmin);
  await app.register(rotasWebhook);
  await app.register(rotasPausa);
  await app.register(rotasDispararOferta);
  await app.register(rotasDebounceAdmin);
  await app.register(rotasWhatsapp);
  await app.register(rotasDiagnostico);
  await app.register(rotasAtendimento);
  await app.register(rotasPipelineAdmin);
  await app.register(rotasContatoProativo);
  await app.register(rotasMonitorTelefone);
  await app.register(rotasJornadasTeste);
  await app.register(rotasOcrDocumentos);

  /** Atalho /whatsapp → página de QR */
  app.get('/whatsapp', async (_req, reply) => {
    return reply.redirect('/phone?painel=whatsapp');
  });

  app.get('/pipeline', async (_req, reply) => {
    return reply.redirect('/phone?painel=simulador');
  });

  app.get('/jornadas', async (_req, reply) => {
    return reply.redirect('/phone?painel=journey');
  });

  app.get('/phone', async (_req, reply) => {
    return reply.redirect('/phone.html');
  });

  app.get<{ Params: { telefone: string } }>('/phone=:telefone', async (req, reply) => {
    return reply.redirect(`/phone.html?phone=${encodeURIComponent(req.params.telefone)}`);
  });

  return app;
}

export async function iniciarServidor() {
  const app = await criarServidor();
  await app.listen({ port: config.porta, host: '0.0.0.0' });
  console.log(`[servidor] Rodando na porta ${config.porta}`);
  return app;
}
