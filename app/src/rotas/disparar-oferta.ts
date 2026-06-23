/**
 * Disparo proativo de oferta — Evolution API apenas (texto fixo ERP).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { obterConfigMensagensFluxo } from '../servicos/config-mensagens-fluxo.js';
import { montarMensagemOferta } from '../servicos/oferta-disparo.js';
import { tentarEnviarResposta } from '../servicos/enviar-resposta.js';
import { adicionarAoHistorico } from '../servicos/historico.js';
import { telefoneParaJid, normalizarTelefone } from '../util/telefone.js';
import { marcarEnvioIa } from '../servicos/envio-ia.js';
import { logEvento } from '../util/log-eventos.js';
import { directusPatch } from '../servicos/directus.js';
import {
  novoEventoHistoricoId,
  registrarEventoHistoricoOferta,
} from '../servicos/historico-ofertas-gmx.js';

function verificarAdmin(req: FastifyRequest): boolean {
  if (!config.adminKey) return true;
  const chave = req.headers['x-iagmx-key'];
  return chave === config.adminKey;
}

export interface BodyDispararOferta {
  telefone: string;
  embarque_id: string | number;
  config_rota_id?: string | number | null;
  origem: string;
  destino: string;
  valor_ofertado: number;
  valor_minimo?: number;
  valor_maximo?: number;
  operacao?: string;
  produto?: string;
  motorista_id?: string | number;
}

export async function rotasDispararOferta(app: FastifyInstance): Promise<void> {
  app.post<{ Body: BodyDispararOferta }>('/api/disparar-oferta', async (req, reply) => {
    if (!verificarAdmin(req)) {
      return reply.status(401).send({ erro: 'Não autorizado' });
    }

    const body = req.body;
    const telefone = normalizarTelefone(body.telefone);
    if (!telefone || telefone.length < 10) {
      return reply.status(400).send({ erro: 'telefone inválido' });
    }
    if (!body.origem?.trim() || !body.destino?.trim()) {
      return reply.status(400).send({ erro: 'origem e destino obrigatórios' });
    }
    if (body.valor_ofertado == null || !Number.isFinite(Number(body.valor_ofertado))) {
      return reply.status(400).send({ erro: 'valor_ofertado obrigatório' });
    }

    const mensagens = await obterConfigMensagensFluxo();
    const texto = montarMensagemOferta({
      origem: body.origem.trim(),
      destino: body.destino.trim(),
      operacao: body.operacao,
      valorOfertado: Number(body.valor_ofertado),
      produto: body.produto,
    }, mensagens.oferta_proativa_template);

    const remoteJid = telefoneParaJid(telefone);
    const eventId = novoEventoHistoricoId();
    const envio = await tentarEnviarResposta(telefone, texto, config.evolutionInstance, {
      remoteJid,
      mensagensEntrada: 0,
      origem: 'evolution',
      agendarAtrasoInicial: false,
    });

    if (envio.enviado) {
      await marcarEnvioIa(telefone, 8);
      await adicionarAoHistorico(remoteJid, 'assistant', texto);
      await registrarEventoHistoricoOferta({
        evento_id: eventId,
        tipo_evento: 'oferta_disparada',
        subtipo: 'oferta_disparada_ia',
        telefone,
        embarque_id: body.embarque_id,
        motorista_id: body.motorista_id ?? null,
        aceite: null,
        precisa_intervencao_humana: false,
        valor_ofertado: Number(body.valor_ofertado),
        valor_minimo: body.valor_minimo != null ? Number(body.valor_minimo) : null,
        valor_maximo: body.valor_maximo != null ? Number(body.valor_maximo) : null,
        origem: body.origem.trim(),
        destino: body.destino.trim(),
      }).catch(() => undefined);
      if (body.embarque_id != null) {
        await directusPatch('embarques', body.embarque_id, {
          oferta_disparada_em: new Date().toISOString(),
          rota_status: 'ofertado',
          ...(body.config_rota_id != null ? { config_rota_id: Number(body.config_rota_id) } : {}),
          ...(body.motorista_id != null ? { oferta_motorista_id: Number(body.motorista_id) } : {}),
        }).catch(() => undefined);
      }
      logEvento('oferta', 'Disparo autorizado enviado', {
        telefone,
        embarque_id: body.embarque_id,
        motorista_id: body.motorista_id,
        event_id: eventId,
        fragmentos: envio.fragmentos,
      });
    } else {
      logEvento(
        'oferta',
        'Disparo falhou — fila ou WhatsApp desconectado',
        { telefone, motivo: envio.motivo },
        'warn',
      );
      return reply.status(503).send({
        ok: false,
        enviado: false,
        motivo: envio.motivo,
        filaId: envio.filaId,
        texto_preview: texto.slice(0, 200),
      });
    }

    return {
      ok: true,
      enviado: true,
      telefone,
      embarque_id: body.embarque_id,
      event_id: eventId,
      fragmentos: envio.fragmentos,
    };
  });
}
