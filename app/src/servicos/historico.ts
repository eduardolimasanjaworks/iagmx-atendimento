/**
 * Histórico de conversa por contato (Redis).
 * Necessário para cenários que dependem da "última mensagem da empresa".
 */
import { obterRedis } from '../lib/redis.js';
import { config } from '../config.js';
import { jidParaTelefone } from '../util/telefone.js';
import { indexarMemoriaContato, limparMemoriaContato } from './memoria-semanticacontato.js';

const redis = obterRedis();
const PREFIXO = 'historico:';

export type PapelHistorico = 'user' | 'assistant' | 'system' | 'empresa';

export interface MensagemHistorico {
  papel: PapelHistorico;
  conteudo: string;
  timestamp: number;
}

/** Adiciona mensagem ao histórico do contato */
export async function adicionarAoHistorico(
  remoteJid: string,
  papel: PapelHistorico,
  conteudo: string,
): Promise<void> {
  const chave = `${PREFIXO}${remoteJid}`;
  const msg: MensagemHistorico = { papel, conteudo, timestamp: Date.now() };
  await redis.rpush(chave, JSON.stringify(msg));
  await redis.ltrim(chave, -config.historicoMaxMensagens, -1);
  await redis.expire(chave, 86400 * 7); // 7 dias
  if (papel !== 'system') {
    const telefone = jidParaTelefone(remoteJid);
    void indexarMemoriaContato({
      telefone,
      papel,
      texto: conteudo,
      timestamp: msg.timestamp,
    }).catch(() => {});
  }
}

/** Mapeia papel interno para roles aceitos pelo modelo */
function paraRoleModelo(
  papel: PapelHistorico,
  conteudo: string,
): { role: 'user' | 'assistant' | 'system'; content: string } {
  if (papel === 'empresa') {
    // Saida proativa da GMX precisa se comportar como fala anterior do assistente
    // para fluxos como disponibilidade, cadastro e canhoto seguirem o roteiro.
    return { role: 'assistant', content: conteudo };
  }
  return { role: papel, content: conteudo };
}

/** Retorna histórico formatado para o modelo */
export async function obterHistorico(
  remoteJid: string,
  opts?: { limite?: number },
): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> {
  const chave = `${PREFIXO}${remoteJid}`;
  const inicio = opts?.limite ? -Math.max(1, opts.limite) : 0;
  const itens = await redis.lrange(chave, inicio, -1);
  return itens.map((raw) => {
    const m = JSON.parse(raw) as MensagemHistorico;
    return paraRoleModelo(m.papel, m.conteudo);
  });
}

/** Limpa histórico de um contato */
export async function limparHistorico(remoteJid: string): Promise<void> {
  await Promise.all([
    redis.del(`${PREFIXO}${remoteJid}`),
    limparMemoriaContato(jidParaTelefone(remoteJid)),
  ]);
}

/** Mensagens brutas com timestamp (auditoria / reconciliação). */
export async function obterHistoricoBruto(remoteJid: string): Promise<MensagemHistorico[]> {
  const chave = `${PREFIXO}${remoteJid}`;
  const itens = await redis.lrange(chave, 0, -1);
  return itens.map((raw) => JSON.parse(raw) as MensagemHistorico);
}

/** Lista remoteJids com histórico ativo (scan Redis). */
export async function listarRemoteJidsComHistorico(): Promise<string[]> {
  const out: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${PREFIXO}*`, 'COUNT', 200);
    cursor = next;
    for (const k of keys) {
      out.push(k.slice(PREFIXO.length));
    }
  } while (cursor !== '0');
  return out;
}

/**
 * Scan enxuto: lê só as últimas N mensagens por chave, filtra por janela/conteúdo.
 * Ordena por atividade mais recente primeiro.
 */
export async function listarJidsHistoricoRecente(opts: {
  janelaHoras: number;
  maxChaves?: number;
  prefetchMensagens?: number;
  filtroConteudo?: RegExp;
  minMensagensNaJanela?: number;
  timeoutMs?: number;
}): Promise<string[]> {
  const limiteTs = Date.now() - opts.janelaHoras * 60 * 60 * 1000;
  const maxChaves = opts.maxChaves ?? 300;
  const prefetch = opts.prefetchMensagens ?? 12;
  const minMsgs = opts.minMensagensNaJanela ?? 2;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const inicio = Date.now();

  const candidatos: Array<{ jid: string; ultima: number }> = [];
  let cursor = '0';
  let chavesVistas = 0;

  do {
    if (Date.now() - inicio > timeoutMs) {
      console.warn(
        `[historico] scan interrompido por timeout (${chavesVistas} chaves, ${candidatos.length} candidatos)`,
      );
      break;
    }

    const [next, keys] = await redis.scan(cursor, 'MATCH', `${PREFIXO}*`, 'COUNT', 100);
    cursor = next;

    for (const chave of keys) {
      chavesVistas += 1;
      if (chavesVistas > maxChaves) break;

      const raw = await redis.lrange(chave, -prefetch, -1);
      if (!raw.length) continue;

      let msgs: MensagemHistorico[] = [];
      try {
        msgs = raw.map((r) => JSON.parse(r) as MensagemHistorico);
      } catch {
        continue;
      }

      const recentes = msgs.filter((m) => m.timestamp >= limiteTs);
      if (recentes.length < minMsgs) continue;

      const texto = recentes.map((m) => m.conteudo).join('\n');
      if (opts.filtroConteudo && !opts.filtroConteudo.test(texto)) continue;

      const ultima = Math.max(...msgs.map((m) => m.timestamp));
      candidatos.push({ jid: chave.slice(PREFIXO.length), ultima });
    }

    if (chavesVistas > maxChaves) break;
  } while (cursor !== '0');

  candidatos.sort((a, b) => b.ultima - a.ultima);
  return candidatos.map((c) => c.jid);
}
