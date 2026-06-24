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
import {
  novoEventoHistoricoId,
  registrarEventoHistoricoOferta,
} from '../servicos/historico-ofertas-gmx.js';
import { iniciarSimulacaoOferta } from '../servicos/simulacao-ofertas.js';
import { simulacaoAtivaParaTelefone } from '../servicos/simulacao-cenario.js';
import { adquirirLockOferta, liberarLockOfertaPorTelefone } from '../servicos/oferta-lock.js';
import { marcarEmbarqueOfertado } from '../servicos/oferta-status-embarque.js';

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
    const lock = await adquirirLockOferta({
      telefone,
      embarqueId: body.embarque_id,
      motoristaId: body.motorista_id ?? null,
      origem: body.origem.trim(),
      destino: body.destino.trim(),
    });
    if (!lock.ok) {
      return reply.status(409).send({
        ok: false,
        enviado: false,
        motivo: 'motorista_ja_em_oferta_ativa',
        lock: lock.atual,
      });
    }
    let envio;
    try {
      envio = await tentarEnviarResposta(telefone, texto, config.evolutionInstance, {
        remoteJid,
        mensagensEntrada: 0,
        origem: 'evolution',
        agendarAtrasoInicial: false,
      });
    } catch (error) {
      await liberarLockOfertaPorTelefone(telefone).catch(() => undefined);
      throw error;
    }

    if (envio.enviado) {
      const telefoneSimulado = await simulacaoAtivaParaTelefone(telefone);
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
        observacao: telefoneSimulado ? '__GMX_SIMULACAO_NAO_ENVIAR__oferta_disparada__' : null,
      }).catch(() => undefined);
      if (body.embarque_id != null) {
        await marcarEmbarqueOfertado({
          embarqueId: body.embarque_id,
          configRotaId: body.config_rota_id ?? null,
          motoristaId: body.motorista_id ?? null,
          valorOfertado: Number(body.valor_ofertado),
        });
      }
      logEvento('oferta', 'Disparo autorizado enviado', {
        telefone,
        embarque_id: body.embarque_id,
        motorista_id: body.motorista_id,
        event_id: eventId,
        fragmentos: envio.fragmentos,
      });
      if (telefoneSimulado) {
        await iniciarSimulacaoOferta({
          telefone,
          embarqueId: body.embarque_id,
          motoristaId: body.motorista_id ?? null,
          origem: body.origem.trim(),
          destino: body.destino.trim(),
          valorOfertado: Number(body.valor_ofertado),
          valorMinimo: body.valor_minimo != null ? Number(body.valor_minimo) : null,
          valorMaximo: body.valor_maximo != null ? Number(body.valor_maximo) : null,
          observacaoTag: '__GMX_SIMULACAO_NAO_ENVIAR__',
        }).catch(() => undefined);
      }
    } else {
      await liberarLockOfertaPorTelefone(telefone).catch(() => undefined);
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
