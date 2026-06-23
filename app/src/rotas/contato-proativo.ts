import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import {
  adiarContatoProativo,
  adiarItensContatoProativo,
  aprovarItensContatoProativo,
  atualizarStatusContatoProativo,
  dispararContatosProativoEmLote,
  dispararContatoProativo,
  gerarLoteContatoProativo,
  listarHistoricoContatoProativo,
  obterLoteContatoProativoAtual,
} from '../servicos/contato-proativo.js';

function verificarAdmin(req: FastifyRequest): boolean {
  if (!config.adminKey) return true;
  return req.headers['x-iagmx-key'] === config.adminKey;
}

export async function rotasContatoProativo(app: FastifyInstance): Promise<void> {
  app.get('/api/contato-proativo/lote-atual', async (req, reply) => {
    if (!verificarAdmin(req)) {
      return reply.status(401).send({ erro: 'Não autorizado' });
    }
    const data = await obterLoteContatoProativoAtual();
    return { ok: true, ...data };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/contato-proativo/historico', async (req, reply) => {
    if (!verificarAdmin(req)) {
      return reply.status(401).send({ erro: 'Não autorizado' });
    }
    const itens = await listarHistoricoContatoProativo(Number(req.query?.limit ?? 100));
    return { ok: true, itens };
  });

  app.post('/api/contato-proativo/gerar', async (req, reply) => {
    if (!verificarAdmin(req)) {
      return reply.status(401).send({ erro: 'Não autorizado' });
    }
    const data = await gerarLoteContatoProativo({ force: true });
    return { ok: true, ...data };
  });

  app.post<{ Params: { id: string }; Body: { autor?: string; observacao?: string } }>(
    '/api/contato-proativo/item/:id/aprovar',
    async (req, reply) => {
      if (!verificarAdmin(req)) {
        return reply.status(401).send({ erro: 'Não autorizado' });
      }
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return reply.status(400).send({ erro: 'id inválido' });
      }
      const item = await atualizarStatusContatoProativo(
        id,
        'aprovado',
        req.body?.autor ?? 'portal',
        req.body?.observacao,
      );
      return { ok: true, item };
    },
  );

  app.post<{ Params: { id: string }; Body: { autor?: string; dias?: number; observacao?: string } }>(
    '/api/contato-proativo/item/:id/adiar',
    async (req, reply) => {
      if (!verificarAdmin(req)) {
        return reply.status(401).send({ erro: 'Não autorizado' });
      }
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return reply.status(400).send({ erro: 'id inválido' });
      }
      const dias = Math.max(1, Math.round(Number(req.body?.dias ?? 3)));
      const item = await adiarContatoProativo(
        id,
        dias,
        req.body?.autor ?? 'portal',
        req.body?.observacao,
      );
      return { ok: true, item };
    },
  );

  app.post<{ Params: { id: string }; Body: { autor?: string; observacao?: string } }>(
    '/api/contato-proativo/item/:id/rejeitar',
    async (req, reply) => {
      if (!verificarAdmin(req)) {
        return reply.status(401).send({ erro: 'Não autorizado' });
      }
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return reply.status(400).send({ erro: 'id inválido' });
      }
      const item = await atualizarStatusContatoProativo(
        id,
        'rejeitado',
        req.body?.autor ?? 'portal',
        req.body?.observacao,
      );
      return { ok: true, item };
    },
  );

  app.post<{ Params: { id: string }; Body: { autor?: string } }>(
    '/api/contato-proativo/item/:id/disparar',
    async (req, reply) => {
      if (!verificarAdmin(req)) {
        return reply.status(401).send({ erro: 'Não autorizado' });
      }
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return reply.status(400).send({ erro: 'id inválido' });
      }
      const resultado = await dispararContatoProativo(id, req.body?.autor ?? 'portal');
      return { ok: resultado.enviado, ...resultado };
    },
  );

  app.post<{ Body: { item_ids?: number[]; autor?: string } }>(
    '/api/contato-proativo/lote/aprovar',
    async (req, reply) => {
      if (!verificarAdmin(req)) {
        return reply.status(401).send({ erro: 'Não autorizado' });
      }
      const itemIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map(Number) : [];
      if (!itemIds.length) {
        return reply.status(400).send({ erro: 'item_ids é obrigatório' });
      }
      const itens = await aprovarItensContatoProativo(itemIds, req.body?.autor ?? 'portal');
      return { ok: true, itens };
    },
  );

  app.post<{ Body: { item_ids?: number[]; autor?: string; dias?: number; observacao?: string } }>(
    '/api/contato-proativo/lote/adiar',
    async (req, reply) => {
      if (!verificarAdmin(req)) {
        return reply.status(401).send({ erro: 'Não autorizado' });
      }
      const itemIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map(Number) : [];
      if (!itemIds.length) {
        return reply.status(400).send({ erro: 'item_ids é obrigatório' });
      }
      const dias = Math.max(1, Math.round(Number(req.body?.dias ?? 3)));
      const itens = await adiarItensContatoProativo(
        itemIds,
        dias,
        req.body?.autor ?? 'portal',
        req.body?.observacao,
      );
      return { ok: true, itens };
    },
  );

  app.post<{ Body: { item_ids?: number[]; autor?: string; intervalo_ms?: number } }>(
    '/api/contato-proativo/lote/disparar',
    async (req, reply) => {
      if (!verificarAdmin(req)) {
        return reply.status(401).send({ erro: 'Não autorizado' });
      }
      const itemIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map(Number) : [];
      if (!itemIds.length) {
        return reply.status(400).send({ erro: 'item_ids é obrigatório' });
      }
      const resultado = await dispararContatosProativoEmLote({
        itemIds,
        autor: req.body?.autor ?? 'portal',
        intervaloMs: Number(req.body?.intervalo_ms ?? 60_000),
      });
      return { ok: resultado.falhas.length === 0, ...resultado };
    },
  );
}
