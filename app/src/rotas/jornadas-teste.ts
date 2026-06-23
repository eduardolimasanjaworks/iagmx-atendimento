/**
 * Rotas admin das jornadas de teste.
 * Expoe listagem, CRUD do catalogo e disparo manual por telefone.
 * Mantem tudo na mesma API usada pelo painel atual.
 */
import type { FastifyInstance } from 'fastify';
import { painelAdmin } from '../servicos/painel-acesso.js';
import {
  iniciarJornadaTeste,
} from '../servicos/jornadas-teste.js';
import {
  criarJornadaTesteCatalogo,
  atualizarJornadaTesteCatalogo,
  listarJornadasTesteAtivas,
  obterCatalogoJornadasTesteMeta,
  removerJornadaTesteCatalogo,
  type JornadaTesteDefinicao,
} from '../servicos/catalogo-jornadas-teste.js';

function exigirAdmin(
  req: Parameters<typeof painelAdmin>[0],
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (painelAdmin(req)) return true;
  reply.status(403).send({ erro: 'Apenas admin pode usar esta acao' });
  return false;
}

interface BodyIniciarJornada {
  telefone?: string;
  jornadaId?: string;
  nomeMotorista?: string;
  mensagemInicial?: string;
  resetarHistorico?: boolean;
  marcarComoTeste?: boolean;
}

export async function rotasJornadasTeste(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/jornadas-teste', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const meta = await obterCatalogoJornadasTesteMeta();
    return {
      ok: true,
      jornadas: await listarJornadasTesteAtivas(),
      catalogo: meta.jornadas,
      atualizadoEm: meta.atualizadoEm,
      observacaoCampoTeste:
        'O Directus atual nao possui campo dedicado de teste em cadastro_motorista, entao a marcacao fica padronizada em observacao',
    };
  });

  app.post<{ Body: JornadaTesteDefinicao }>('/api/admin/jornadas-teste/catalogo', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    try {
      return {
        ok: true,
        catalogo: await criarJornadaTesteCatalogo(req.body),
        mensagem: 'Jornada criada com sucesso',
      };
    } catch (error) {
      return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao criar jornada' });
    }
  });

  app.put<{ Params: { id: string }; Body: JornadaTesteDefinicao }>(
    '/api/admin/jornadas-teste/catalogo/:id',
    async (req, reply) => {
      if (!exigirAdmin(req, reply)) return;
      try {
        return {
          ok: true,
          catalogo: await atualizarJornadaTesteCatalogo(req.params.id, req.body),
          mensagem: 'Jornada salva com sucesso',
        };
      } catch (error) {
        return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao salvar jornada' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/admin/jornadas-teste/catalogo/:id', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    try {
      return {
        ok: true,
        catalogo: await removerJornadaTesteCatalogo(req.params.id),
        mensagem: 'Jornada removida com sucesso',
      };
    } catch (error) {
      return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao remover jornada' });
    }
  });

  app.post<{ Body: BodyIniciarJornada }>(
    '/api/admin/jornadas-teste/iniciar',
    async (req, reply) => {
      if (!exigirAdmin(req, reply)) return;
      const body = req.body ?? {};
      if (!body.telefone) {
        return reply.status(400).send({ erro: 'telefone e obrigatorio' });
      }
      if (!body.jornadaId) {
        return reply.status(400).send({ erro: 'jornadaId e obrigatorio' });
      }

      try {
        const resultado = await iniciarJornadaTeste({
          telefone: body.telefone,
          jornadaId: body.jornadaId,
          nomeMotorista: body.nomeMotorista,
          mensagemInicial: body.mensagemInicial,
          resetarHistorico: body.resetarHistorico !== false,
          marcarComoTeste: body.marcarComoTeste !== false,
        });

        if (!resultado.enviado) {
          return reply.status(503).send({
            ok: false,
            erro: 'Nao foi possivel enviar a mensagem inicial no WhatsApp',
            resultado,
          });
        }

        return {
          ok: true,
          resultado,
          mensagem:
            'Jornada iniciada com envio real, historico salvo e contexto ERP pronto para a proxima resposta',
        };
      } catch (error) {
        return reply.status(400).send({
          erro: error instanceof Error ? error.message : 'Falha ao iniciar jornada de teste',
        });
      }
    },
  );
}
