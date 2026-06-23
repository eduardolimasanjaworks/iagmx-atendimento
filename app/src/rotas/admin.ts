/**
 * Rotas de administração: prompts e configurações editáveis.
 * Painel interno — leitura e gravação abertas (proteção via rede/nginx).
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { obterPromptMeta, salvarPrompt } from '../servicos/prompt.js';
import {
  obterConfigHumanizacao,
  salvarConfigHumanizacao,
  HUMANIZACAO_PADRAO,
} from '../servicos/config-humanizacao.js';
import {
  obterPromptOcrMeta,
  salvarPromptOcr,
  salvarPromptOcrForcado,
  OCR_PADRAO,
  OCR_PROMPT_FORCADO,
} from '../servicos/config-ocr.js';
import {
  obterConfigTempo,
  salvarConfigTempo,
  TEMPO_PADRAO,
} from '../servicos/config-tempo.js';
import {
  obterConfigOrquestracaoTextoMeta,
  salvarConfigOrquestracaoTexto,
  ORQUESTRACAO_TEXTO_PADRAO,
} from '../servicos/config-orquestracao-texto.js';
import {
  obterConfigMensagensFluxoMeta,
  salvarConfigMensagensFluxo,
  MENSAGENS_FLUXO_PADRAO,
} from '../servicos/config-mensagens-fluxo.js';
import { listarHistoricoConfiguracao } from '../servicos/historico-configuracao.js';
import {
  aprovarPendenciaAprendizadoWhatsapp,
  atualizarTelefoneTreinador,
  cancelarPendenciaAprendizadoWhatsapp,
  criarTelefoneTreinador,
  excluirAprendizadoWhatsapp,
  excluirTelefoneTreinador,
  listarAprendizadosWhatsapp,
  listarPendenciasAprendizadoWhatsapp,
  listarTelefonesTreinadores,
} from '../servicos/treinamento-whatsapp.js';
import { resumirHistoricoNominalOfertasPorEmbarque } from '../servicos/historico-ofertas-gmx.js';
import type { BlocoEquipe } from '../servicos/config-painel-equipe.js';
import { painelAdmin, painelAutenticado, painelPodeVer } from '../servicos/painel-acesso.js';
import { resetarContatoTeste } from '../servicos/reset-contato-teste.js';
import {
  aplicarInstrucaoTreinamentoDireto,
  criarPropostaTreinamentoDireto,
} from '../servicos/treinamento-admin-direto.js';

function exigirPainel(req: Parameters<typeof painelAutenticado>[0], reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (painelAutenticado(req)) return true;
  reply.status(401).send({ erro: 'Não autenticado' });
  return false;
}

function exigirAdmin(req: Parameters<typeof painelAdmin>[0], reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (painelAdmin(req)) return true;
  reply.status(403).send({ erro: 'Apenas admin pode usar esta ação' });
  return false;
}

async function exigirLeituraBloco(
  req: Parameters<typeof painelAdmin>[0],
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  bloco: BlocoEquipe,
  blocosAlternativos: BlocoEquipe[] = [],
) {
  if (!exigirPainel(req, reply)) return false;
  if (painelAdmin(req)) return true;
  for (const item of [bloco, ...blocosAlternativos]) {
    if (await painelPodeVer(req, item)) return true;
  }
  reply.status(403).send({ erro: 'Seu login nao pode acessar este bloco' });
  return false;
}

export async function rotasAdmin(app: FastifyInstance): Promise<void> {
  app.get('/api/prompt', async (req, reply) => {
    if (!(await exigirLeituraBloco(req, reply, 'prompt_principal', ['editor_visual']))) return;
    return obterPromptMeta();
  });

  app.put<{ Body: { prompt?: string } }>('/api/prompt', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const { prompt } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      return reply.status(400).send({ erro: 'Prompt deve ter pelo menos 10 caracteres.' });
    }
    const { qdrantOk } = await salvarPrompt(prompt.trim());
    return {
      ok: true,
      mensagem: qdrantOk
        ? 'Prompt salvo e contexto auxiliar atualizado.'
        : 'Prompt salvo, mas a atualizacao do contexto auxiliar falhou e pode demorar para refletir por completo.',
      qdrantOk,
    };
  });

  app.get('/api/config/ocr', async (req, reply) => {
    if (!(await exigirLeituraBloco(req, reply, 'prompt_ocr', ['editor_visual']))) return;
    const meta = await obterPromptOcrMeta();
    return { ...meta, padrao: OCR_PADRAO, padraoForcado: OCR_PROMPT_FORCADO };
  });

  app.put<{ Body: { prompt?: string; promptForcado?: string } }>('/api/config/ocr', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const { prompt, promptForcado } = req.body ?? {};
    if (
      prompt !== undefined &&
      (typeof prompt !== 'string' || prompt.trim().length < 20)
    ) {
      return reply.status(400).send({ erro: 'Prompt OCR deve ter pelo menos 20 caracteres.' });
    }
    if (
      promptForcado !== undefined &&
      (typeof promptForcado !== 'string' || promptForcado.trim().length < 20)
    ) {
      return reply
        .status(400)
        .send({ erro: 'Prompt OCR forçado deve ter pelo menos 20 caracteres.' });
    }

    const salvo = prompt !== undefined ? await salvarPromptOcr(prompt.trim()) : undefined;
    const salvoForcado =
      promptForcado !== undefined ? await salvarPromptOcrForcado(promptForcado.trim()) : undefined;
    return {
      ok: true,
      prompt: salvo,
      promptForcado: salvoForcado,
      mensagem: 'Configuração OCR salva.',
    };
  });

  app.get('/api/config/envio', async (req, reply) => {
    if (!(await exigirLeituraBloco(req, reply, 'operacao_avancada', ['editor_visual']))) return;
    const cfg = await obterConfigHumanizacao();
    return { config: cfg, padrao: HUMANIZACAO_PADRAO };
  });

  app.put<{ Body: Partial<typeof HUMANIZACAO_PADRAO> }>('/api/config/envio', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const body = req.body ?? {};
    const nums = ['delayMinMs', 'delayMaxMs', 'digitandoMinMs', 'digitandoMaxMs'] as const;
    for (const k of nums) {
      if (body[k] !== undefined && (typeof body[k] !== 'number' || body[k] < 0)) {
        return reply.status(400).send({ erro: `${k} deve ser número >= 0` });
      }
    }
    const atual = await obterConfigHumanizacao();
    const salvo = await salvarConfigHumanizacao({ ...atual, ...body });
    return { ok: true, config: salvo };
  });

  app.get('/api/config/tempo', async (req, reply) => {
    if (!(await exigirLeituraBloco(req, reply, 'operacao_avancada', ['editor_visual']))) return;
    const cfg = await obterConfigTempo();
    return { config: cfg, padrao: TEMPO_PADRAO, build: config.buildId };
  });

  app.put<{ Body: Partial<typeof TEMPO_PADRAO> }>('/api/config/tempo', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const body = req.body ?? {};
    for (const k of ['debounceMs', 'debounceWorkerMs'] as const) {
      if (body[k] !== undefined && (typeof body[k] !== 'number' || body[k] < 0)) {
        return reply.status(400).send({ erro: `${k} deve ser número >= 0` });
      }
    }
    const salvo = await salvarConfigTempo(body);
    return { ok: true, config: salvo, mensagem: 'Tempos atualizados — efeito imediato.' };
  });

  app.get('/api/config/orquestracao-texto', async (req, reply) => {
    if (!(await exigirLeituraBloco(req, reply, 'estilo_formatacao', ['editor_visual']))) return;
    return obterConfigOrquestracaoTextoMeta();
  });

  app.put<{ Body: Partial<typeof ORQUESTRACAO_TEXTO_PADRAO> }>(
    '/api/config/orquestracao-texto',
    async (req, reply) => {
      if (!exigirAdmin(req, reply)) return;
      const body = req.body ?? {};
      if (
        body.camadaHumana !== undefined &&
        (typeof body.camadaHumana !== 'string' || body.camadaHumana.trim().length < 40)
      ) {
        return reply
          .status(400)
          .send({ erro: 'camadaHumana deve ter pelo menos 40 caracteres.' });
      }
      if (
        body.instrucaoFormatacao !== undefined &&
        (typeof body.instrucaoFormatacao !== 'string' ||
          body.instrucaoFormatacao.trim().length < 20)
      ) {
        return reply
          .status(400)
          .send({ erro: 'instrucaoFormatacao deve ter pelo menos 20 caracteres.' });
      }

      const salvo = await salvarConfigOrquestracaoTexto(body);
      return {
        ok: true,
        config: salvo,
        mensagem: 'Textos de orquestração atualizados com efeito imediato.',
      };
    },
  );

  app.get('/api/config/mensagens-fluxo', async (req, reply) => {
    if (!(await exigirLeituraBloco(req, reply, 'mensagens_fluxo', ['editor_visual']))) return;
    return obterConfigMensagensFluxoMeta();
  });

  app.put<{ Body: Partial<typeof MENSAGENS_FLUXO_PADRAO> }>(
    '/api/config/mensagens-fluxo',
    async (req, reply) => {
      if (!exigirAdmin(req, reply)) return;
      const body = req.body ?? {};
      for (const [key, value] of Object.entries(body)) {
        if (Array.isArray(value)) {
          if (!value.every((item) => typeof item === 'string' && item.trim().length >= 3)) {
            return reply.status(400).send({ erro: `${key} precisa ser uma lista de textos válidos` });
          }
          continue;
        }
        if (typeof value !== 'string' || value.trim().length < 3) {
          return reply.status(400).send({ erro: `${key} deve ter pelo menos 3 caracteres.` });
        }
      }
      const salvo = await salvarConfigMensagensFluxo(body);
      return { ok: true, config: salvo, mensagem: 'Mensagens de fluxo atualizadas.' };
    },
  );

  app.get<{ Querystring: { limite?: string } }>('/api/config/historico', async (req, reply) => {
    if (!(await exigirLeituraBloco(req, reply, 'editor_visual'))) return;
    const limite = Math.min(Math.max(Number(req.query?.limite ?? 20) || 20, 1), 100);
    return { itens: await listarHistoricoConfiguracao(limite) };
  });

  app.post('/api/admin/reload-processo', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    void reply.send({ ok: true, mensagem: 'Reiniciando processo em 300ms', build: config.buildId });
    setTimeout(() => process.exit(0), 300);
  });

  app.post<{ Body: { telefone?: string } }>(
    '/api/admin/contatos/resetar-historico',
    async (req, reply) => {
      if (!exigirAdmin(req, reply)) return;
      const telefone = String(req.body?.telefone ?? '').trim();
      if (!telefone) {
        return reply.status(400).send({ erro: 'telefone é obrigatório' });
      }
      try {
        const resultado = await resetarContatoTeste(telefone);
        return {
          ok: true,
          resultado,
          mensagem:
            'Historico, fila pendente, debounce e estado do contato foram limpos sem apagar o conhecimento geral da i.a',
        };
      } catch (error) {
        return reply.status(400).send({
          erro: error instanceof Error ? error.message : 'Falha ao resetar contato',
        });
      }
    },
  );

  app.get('/api/admin/treinamento/telefones', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    return { itens: await listarTelefonesTreinadores() };
  });

  app.post<{
    Body: { telefone?: string; nome?: string; cargo?: string; observacoes?: string; ativo?: boolean };
  }>('/api/admin/treinamento/telefones', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    if (!req.body?.telefone) {
      return reply.status(400).send({ erro: 'telefone é obrigatório' });
    }
    try {
      const item = await criarTelefoneTreinador({
        telefone: req.body.telefone,
        nome: req.body.nome,
        cargo: req.body.cargo,
        observacoes: req.body.observacoes,
        ativo: req.body.ativo,
      });
      return { ok: true, item };
    } catch (error) {
      return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao criar telefone' });
    }
  });

  app.put<{
    Params: { id: string };
    Body: { telefone?: string; nome?: string; cargo?: string; observacoes?: string; ativo?: boolean };
  }>('/api/admin/treinamento/telefones/:id', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.status(400).send({ erro: 'id inválido' });
    try {
      const item = await atualizarTelefoneTreinador(id, req.body ?? {});
      return { ok: true, item };
    } catch (error) {
      return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao atualizar telefone' });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/treinamento/telefones/:id', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.status(400).send({ erro: 'id inválido' });
    await excluirTelefoneTreinador(id);
    return { ok: true };
  });

  app.get('/api/admin/treinamento/aprendizados', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    return { itens: await listarAprendizadosWhatsapp() };
  });

  app.get('/api/admin/treinamento/pendencias', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    return { itens: await listarPendenciasAprendizadoWhatsapp() };
  });

  app.post<{
    Body: { telefoneAutor?: string; nomeAutor?: string; texto?: string; aplicarAgora?: boolean };
  }>('/api/admin/treinamento/instrucao-direta', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const texto = String(req.body?.texto ?? '').trim();
    if (texto.length < 10) {
      return reply.status(400).send({ erro: 'texto deve ter pelo menos 10 caracteres' });
    }
    try {
      const entrada = {
        telefoneAutor: req.body?.telefoneAutor,
        nomeAutor: req.body?.nomeAutor,
        texto,
        autorAcao: 'dashboard',
      };
      const item = req.body?.aplicarAgora
        ? await aplicarInstrucaoTreinamentoDireto(entrada)
        : await criarPropostaTreinamentoDireto(entrada);
      return {
        ok: true,
        modo: req.body?.aplicarAgora ? 'aplicado' : 'proposta',
        item,
      };
    } catch (error) {
      return reply.status(400).send({
        erro: error instanceof Error ? error.message : 'Falha ao processar instrucao direta',
      });
    }
  });

  app.post<{ Params: { id: string }; Body: { autor?: string } }>(
    '/api/admin/treinamento/pendencias/:id/aprovar',
    async (req, reply) => {
      if (!exigirAdmin(req, reply)) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ erro: 'id inválido' });
      try {
        const item = await aprovarPendenciaAprendizadoWhatsapp(id, req.body?.autor ?? 'dashboard');
        return { ok: true, item };
      } catch (error) {
        return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao aprovar proposta' });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { autor?: string } }>(
    '/api/admin/treinamento/pendencias/:id/cancelar',
    async (req, reply) => {
      if (!exigirAdmin(req, reply)) return;
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.status(400).send({ erro: 'id inválido' });
      try {
        await cancelarPendenciaAprendizadoWhatsapp(id, req.body?.autor ?? 'dashboard');
        return { ok: true };
      } catch (error) {
        return reply.status(400).send({ erro: error instanceof Error ? error.message : 'Falha ao cancelar proposta' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/admin/treinamento/aprendizados/:id', async (req, reply) => {
    if (!exigirAdmin(req, reply)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.status(400).send({ erro: 'id inválido' });
    await excluirAprendizadoWhatsapp(id);
    return { ok: true };
  });

  app.get<{ Querystring: { embarque_id?: string } }>(
    '/api/admin/ofertas/historico-nominal',
    async (req, reply) => {
      if (!exigirAdmin(req, reply)) return;
      const embarqueId = req.query?.embarque_id;
      if (!embarqueId) {
        return reply.status(400).send({ erro: 'embarque_id é obrigatório' });
      }
      const resumo = await resumirHistoricoNominalOfertasPorEmbarque(embarqueId);
      return {
        embarque_id: embarqueId,
        recusas: resumo.recusas,
        escalonamentos: resumo.escalonamentos,
        aceites: resumo.aceites,
      };
    },
  );
}
