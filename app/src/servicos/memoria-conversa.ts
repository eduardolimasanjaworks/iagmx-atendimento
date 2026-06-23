/**
 * Memoria compacta de conversa para o prompt.
 * Resume fatos obvios do mesmo dia sem despejar todo o historico.
 * Mantem visiveis status, localizacao e uma linha do tempo curta.
 */
import type { MensagemHistorico } from './historico.js';
import { extrairLocalizacaoTexto } from './ferramentas-contexto.js';

const FUSO_BRASILIA = 'America/Sao_Paulo';

function chaveDiaBrasilia(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_BRASILIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

function rotuloPapel(papel: MensagemHistorico['papel']): string {
  if (papel === 'user') return 'motorista';
  if (papel === 'assistant') return 'ia';
  if (papel === 'empresa') return 'gmx';
  return 'sistema';
}

function truncar(texto: string, limite: number): string {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= limite) return limpo;
  return `${limpo.slice(0, limite - 3)}...`;
}

function extrairStatusDisponibilidade(texto: string): string | null {
  const t = texto.toLowerCase();
  if (/\b(vazio|livre|dispon[ii]vel|to vazio|to livre|t[oô] vazio|t[oô] livre)\b/.test(t)) {
    return 'motorista disse que esta vazio/livre';
  }
  if (/\b(carregad|em viagem|to carregado|to cheio|t[oô] carregad|cheio)\b/.test(t)) {
    return 'motorista disse que esta carregado/em viagem';
  }
  return null;
}

function extrairFatos(historicoDia: MensagemHistorico[]): string[] {
  let ultimaLocalizacao: string | null = null;
  let ultimoStatus: string | null = null;
  let ultimoDocumento: string | null = null;

  for (const item of historicoDia) {
    if (item.papel !== 'user') continue;
    const local = extrairLocalizacaoTexto(item.conteudo);
    if (local) ultimaLocalizacao = local;

    const status = extrairStatusDisponibilidade(item.conteudo);
    if (status) ultimoStatus = status;

    const t = item.conteudo.toLowerCase();
    if (/\bcnh\b/.test(t)) ultimoDocumento = 'motorista mencionou CNH';
    else if (/\bcrlv\b/.test(t)) ultimoDocumento = 'motorista mencionou CRLV';
    else if (/\bantt\b/.test(t)) ultimoDocumento = 'motorista mencionou ANTT';
    else if (/comprovante|canhoto/.test(t)) ultimoDocumento = 'motorista mencionou comprovante/canhoto';
  }

  return [
    ultimoStatus,
    ultimaLocalizacao ? `ultima localizacao citada no dia: ${ultimaLocalizacao}` : null,
    ultimoDocumento,
  ].filter(Boolean) as string[];
}

export function montarMemoriaConversaMesmoDia(
  historico: MensagemHistorico[],
  opts?: { recentesCompletas?: number; maxLinhasMemoria?: number },
): string {
  if (!historico.length) return '';

  const recentesCompletas = opts?.recentesCompletas ?? 10;
  const maxLinhasMemoria = opts?.maxLinhasMemoria ?? 8;
  const referenciaTs = historico[historico.length - 1]?.timestamp ?? Date.now();
  const diaAtual = chaveDiaBrasilia(referenciaTs);
  const historicoDia = historico.filter((item) => chaveDiaBrasilia(item.timestamp) === diaAtual);

  if (historicoDia.length <= recentesCompletas) return '';

  const anteriores = historicoDia.slice(0, -recentesCompletas).slice(-maxLinhasMemoria);
  const fatos = extrairFatos(historicoDia);
  const linhasTempo = anteriores.map((item) => {
    return `- ${rotuloPapel(item.papel)}: ${truncar(item.conteudo, 110)}`;
  });

  const partes: string[] = ['=== MEMORIA OPERACIONAL DO MESMO DIA ==='];
  if (fatos.length) {
    partes.push('FATOS IMPORTANTES:');
    partes.push(...fatos.map((fato) => `- ${fato}`));
  }
  if (linhasTempo.length) {
    partes.push('LINHA DO TEMPO ANTERIOR AO TRECHO RECENTE:');
    partes.push(...linhasTempo);
  }
  partes.push(
    'Use esta memoria para nao esquecer fatos obvios do mesmo dia, mas priorize o trecho recente e o contexto ERP se houver conflito.',
  );
  return partes.join('\n');
}
