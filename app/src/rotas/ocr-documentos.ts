/**
 * Rotas admin do esquema OCR.
 * Permite editar documentos, campos e mapeamento para o Directus.
 * Reusa o painel atual para evitar telas paralelas.
 */
import type { FastifyInstance } from 'fastify';
import { painelAdmin } from '../servicos/painel-acesso.js';
import {
  atualizarOcrDocumento,
  criarOcrDocumento,
  obterOcrDocumentosMeta,
  removerOcrDocumento,
  type OcrDocumentoConfig,
} from '../servicos/config-ocr-documentos.js';

function exigirAdmin(
  req: Parameters<typeof painelAdmin>[0],
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (painelAdmin(req)) return true;
  reply.status(403).send({ erro: 'Apenas admin pode usar esta acao' });
  return false;
}

export async function rotasOcrDocumentos(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/ocr-documentos', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const meta = await obterOcrDocumentosMeta();
    return { ok: true, ...meta };
  });

  app.post<{ Body: OcrDocumentoConfig }>('/api/admin/ocr-documentos', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    try {
      return {
        ok: true,
        documentos: await criarOcrDocumento(req.body),
        mensagem: 'Documento OCR criado com sucesso',
      };
    } catch (error) {
      return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao criar documento OCR' });
    }
  });

  app.put<{ Params: { id: string }; Body: OcrDocumentoConfig }>(
    '/api/admin/ocr-documentos/:id',
    async (req, reply) => {
      if (!exigirAdmin(req, reply)) return;
      try {
        return {
          ok: true,
          documentos: await atualizarOcrDocumento(req.params.id, req.body),
          mensagem: 'Documento OCR salvo com sucesso',
        };
      } catch (error) {
        return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao salvar documento OCR' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/admin/ocr-documentos/:id', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    try {
      return {
        ok: true,
        documentos: await removerOcrDocumento(req.params.id),
        mensagem: 'Documento OCR removido com sucesso',
      };
    } catch (error) {
      return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao remover documento OCR' });
    }
  });
}
