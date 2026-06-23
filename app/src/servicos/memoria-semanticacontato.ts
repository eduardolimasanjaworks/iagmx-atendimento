/**
 * Memoria semantica por contato em Qdrant.
 * Indexa mensagens relevantes por telefone e recupera fatos similares.
 * Mantem o prompt curto usando filtro por contato e reranque por recencia.
 */
import { randomUUID } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config.js';
import { gerarEmbedding } from './openai.js';
import { DIMENSAO } from './qdrant.js';

const cliente = new QdrantClient({ url: config.qdrantUrl });
const COLECAO = config.qdrantColecaoMemoriaContato;
const FUSO_BRASILIA = 'America/Sao_Paulo';

export interface PontoMemoriaContato {
  telefone: string;
  papel: 'user' | 'assistant' | 'empresa';
  texto: string;
  timestamp: number;
}

function chaveDiaBrasilia(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_BRASILIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

function relevante(texto: string): boolean {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (limpo.length < 6) return false;
  if (/^(ok|blz|beleza|show|valeu|tmj|opa|oi|ola|bom dia|boa tarde|boa noite)$/i.test(limpo)) {
    return false;
  }
  return true;
}

function truncar(texto: string, limite: number): string {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= limite) return limpo;
  return `${limpo.slice(0, limite - 3)}...`;
}

function rotuloPapel(papel: string): string {
  if (papel === 'user') return 'motorista';
  if (papel === 'assistant') return 'ia';
  if (papel === 'empresa') return 'gmx';
  return papel;
}

export async function inicializarColecaoMemoriaContato(): Promise<void> {
  const colecoes = await cliente.getCollections();
  const existe = colecoes.collections.some((c) => c.name === COLECAO);
  if (existe) return;
  await cliente.createCollection(COLECAO, {
    vectors: { size: DIMENSAO, distance: 'Cosine' },
  });
  console.log(`[qdrant] Coleção "${COLECAO}" criada`);
}

export async function indexarMemoriaContato(ponto: PontoMemoriaContato): Promise<void> {
  if (!relevante(ponto.texto)) return;
  await inicializarColecaoMemoriaContato();
  const vetor = await gerarEmbedding(ponto.texto.slice(0, 800));
  await cliente.upsert(COLECAO, {
    wait: false,
    points: [
      {
        id: randomUUID(),
        vector: vetor,
        payload: {
          telefone: ponto.telefone,
          papel: ponto.papel,
          texto: truncar(ponto.texto, 500),
          timestamp: ponto.timestamp,
          dia: chaveDiaBrasilia(ponto.timestamp),
        },
      },
    ],
  });
}

export async function limparMemoriaContato(telefone: string): Promise<void> {
  try {
    await inicializarColecaoMemoriaContato();
    await cliente.delete(COLECAO, {
      wait: true,
      filter: {
        must: [{ key: 'telefone', match: { value: telefone } }],
      },
    });
  } catch {
    /* best effort */
  }
}

export async function buscarMemoriaContatoSimilar(
  telefone: string,
  consulta: string,
  limite = 6,
): Promise<Array<{ texto: string; papel: string; timestamp: number; score: number; dia: string }>> {
  try {
    await inicializarColecaoMemoriaContato();
    const vetor = await gerarEmbedding(consulta.slice(0, 1200));
    const resultado = await cliente.search(COLECAO, {
      vector: vetor,
      limit: limite * 3,
      with_payload: true,
      filter: {
        must: [{ key: 'telefone', match: { value: telefone } }],
      },
    });
    const hoje = chaveDiaBrasilia(Date.now());
    return resultado
      .map((item) => ({
        texto: String(item.payload?.texto ?? ''),
        papel: String(item.payload?.papel ?? ''),
        timestamp: Number(item.payload?.timestamp ?? 0),
        dia: String(item.payload?.dia ?? ''),
        score: item.score ?? 0,
      }))
      .filter((item) => item.texto)
      .sort((a, b) => {
        const pesoA = (a.dia === hoje ? 0.08 : 0) + Math.min(0.05, Math.max(0, (a.timestamp - b.timestamp) / 86_400_000));
        const pesoB = (b.dia === hoje ? 0.08 : 0);
        return (b.score + pesoB) - (a.score + pesoA);
      })
      .slice(0, limite);
  } catch {
    return [];
  }
}

export async function montarMemoriaSemanticaContato(
  telefone: string,
  consulta: string,
  recentesExcluir: string[] = [],
): Promise<string> {
  const similares = await buscarMemoriaContatoSimilar(telefone, consulta, 6);
  const excluidos = new Set(
    recentesExcluir.map((item) => String(item || '').replace(/\s+/g, ' ').trim().toLowerCase()),
  );
  const linhas = similares
    .filter((item) => item.score >= 0.72)
    .filter((item) => !excluidos.has(item.texto.replace(/\s+/g, ' ').trim().toLowerCase()))
    .map((item) => `- ${rotuloPapel(item.papel)}: ${truncar(item.texto, 140)}`);

  if (!linhas.length) return '';
  return [
    '=== MEMORIA SEMANTICA DO CONTATO ===',
    ...linhas,
    'Use esta memoria so quando ela ajudar a manter continuidade obvia do atendimento.',
  ].join('\n');
}
