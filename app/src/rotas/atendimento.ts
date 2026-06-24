/**
 * Estado de atendimento IA no ERP — consulta e flags para o portal GMX.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { normalizarTelefone } from '../util/telefone.js';
import { painelAdmin, painelAutenticado } from '../servicos/painel-acesso.js';
import {
  contatoPausado,
  contatoAtivadoIndividualmente,
  obterModoGlobalIa,
  iaPodeResponder,
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
      if (!exigirPainel(req)) {
        return reply.status(401).send({ erro: 'Não autenticado' });
      }
      const telefone = normalizarTelefone(req.params.telefone);
      const erp = await obterEstadoAtendimentoErp(telefone);
      const pausadoRedis = await contatoPausado(telefone);
      const ativadoContato = await contatoAtivadoIndividualmente(telefone);
      const modoGlobal = await obterModoGlobalIa();
      const podeResponder = await iaPodeResponder(telefone);
      const motivoPausa =
        pausadoRedis || Boolean(erp.estado.ia_pausada)
          ? erp.estado.ia_pausa_motivo
          : modoGlobal === 'default_off' && !ativadoContato
            ? 'desligada_por_padrao_global'
            : erp.estado.ia_pausa_motivo;
      return {
        telefone,
        motorista_id: erp.motoristaId,
        ia_pausada: !podeResponder,
        ia_pausa_motivo: motivoPausa,
        ia_modo_global: modoGlobal,
        ia_liberada_contato: ativadoContato,
        ia_ativa_efetiva: podeResponder,
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
      if (!exigirAdmin(req)) {
        return reply.status(403).send({ erro: 'Apenas admin pode pausar contato' });
      }
      const telefone = normalizarTelefone(req.params.telefone);
      const motivo = req.body?.motivo ?? 'pausado_pelo_erp';
      await pausarContato(telefone, motivo);
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
      if (!exigirAdmin(req)) {
        return reply.status(403).send({ erro: 'Apenas admin pode marcar este contato' });
      }
      const telefone = normalizarTelefone(req.params.telefone);
      const motivo = req.body?.motivo ?? 'solicitado_pelo_erp';
      await marcarPrecisaAtendimentoErp(telefone, motivo);
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
