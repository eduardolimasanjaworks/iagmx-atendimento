/**
 * Estado de atendimento IA no ERP — consulta e flags para o portal GMX.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { normalizarTelefone } from '../util/telefone.js';
import { painelAdmin, painelAutenticado } from '../servicos/painel-acesso.js';
import {
  contatoPausado,
  pausarContato,
  despausarContato,
} from '../servicos/pausa.js';
import {
  limparPrecisaAtendimentoErp,
  marcarPrecisaAtendimentoErp,
  obterEstadoAtendimentoErp,
} from '../servicos/erp-atendimento-motorista.js';

function exigirPainel(req: FastifyRequest): boolean {
  return painelAutenticado(req);
}

function exigirAdmin(req: FastifyRequest): boolean {
  return painelAdmin(req);
}

export async function rotasAtendimento(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { telefone: string } }>(
    '/api/atendimento/contato/:telefone',
    async (req, reply) => {
      // #region debug-point C:atendimento-get-entry
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'gmx-iagmx-integration', runId: 'pre-fix', hypothesisId: 'C', location: 'iagmx-atendimento/app/src/rotas/atendimento.ts:get', msg: '[DEBUG] handler GET atendimento iniciou', data: { telefoneRaw: req.params.telefone, origin: req.headers.origin ?? null, hasAdminKey: Boolean(req.headers['x-iagmx-key']) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      if (!exigirPainel(req)) {
        // #region debug-point C:atendimento-get-unauthorized
        fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'gmx-iagmx-integration', runId: 'pre-fix', hypothesisId: 'C', location: 'iagmx-atendimento/app/src/rotas/atendimento.ts:get', msg: '[DEBUG] atendimento GET bloqueado por auth admin', data: { telefoneRaw: req.params.telefone }, ts: Date.now() }) }).catch(() => {});
        // #endregion
        return reply.status(401).send({ erro: 'Não autenticado' });
      }
      const telefone = normalizarTelefone(req.params.telefone);
      const erp = await obterEstadoAtendimentoErp(telefone);
      const pausadoRedis = await contatoPausado(telefone);
      // #region debug-point E:atendimento-get-state
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'gmx-iagmx-integration', runId: 'pre-fix', hypothesisId: 'E', location: 'iagmx-atendimento/app/src/rotas/atendimento.ts:get', msg: '[DEBUG] atendimento GET retornando estado ERP+redis', data: { telefone, motoristaId: erp.motoristaId, pausadoRedis, iaPausadaErp: Boolean(erp.estado.ia_pausada), precisaAtendimento: Boolean(erp.estado.precisa_atendimento), ultimaIntencao: erp.estado.ultima_intencao_whatsapp ?? null }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      return {
        telefone,
        motorista_id: erp.motoristaId,
        ia_pausada: pausadoRedis || Boolean(erp.estado.ia_pausada),
        ia_pausa_motivo: erp.estado.ia_pausa_motivo,
        precisa_atendimento: Boolean(erp.estado.precisa_atendimento),
        precisa_atendimento_motivo: erp.estado.precisa_atendimento_motivo,
        ultima_intencao_whatsapp: erp.estado.ultima_intencao_whatsapp,
        ultima_intencao_em: erp.estado.ultima_intencao_em,
      };
    },
  );

  app.post<{ Params: { telefone: string }; Body: { motivo?: string } }>(
    '/api/atendimento/contato/:telefone/pausar',
    async (req, reply) => {
      // #region debug-point C:atendimento-pausar-entry
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'gmx-iagmx-integration', runId: 'pre-fix', hypothesisId: 'C', location: 'iagmx-atendimento/app/src/rotas/atendimento.ts:post-pausar', msg: '[DEBUG] handler POST pausar iniciou', data: { telefoneRaw: req.params.telefone, motivo: req.body?.motivo ?? null, origin: req.headers.origin ?? null, hasAdminKey: Boolean(req.headers['x-iagmx-key']) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      if (!exigirAdmin(req)) {
        return reply.status(403).send({ erro: 'Apenas admin pode pausar contato' });
      }
      const telefone = normalizarTelefone(req.params.telefone);
      const motivo = req.body?.motivo ?? 'pausado_pelo_erp';
      await pausarContato(telefone, motivo);
      // #region debug-point E:atendimento-pausar-ok
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'gmx-iagmx-integration', runId: 'pre-fix', hypothesisId: 'E', location: 'iagmx-atendimento/app/src/rotas/atendimento.ts:post-pausar', msg: '[DEBUG] contato pausado no iagmx', data: { telefone, motivo }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      return { ok: true, telefone, ia_pausada: true };
    },
  );

  app.delete<{ Params: { telefone: string } }>(
    '/api/atendimento/contato/:telefone/pausar',
    async (req, reply) => {
      if (!exigirAdmin(req)) {
        return reply.status(403).send({ erro: 'Apenas admin pode retomar contato' });
      }
      const telefone = normalizarTelefone(req.params.telefone);
      await despausarContato(telefone);
      return { ok: true, telefone, ia_pausada: false };
    },
  );

  app.post<{ Params: { telefone: string }; Body: { motivo?: string } }>(
    '/api/atendimento/contato/:telefone/precisa',
    async (req, reply) => {
      // #region debug-point C:atendimento-precisa-entry
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'gmx-iagmx-integration', runId: 'pre-fix', hypothesisId: 'C', location: 'iagmx-atendimento/app/src/rotas/atendimento.ts:post-precisa', msg: '[DEBUG] handler POST precisa iniciou', data: { telefoneRaw: req.params.telefone, motivo: req.body?.motivo ?? null, origin: req.headers.origin ?? null, hasAdminKey: Boolean(req.headers['x-iagmx-key']) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      if (!exigirAdmin(req)) {
        return reply.status(403).send({ erro: 'Apenas admin pode marcar este contato' });
      }
      const telefone = normalizarTelefone(req.params.telefone);
      const motivo = req.body?.motivo ?? 'solicitado_pelo_erp';
      await marcarPrecisaAtendimentoErp(telefone, motivo);
      // #region debug-point E:atendimento-precisa-ok
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'gmx-iagmx-integration', runId: 'pre-fix', hypothesisId: 'E', location: 'iagmx-atendimento/app/src/rotas/atendimento.ts:post-precisa', msg: '[DEBUG] contato marcado precisa atendimento', data: { telefone, motivo }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      return { ok: true, telefone, precisa_atendimento: true };
    },
  );

  app.delete<{ Params: { telefone: string } }>(
    '/api/atendimento/contato/:telefone/precisa',
    async (req, reply) => {
      if (!exigirAdmin(req)) {
        return reply.status(403).send({ erro: 'Apenas admin pode limpar esta marcação' });
      }
      const telefone = normalizarTelefone(req.params.telefone);
      await limparPrecisaAtendimentoErp(telefone);
      return { ok: true, telefone, precisa_atendimento: false };
    },
  );
}
