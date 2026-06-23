/**
 * Diagnóstico completo + logs recentes + testes automáticos.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { executarTestesUnidade } from '../testes/auto-teste.js';
import { obterLogsRecentes, contarLogsPorNivel } from '../util/log-eventos.js';
import { verificarRedis } from '../servicos/debounce.js';
import { verificarPostgres } from '../servicos/prompt.js';
import { verificarQdrant } from '../servicos/qdrant.js';
import { verificarEvolution } from '../servicos/evolution.js';
import { obterStatusConexao } from '../servicos/evolution-instancia.js';
import { validarTokens } from '../servicos/tokens.js';
import { validarDirectusToken, directusConfigurado } from '../servicos/directus.js';
import { contarPendentes } from '../servicos/fila-respostas.js';
import { statusDebounce } from '../servicos/debounce.js';
import { obterStatusPausa } from '../servicos/pausa.js';
import { transcreverAudio } from '../servicos/openai.js';
import { readFileSync, existsSync } from 'node:fs';

function verificarAdmin(req: { headers: Record<string, unknown> }): boolean {
  if (!config.adminKey) return true;
  return req.headers['x-iagmx-key'] === config.adminKey;
}

export async function rotasDiagnostico(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { logs?: string; categoria?: string } }>(
    '/api/diagnostico',
    async (req, reply) => {
      if (!verificarAdmin(req)) return reply.status(401).send({ erro: 'Não autorizado' });

      const testes = await executarTestesUnidade();
      const testesOk = testes.filter((t) => t.ok).length;

      const [redis, postgres, qdrant, evolution, tokens, whatsapp, pendentes, pausa, debounce] =
        await Promise.all([
          verificarRedis(),
          verificarPostgres(),
          verificarQdrant(),
          verificarEvolution(),
          validarTokens(),
          obterStatusConexao().catch(() => ({
            conectado: false,
            state: 'erro',
            instance: config.evolutionInstance,
          })),
          contarPendentes(),
          obterStatusPausa(),
          statusDebounce(),
        ]);

      let stt: { ok: boolean; texto?: string; erro?: string } = { ok: false };
      const wavPaths = ['/app/pt-test.wav', '/tmp/pt-test.wav'];
      for (const p of wavPaths) {
        if (!existsSync(p)) continue;
        try {
          const buf = readFileSync(p);
          const texto = await transcreverAudio(buf, 'audio/wav');
          stt = { ok: texto.length > 2, texto };
          break;
        } catch (e) {
          stt = { ok: false, erro: e instanceof Error ? e.message : String(e) };
        }
      }
      if (!stt.ok && !stt.erro) stt.erro = 'arquivo pt-test.wav não encontrado (STT não testado)';

      const directusToken = directusConfigurado() ? await validarDirectusToken() : false;

      const limiteLogs = parseInt(req.query.logs ?? '80', 10);
      const logs = obterLogsRecentes(limiteLogs, req.query.categoria);

      const falhasTeste = testes.filter((t) => !t.ok);
      const servicosOk = redis && postgres && tokens.provedorAtivo !== 'nenhum';

      return {
        status: servicosOk && falhasTeste.length === 0 ? 'ok' : 'degradado',
        timestamp: new Date().toISOString(),
        servicos: {
          redis,
          postgres,
          qdrant,
          evolution,
          openrouter: tokens.openrouter,
          claude: tokens.claude,
          openai: tokens.openai,
          groq: tokens.groq,
          provedorAtivo: tokens.provedorAtivo,
          openaiUtilidades: tokens.openaiUtilidades,
          directusToken,
          whatsapp,
        },
        pausa,
        filaRespostasPendentes: pendentes,
        debounceFilas: debounce,
        testes: {
          total: testes.length,
          ok: testesOk,
          falhas: falhasTeste,
          todos: testes,
        },
        stt,
        logs: {
          contagem: contarLogsPorNivel(),
          recentes: logs,
        },
      };
    },
  );

  app.get('/api/logs', async (req, reply) => {
    if (!verificarAdmin(req)) return reply.status(401).send({ erro: 'Não autorizado' });
    const q = req.query as { limite?: string; categoria?: string };
    return {
      contagem: contarLogsPorNivel(),
      eventos: obterLogsRecentes(parseInt(q.limite ?? '100', 10), q.categoria),
    };
  });
}
