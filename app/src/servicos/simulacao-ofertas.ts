/**
 * Simula respostas de motoristas fake sem Evolution nem LLM.
 * Mantém o fluxo auditável no histórico e no historico_ofertas.
 * Evita colisão do mesmo motorista com dois embarques ao mesmo tempo.
 */
import { createHash } from 'node:crypto';
import { obterRedis } from '../lib/redis.js';
import { adicionarAoHistorico } from './historico.js';
import { registrarEventoHistoricoOferta } from './historico-ofertas-gmx.js';
import type { EstadoNegociacao } from './motor-negociacao.js';
import { atualizarEstadoNegociacao, avaliarNegociacao } from './motor-negociacao.js';
import { salvarEstadoMonitorTelefone } from './monitor-telefone.js';
import { simulacaoAtivaParaTelefone } from './simulacao-cenario.js';
import { telefoneParaJid } from '../util/telefone.js';
import {
  marcarEmbarqueAceito,
  marcarEmbarqueAguardandoHumano,
  marcarEmbarqueRecusado,
} from './oferta-status-embarque.js';
import { abrirFilaHumanaOferta } from './oferta-fila-humana.js';

type OfertaSimulada = {
  telefone: string;
  embarqueId: string | number;
  motoristaId?: string | number | null;
  origem: string;
  destino: string;
  valorOfertado: number;
  valorMinimo?: number | null;
  valorMaximo?: number | null;
  observacaoTag?: string;
};

const redis = obterRedis();
const LOCK_PREFIX = 'simulacao:oferta:ativa:';
const timers = new Map<string, NodeJS.Timeout[]>();

function hashNumero(seed: string): number {
  return Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 12), 16);
}

function intervaloMs(seed: string, passo: number): number {
  const base = 4 * 60_000;
  const variacao = hashNumero(`${seed}:${passo}`) % (2 * 60_000 + 1);
  return base + variacao;
}

function chance(seed: string, total: number): number {
  return hashNumero(seed) % total;
}

async function agendar(
  key: string,
  delayMs: number,
  fn: () => Promise<void>,
): Promise<void> {
  const lista = timers.get(key) ?? [];
  const timer = setTimeout(() => {
    void fn().finally(() => {
      const atual = timers.get(key) ?? [];
      timers.set(key, atual.filter((item) => item !== timer));
    });
  }, delayMs);
  lista.push(timer);
  timers.set(key, lista);
}

async function registrarHistoricoContato(
  telefone: string,
  papel: 'user' | 'assistant',
  mensagem: string,
): Promise<void> {
  await adicionarAoHistorico(telefoneParaJid(telefone), papel, mensagem);
}

async function encerrarOfertaAtiva(key: string): Promise<void> {
  await redis.del(key).catch(() => undefined);
}

export async function cancelarSimulacaoOfertaPorTelefone(telefone: string): Promise<void> {
  const key = `${LOCK_PREFIX}${telefone}`;
  for (const timer of timers.get(key) ?? []) clearTimeout(timer);
  timers.delete(key);
  await encerrarOfertaAtiva(key);
}

export async function iniciarSimulacaoOferta(opts: OfertaSimulada): Promise<{ ok: true; simulada: boolean; ignorada?: string }> {
  const ativa = await simulacaoAtivaParaTelefone(opts.telefone);
  if (!ativa) return { ok: true, simulada: false, ignorada: 'telefone_nao_simulado' };

  const key = `${LOCK_PREFIX}${opts.telefone}`;
  const lockAtual = await redis.get(key).catch(() => null);
  if (lockAtual && lockAtual !== String(opts.embarqueId)) {
    return { ok: true, simulada: false, ignorada: 'motorista_ja_em_oferta_ativa' };
  }
  await redis.set(key, String(opts.embarqueId), 'EX', 24 * 3600).catch(() => undefined);

  const seed = `${opts.telefone}:${opts.embarqueId}`;
  const faixa = {
    origem: opts.origem,
    destino: opts.destino,
    valorOfertado: Number(opts.valorOfertado),
    valorMinimo: Number(opts.valorMinimo ?? opts.valorOfertado),
    valorMaximo: Number(opts.valorMaximo ?? opts.valorOfertado),
    fonte: 'embarque' as const,
  };

  const keyTimers = key;
  const modo = chance(seed, 5);
  await salvarEstadoMonitorTelefone(opts.telefone, {
    fase: 'fila_pendente',
    mensagem: 'Motorista fake aguardando para responder',
    desdeMs: Date.now(),
    detalhe: 'simulacao_sem_whatsapp_real',
  }).catch(() => undefined);

  if (modo === 0) {
    await agendar(keyTimers, intervaloMs(seed, 1), async () => {
      const msg = `Fechado parceiro, topo por R$ ${faixa.valorOfertado}`;
      await registrarHistoricoContato(opts.telefone, 'user', msg);
      await registrarEventoHistoricoOferta({
        subtipo: 'aceite_simulado',
        telefone: opts.telefone,
        embarque_id: opts.embarqueId,
        motorista_id: opts.motoristaId ?? null,
        aceite: true,
        valor_aceito: faixa.valorOfertado,
        valor_ofertado: faixa.valorOfertado,
        valor_minimo: faixa.valorMinimo,
        valor_maximo: faixa.valorMaximo,
        origem: opts.origem,
        destino: opts.destino,
        observacao: opts.observacaoTag ?? 'simulacao',
      }).catch(() => undefined);
      await marcarEmbarqueAceito({
        embarqueId: opts.embarqueId,
        motoristaId: opts.motoristaId ?? null,
        valorAceito: faixa.valorOfertado,
      }).catch(() => undefined);
      await encerrarOfertaAtiva(keyTimers);
    });
    return { ok: true, simulada: true };
  }

  if (modo === 1) {
    await agendar(keyTimers, intervaloMs(seed, 1), async () => {
      const msg = 'Muito longe pra mim agora parceiro, vou passar nessa';
      await registrarHistoricoContato(opts.telefone, 'user', msg);
      await registrarEventoHistoricoOferta({
        subtipo: 'recusa_simulada',
        telefone: opts.telefone,
        embarque_id: opts.embarqueId,
        motorista_id: opts.motoristaId ?? null,
        aceite: false,
        valor_ofertado: faixa.valorOfertado,
        valor_minimo: faixa.valorMinimo,
        valor_maximo: faixa.valorMaximo,
        origem: opts.origem,
        destino: opts.destino,
        motivo: 'longe_ou_sem_interesse',
        observacao: opts.observacaoTag ?? 'simulacao',
      }).catch(() => undefined);
      await marcarEmbarqueRecusado({
        embarqueId: opts.embarqueId,
        limparMotorista: true,
      }).catch(() => undefined);
      await encerrarOfertaAtiva(keyTimers);
    });
    return { ok: true, simulada: true };
  }

  let estado: EstadoNegociacao = {
    rodadas: 0,
    faixa,
    ultimoValorPedido: undefined as number | undefined,
    ultimaContraofertaIa: undefined as number | undefined,
  };
  const pedido1 = modo === 2
    ? Math.min(faixa.valorMaximo, faixa.valorOfertado + Math.max(100, Math.round((faixa.valorMaximo - faixa.valorMinimo) * 0.4)))
    : faixa.valorMaximo + 400;

  await agendar(keyTimers, intervaloMs(seed, 1), async () => {
    const user1 = `Consigo pegar, mas preciso de R$ ${pedido1}`;
    await registrarHistoricoContato(opts.telefone, 'user', user1);
    const acao1 = avaliarNegociacao({ mensagem: user1, faixa, estado });
    estado = atualizarEstadoNegociacao(estado, acao1, user1);
    if (acao1.tipo === 'contraproposta_ia' || acao1.tipo === 'reprompt') {
      await registrarHistoricoContato(opts.telefone, 'assistant', acao1.mensagem);
    }

    if (modo === 2) {
      await agendar(keyTimers, intervaloMs(seed, 2), async () => {
        const aceite = `Fecho em R$ ${acao1.tipo === 'contraproposta_ia' ? acao1.valorProposto : faixa.valorOfertado}`;
        await registrarHistoricoContato(opts.telefone, 'user', aceite);
        const acao2 = avaliarNegociacao({ mensagem: aceite, faixa, estado });
        await registrarEventoHistoricoOferta({
          subtipo: 'aceite_negociado_simulado',
          telefone: opts.telefone,
          embarque_id: opts.embarqueId,
          motorista_id: opts.motoristaId ?? null,
          aceite: true,
          valor_aceito: acao2.tipo === 'aceite' ? acao2.valorAceito : faixa.valorOfertado,
          valor_ofertado: faixa.valorOfertado,
          valor_pedido_motorista: pedido1,
          valor_minimo: faixa.valorMinimo,
          valor_maximo: faixa.valorMaximo,
          origem: opts.origem,
          destino: opts.destino,
          observacao: opts.observacaoTag ?? 'simulacao',
        }).catch(() => undefined);
        await marcarEmbarqueAceito({
          embarqueId: opts.embarqueId,
          motoristaId: opts.motoristaId ?? null,
          valorAceito: acao2.tipo === 'aceite' ? acao2.valorAceito : faixa.valorOfertado,
        }).catch(() => undefined);
        await encerrarOfertaAtiva(keyTimers);
      });
      return;
    }

    await agendar(keyTimers, intervaloMs(seed, 2), async () => {
      const user2 = `Nao consigo, preciso de R$ ${faixa.valorMaximo + 800}`;
      await registrarHistoricoContato(opts.telefone, 'user', user2);
      const acao2 = avaliarNegociacao({ mensagem: user2, faixa, estado });
      estado = atualizarEstadoNegociacao(estado, acao2, user2);
      if (acao2.tipo === 'contraproposta_ia') {
        await registrarHistoricoContato(opts.telefone, 'assistant', acao2.mensagem);
      }
      await agendar(keyTimers, intervaloMs(seed, 3), async () => {
        const user3 = 'Se nao for nesse valor vou precisar que voce veja com o operacional';
        await registrarHistoricoContato(opts.telefone, 'user', user3);
        await registrarEventoHistoricoOferta({
          subtipo: 'escalonamento_simulado',
          telefone: opts.telefone,
          embarque_id: opts.embarqueId,
          motorista_id: opts.motoristaId ?? null,
          aceite: null,
          precisa_intervencao_humana: true,
          valor_ofertado: faixa.valorOfertado,
          valor_pedido_motorista: faixa.valorMaximo + 800,
          valor_minimo: faixa.valorMinimo,
          valor_maximo: faixa.valorMaximo,
          origem: opts.origem,
          destino: opts.destino,
          motivo: 'negociacao_acima_teto',
          observacao: opts.observacaoTag ?? 'simulacao',
        }).catch(() => undefined);
        await marcarEmbarqueAguardandoHumano({
          embarqueId: opts.embarqueId,
          motoristaId: opts.motoristaId ?? null,
          motivo: 'negociacao_acima_teto',
        }).catch(() => undefined);
        await abrirFilaHumanaOferta({
          telefone: opts.telefone,
          embarqueId: opts.embarqueId,
          motoristaId: opts.motoristaId ?? null,
          motivo: 'negociacao_acima_teto',
          valorOfertado: faixa.valorOfertado,
          valorPedidoMotorista: faixa.valorMaximo + 800,
          valorMinimo: faixa.valorMinimo,
          valorMaximo: faixa.valorMaximo,
          origem: opts.origem,
          destino: opts.destino,
          observacao: opts.observacaoTag ?? 'simulacao',
        }).catch(() => undefined);
        await salvarEstadoMonitorTelefone(opts.telefone, {
          fase: 'fila_pendente',
          mensagem: 'Motorista fake pediu decisão humana',
          desdeMs: Date.now(),
          detalhe: `embarque ${opts.embarqueId}`,
        }).catch(() => undefined);
        await encerrarOfertaAtiva(keyTimers);
      });
    });
  });

  return { ok: true, simulada: true };
}
