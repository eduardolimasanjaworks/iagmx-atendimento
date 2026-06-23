/**
 * API do pipeline visível — etapas de geração de resposta.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import {
  listarTracesRecentes,
  obterTrace,
} from '../servicos/trace-pipeline.js';
import {
  gerarAutoavaliacaoConversas,
  obterUltimaAutoavaliacaoConversas,
} from '../servicos/autoavaliacao-conversas.js';
import { painelAdmin, painelPodeVer } from '../servicos/painel-acesso.js';

async function exigirLeituraPainel(
  req: Parameters<typeof painelAdmin>[0],
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (painelAdmin(req)) return true;
  if (await painelPodeVer(req, 'painel_etapas')) return true;
  reply.status(403).send({ erro: 'Seu login nao pode acessar esta area' });
  return false;
}

export async function rotasPipelineAdmin(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limite?: string } }>(
    '/api/pipeline/traces',
    async (req, reply) => {
      if (!(await exigirLeituraPainel(req, reply))) return;
      const limite = Math.min(50, parseInt(req.query.limite ?? '25', 10));
      const traces = await listarTracesRecentes(limite);
      return {
        build: config.buildId,
        total: traces.length,
        traces,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/pipeline/traces/:id',
    async (req, reply) => {
      if (!(await exigirLeituraPainel(req, reply))) return;
      const trace = await obterTrace(req.params.id);
      if (!trace) return reply.status(404).send({ erro: 'Trace não encontrado' });
      return trace;
    },
  );

  app.get<{ Querystring: { atualizar?: string } }>(
    '/api/pipeline/autoavaliacao',
    async (req, reply) => {
      if (!(await exigirLeituraPainel(req, reply))) return;
      const atualizar = req.query.atualizar === '1';
      const relatorio =
        (atualizar
          ? await gerarAutoavaliacaoConversas()
          : await obterUltimaAutoavaliacaoConversas()) ?? (await gerarAutoavaliacaoConversas());
      return {
        build: config.buildId,
        relatorio,
      };
    },
  );
}
