/**
 * Rotas admin para consultar e sincronizar o atributo `ia_controle`.
 * Usa a sessao do painel ou a chave admin para autorizacao.
 * Mantem o sync por contato explicito e auditavel.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { painelAdmin } from '../servicos/painel-acesso.js';
import {
  obterStatusIaControleContato,
  sincronizarPausaContatoViaChatwoot,
} from '../servicos/chatwoot-ia-controle.js';

function verificarAdmin(req: FastifyRequest): boolean {
  return painelAdmin(req);
}

export async function rotasChatwootIaControle(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { telefone: string } }>('/api/chatwoot/ia-controle/contato/:telefone', async (req, reply) => {
    if (!verificarAdmin(req)) {
      return reply.status(401).send({ erro: 'Não autenticado' });
    }

    try {
      const data = await obterStatusIaControleContato(req.params.telefone);
      return {
        ok: true,
        fonte: 'chatwoot',
        ...data,
      };
    } catch (error) {
      return reply.status(503).send({
        ok: false,
        erro: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post<{ Params: { telefone: string } }>(
    '/api/chatwoot/ia-controle/contato/:telefone/sincronizar',
    async (req, reply) => {
      if (!verificarAdmin(req)) {
        return reply.status(401).send({ erro: 'Não autenticado' });
      }

      try {
        const data = await sincronizarPausaContatoViaChatwoot(req.params.telefone);
        return {
          ok: true,
          fonte: 'chatwoot_para_pausa_local',
          ...data,
        };
      } catch (error) {
        return reply.status(503).send({
          ok: false,
          erro: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}
