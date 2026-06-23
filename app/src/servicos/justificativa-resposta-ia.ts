/**
 * Justificativa auditavel para respostas da IA no monitor.
 * Usa traces recentes para explicar lote, rota e memoria usada.
 * Nao expoe raciocinio oculto, so sinais operacionais do pipeline.
 */
import type { TracePipeline } from './trace-pipeline.js';

function normalizar(texto: string): string {
  return String(texto || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function truncar(texto: string, limite: number): string {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= limite) return limpo;
  return `${limpo.slice(0, limite - 3)}...`;
}

function matchResposta(trace: TracePipeline, resposta: string, timestamp: number): boolean {
  if (trace.status !== 'ok') return false;
  const alvo = normalizar(resposta);
  if (!alvo) return false;
  const traceResp = normalizar(trace.resposta || '');
  const pertoNoTempo = Math.abs((trace.fimMs ?? trace.inicioMs) - timestamp) <= 15 * 60 * 1000;
  if (!pertoNoTempo) return false;
  if (!traceResp) return true;
  return traceResp.includes(alvo) || alvo.includes(traceResp) || traceResp.slice(0, 80) === alvo.slice(0, 80);
}

function detalheEtapa(trace: TracePipeline, etapaNome: string) {
  return [...trace.etapas].reverse().find((etapa) => etapa.etapa === etapaNome)?.detalhe;
}

export function montarJustificativaRespostaIa(
  resposta: string,
  timestamp: number,
  traces: TracePipeline[],
): string | null {
  const trace = traces.find((item) => matchResposta(item, resposta, timestamp));
  if (!trace) return null;

  const contexto = detalheEtapa(trace, 'contexto') || {};
  const roteamento = detalheEtapa(trace, 'roteamento') || {};
  const geracao = detalheEtapa(trace, 'geracao') || {};
  const linhas: string[] = ['Justificativa do envio:'];

  if (Array.isArray(contexto.mensagensLote) && contexto.mensagensLote.length) {
    linhas.push(`- lote considerado: ${truncar(contexto.mensagensLote.join(' | '), 220)}`);
  } else {
    linhas.push(`- entrada considerada: ${truncar(trace.entrada, 220)}`);
  }

  const intencao = typeof roteamento.intencao === 'string' ? roteamento.intencao : '';
  const passo = typeof roteamento.passo === 'string' ? roteamento.passo : '';
  const cenario = roteamento.cenario != null ? String(roteamento.cenario) : '';
  const decisao = [intencao && `intencao ${intencao}`, passo && `passo ${passo}`, cenario && `cenario ${cenario}`]
    .filter(Boolean)
    .join(' · ');
  if (decisao) linhas.push(`- decisao operacional: ${decisao}`);

  if (typeof contexto.ultimaSaida === 'string' && contexto.ultimaSaida.trim()) {
    linhas.push(`- ultima saida lembrada: ${truncar(contexto.ultimaSaida, 160)}`);
  }
  if (typeof contexto.memoriaMesmoDia === 'string' && contexto.memoriaMesmoDia.trim()) {
    linhas.push(`- memoria do mesmo dia usada: ${truncar(contexto.memoriaMesmoDia, 180)}`);
  }
  if (typeof contexto.memoriaSemantica === 'string' && contexto.memoriaSemantica.trim()) {
    linhas.push(`- memoria semantica usada: ${truncar(contexto.memoriaSemantica, 180)}`);
  }
  if (typeof geracao.preview === 'string' && geracao.preview.trim()) {
    linhas.push(`- preview planejado: ${truncar(geracao.preview, 180)}`);
  }

  return linhas.join('\n');
}
