/**
 * Disparo real das jornadas de teste no IAGMX.
 * Reaproveita o catalogo persistido e o envio do WhatsApp.
 * Mantem o gatilho o mais perto possivel da producao.
 */
import { tentarEnviarResposta } from './enviar-resposta.js';
import { adicionarAoHistorico, obterHistoricoBruto } from './historico.js';
import { criarMotoristaMinimo, buscarMotoristaPorTelefone, atualizarMotorista } from './motorista-gmx.js';
import { resetarContatoTeste, type ResultadoResetContatoTeste } from './reset-contato-teste.js';
import { telefoneParaJid, normalizarTelefone } from '../util/telefone.js';
import { config } from '../config.js';
import { invalidarCacheContextoErp } from './contexto-erp-motorista.js';
import { listarRespostasPendentes } from './fila-respostas.js';
import { obterRedis } from '../lib/redis.js';
import {
  obterJornadaTestePorId,
  type JornadaTesteDefinicao,
} from './catalogo-jornadas-teste.js';
import { ativarModoTesteImediato } from './modo-teste-imediato.js';

export interface IniciarJornadaTesteInput {
  telefone: string;
  jornadaId: string;
  nomeMotorista?: string;
  resetarHistorico?: boolean;
  marcarComoTeste?: boolean;
  mensagemInicial?: string;
}

export interface IniciarJornadaTesteResultado {
  telefone: string;
  remoteJid: string;
  motoristaId: number;
  motoristaCriado: boolean;
  jornada: JornadaTesteDefinicao;
  mensagemInicial: string;
  enviado: boolean;
  motivo?: string;
  filaId?: string;
  fragmentos: number;
  reset?: ResultadoResetContatoTeste;
  observacaoMotorista?: string;
}

const redis = obterRedis();
const TTL_DUPLICIDADE_SEGUNDOS = 15 * 60;

function observacaoTeste(jornada: JornadaTesteDefinicao): string {
  const hoje = new Date().toISOString().slice(0, 10);
  return `[TESTE IAGMX ${hoje}] jornada ${jornada.cenario} - ${jornada.titulo}`;
}

function mesclarObservacao(atual: unknown, tag: string): string {
  const base = String(atual ?? '').trim();
  if (!base) return tag;
  if (base.includes(tag)) return base;
  return `${base}\n${tag}`.trim();
}

function chaveBloqueioDisparo(telefone: string, jornadaId: string): string {
  return `jornada:teste:lock:${telefone}:${jornadaId}`;
}

async function adquirirBloqueioDisparo(
  telefone: string,
  jornadaId: string,
): Promise<boolean> {
  const chave = chaveBloqueioDisparo(telefone, jornadaId);
  const ok = await redis.set(chave, String(Date.now()), 'EX', TTL_DUPLICIDADE_SEGUNDOS, 'NX');
  return ok === 'OK';
}

async function liberarBloqueioDisparo(telefone: string, jornadaId: string): Promise<void> {
  await redis.del(chaveBloqueioDisparo(telefone, jornadaId));
}

async function temDisparoPendenteIgual(telefone: string, mensagem: string): Promise<boolean> {
  const pendentes = await listarRespostasPendentes(100);
  return pendentes.some((item) => {
    if (item.telefone !== telefone) return false;
    return String(item.texto || '').trim() === mensagem;
  });
}

async function temDisparoRecenteIgual(remoteJid: string, mensagem: string): Promise<boolean> {
  const historico = await obterHistoricoBruto(remoteJid);
  const limiteMs = Date.now() - TTL_DUPLICIDADE_SEGUNDOS * 1000;
  return historico.some((item) => {
    if (item.timestamp < limiteMs) return false;
    if (item.papel !== 'empresa') return false;
    return String(item.conteudo || '').trim() === mensagem;
  });
}

async function garantirMotoristaTeste(telefone: string, nomeMotorista?: string) {
  const existente = await buscarMotoristaPorTelefone(telefone);
  if (existente) {
    const nomeInformado = String(nomeMotorista ?? '').trim();
    const nomeAtual = String(existente.nome ?? '').trim();
    const nomeGenerico = !nomeAtual || /^(motorista|contato)$/i.test(nomeAtual);
    if (nomeInformado && nomeGenerico) {
      await atualizarMotorista(existente.id, { nome: nomeInformado }).catch(() => undefined);
    }
    return { motoristaId: existente.id, criado: false, observacaoAtual: existente.observacao };
  }

  const criado = await criarMotoristaMinimo(telefone, nomeMotorista?.trim() || undefined);
  return { motoristaId: criado.id, criado: true, observacaoAtual: criado.observacao };
}

export async function iniciarJornadaTeste(
  input: IniciarJornadaTesteInput,
): Promise<IniciarJornadaTesteResultado> {
  const telefone = normalizarTelefone(input.telefone);
  if (!telefone || telefone.length < 10) {
    throw new Error('Informe um telefone valido com DDD');
  }

  const jornada = await obterJornadaTestePorId(input.jornadaId);
  const bloqueado = await adquirirBloqueioDisparo(telefone, jornada.id);
  if (!bloqueado) {
    throw new Error('Ja existe um disparo recente ou em andamento para este telefone nessa jornada');
  }

  try {
  const reset = input.resetarHistorico ? await resetarContatoTeste(telefone) : undefined;
  const motorista = await garantirMotoristaTeste(telefone, input.nomeMotorista);
  const mensagemInicial = String(input.mensagemInicial || jornada.mensagemPadrao).trim();
  if (!mensagemInicial) throw new Error('Mensagem inicial vazia');

  let observacaoMotorista = String(motorista.observacaoAtual ?? '').trim() || undefined;
  if (input.marcarComoTeste) {
    observacaoMotorista = mesclarObservacao(motorista.observacaoAtual, observacaoTeste(jornada));
    await atualizarMotorista(motorista.motoristaId, { observacao: observacaoMotorista }).catch(() => undefined);
  }

  invalidarCacheContextoErp(telefone);
  await ativarModoTesteImediato(telefone);

  const remoteJid = telefoneParaJid(telefone);
  if (await temDisparoPendenteIgual(telefone, mensagemInicial)) {
    throw new Error('Ja existe uma mensagem identica pendente para este telefone');
  }
  if (await temDisparoRecenteIgual(remoteJid, mensagemInicial)) {
    throw new Error('Essa jornada ja foi disparada recentemente para este telefone');
  }

  const envio = await tentarEnviarResposta(telefone, mensagemInicial, config.evolutionInstance, {
    remoteJid,
    mensagensEntrada: 0,
    origem: 'evolution',
    fragmentar: false,
    agendarAtrasoInicial: false,
    ignorarDigitando: true,
  });

  if (envio.enviado) {
    await adicionarAoHistorico(remoteJid, 'empresa', mensagemInicial);
  }

  return {
    telefone,
    remoteJid,
    motoristaId: motorista.motoristaId,
    motoristaCriado: motorista.criado,
    jornada,
    mensagemInicial,
    enviado: envio.enviado,
    motivo: envio.motivo,
    filaId: envio.filaId,
    fragmentos: envio.fragmentos,
    reset,
    observacaoMotorista,
  };
  } catch (error) {
    await liberarBloqueioDisparo(telefone, jornada.id);
    throw error;
  }
}
