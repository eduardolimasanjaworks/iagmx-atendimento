/**
 * Endpoints para pausar/despausar a IA (global ou por telefone).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  pausarGlobal,
  despausarGlobal,
  pausarContato,
  despausarContato,
  obterStatusPausa,
} from '../servicos/pausa.js';
import { painelAdmin, painelAutenticado } from '../servicos/painel-acesso.js';
import { normalizarTelefone } from '../util/telefone.js';

function verificarLeitura(req: FastifyRequest): boolean {
  return painelAutenticado(req);
}

function verificarAdmin(req: FastifyRequest): boolean {
  return painelAdmin(req);
}

export async function rotasPausa(app: FastifyInstance): Promise<void> {
  app.get('/api/pausa', async (req, reply) => {
    if (!verificarLeitura(req)) {
      return reply.status(401).send({ erro: 'Não autorizado' });
    }
    return obterStatusPausa();
  });

  app.post<{ Body: { motivo?: string } }>('/api/pausa/global', async (req, reply) => {
    if (!verificarAdmin(req)) {
      return reply.status(401).send({ erro: 'Não autorizado' });
    }
    await pausarGlobal(req.body?.motivo);
    return { ok: true, global: true };
  });

  app.delete('/api/pausa/global', async (req, reply) => {
    if (!verificarAdmin(req)) {
      return reply.status(401).send({ erro: 'Não autorizado' });
    }
    await despausarGlobal();
    return { ok: true, global: false };
  });

  app.post<{ Body: { telefone?: string; motivo?: string } }>(
    '/api/pausa/contato',
    async (req, reply) => {
      if (!verificarAdmin(req)) {
        return reply.status(401).send({ erro: 'Não autorizado' });
      }
      const telefone = req.body?.telefone;
      if (!telefone) {
        return reply.status(400).send({ erro: 'Campo telefone obrigatório' });
      }
      await pausarContato(normalizarTelefone(telefone), req.body?.motivo);
      return { ok: true, telefone: normalizarTelefone(telefone), pausado: true };
    },
  );

  app.delete<{ Body: { telefone?: string } }>('/api/pausa/contato', async (req, reply) => {
    if (!verificarAdmin(req)) {
      return reply.status(401).send({ erro: 'Não autorizado' });
    }
    const telefone = req.body?.telefone;
    if (!telefone) {
      return reply.status(400).send({ erro: 'Campo telefone obrigatório' });
    }
    await despausarContato(normalizarTelefone(telefone));
    return { ok: true, telefone: normalizarTelefone(telefone), pausado: false };
  });
}
