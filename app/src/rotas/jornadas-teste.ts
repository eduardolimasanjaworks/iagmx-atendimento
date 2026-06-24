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
import { obterConfigMensagensFluxo } from '../servicos/config-mensagens-fluxo.js';
import { montarMensagemOferta } from '../servicos/oferta-disparo.js';
import { buscarConfigRota, listarConfigRotasAtivas } from '../servicos/rotas-gmx.js';

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
  configRotaId?: string | number;
  valorOfertado?: string | number;
  resetarHistorico?: boolean;
  marcarComoTeste?: boolean;
}

interface BodyPreviewOferta {
  configRotaId?: string | number;
  valorOfertado?: string | number;
}

function resumirRotaOferta(rota: Awaited<ReturnType<typeof listarConfigRotasAtivas>>[number]) {
  return {
    id: rota.id,
    origem: rota.origem,
    destino: rota.destino,
    operacao: rota.operacao ?? '',
    valor_minimo: Number(rota.valor_minimo),
    valor_maximo: Number(rota.valor_maximo),
  };
}

async function montarOfertaSelecionada(configRotaId?: string | number, valorOfertado?: string | number) {
  const rota = await buscarConfigRota({ id: configRotaId ?? null });
  if (!rota) throw new Error('Rota selecionada nao foi encontrada em config_rotas');
  const mensagens = await obterConfigMensagensFluxo();
  const valor = Number.isFinite(Number(valorOfertado)) ? Number(valorOfertado) : Number(rota.valor_minimo);
  return {
    rota,
    valor,
    mensagem: montarMensagemOferta(
      {
        origem: rota.origem,
        destino: rota.destino,
        operacao: rota.operacao,
        valorOfertado: valor,
      },
      mensagens.oferta_proativa_template,
    ),
  };
}

export async function rotasJornadasTeste(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/jornadas-teste', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const meta = await obterCatalogoJornadasTesteMeta();
    const rotasOferta = await listarConfigRotasAtivas();
    return {
      ok: true,
      jornadas: await listarJornadasTesteAtivas(),
      rotasOferta: rotasOferta.map(resumirRotaOferta),
      catalogo: meta.jornadas,
      atualizadoEm: meta.atualizadoEm,
      observacaoCampoTeste:
        'O Directus atual nao possui campo dedicado de teste em cadastro_motorista, entao a marcacao fica padronizada em observacao',
    };
  });

  app.post<{ Body: BodyPreviewOferta }>('/api/admin/jornadas-teste/oferta-preview', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    try {
      const oferta = await montarOfertaSelecionada(req.body?.configRotaId, req.body?.valorOfertado);
      return {
        ok: true,
        rota: resumirRotaOferta(oferta.rota),
        valorOfertado: oferta.valor,
        mensagem: oferta.mensagem,
      };
    } catch (error) {
      return reply.status(400).send({
        erro: error instanceof Error ? error.message : 'Falha ao montar a oferta selecionada',
      });
    }
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
        const mensagemInicial =
          body.jornadaId === 'cenario_5_oferta' && body.configRotaId
            ? (await montarOfertaSelecionada(body.configRotaId, body.valorOfertado)).mensagem
            : body.mensagemInicial;
        const resultado = await iniciarJornadaTeste({
          telefone: body.telefone,
          jornadaId: body.jornadaId,
          nomeMotorista: body.nomeMotorista,
          mensagemInicial,
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
