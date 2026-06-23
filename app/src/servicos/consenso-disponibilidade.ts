/**
 * Redundancia de disponibilidade com dois modelos via OpenRouter.
 * Consolida consenso conservador para status, localizacao e previsao.
 * Serve tanto para a resposta ao motorista quanto para reconciliação no ERP.
 */
import { config } from '../config.js';
import { chatOpenRouterModeloComMeta, type MensagemChat } from './chat-providers.js';
import { parseDataLiberacao } from './fluxo-disponibilidade.js';

export type CampoDisponibilidadeFaltante =
  | 'status'
  | 'localizacao_atual'
  | 'data_previsao_disponibilidade'
  | 'local_disponibilidade';

export interface UsoModeloDisponibilidade {
  modelo: string;
  provedor: string;
  uso: { input_tokens: number; output_tokens: number };
}

interface ExtracaoModeloDisponibilidade {
  assunto_disponibilidade: boolean;
  status: 'disponivel' | 'carregado' | 'indisponivel' | 'indefinido';
  disponivel: boolean | null;
  localizacao_atual: string | null;
  local_disponibilidade: string | null;
  data_previsao_disponibilidade: string | null;
  faltando: CampoDisponibilidadeFaltante[];
  confianca: number;
  evidencia: string;
}

export interface ConsensoDisponibilidade {
  assuntoDisponibilidade: boolean;
  status: 'disponivel' | 'carregado' | 'indisponivel' | 'indefinido';
  disponivel: boolean | null;
  localizacaoAtual: string | null;
  localDisponibilidade: string | null;
  dataPrevisaoDisponibilidade: string | null;
  faltando: CampoDisponibilidadeFaltante[];
  confianca: number;
  evidencia: string;
  modelos: string[];
  usos: UsoModeloDisponibilidade[];
}

function parseJson<T>(texto: string): T | null {
  const limpo = texto.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const ini = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try {
    return JSON.parse(limpo.slice(ini, fim + 1)) as T;
  } catch {
    return null;
  }
}

function normalizarStatus(valor: unknown): 'disponivel' | 'carregado' | 'indisponivel' | 'indefinido' {
  const t = String(valor ?? '').trim().toLowerCase();
  if (t === 'disponivel') return 'disponivel';
  if (t === 'carregado') return 'carregado';
  if (t === 'indisponivel' || t === 'indisponível') return 'indisponivel';
  return 'indefinido';
}

function detectarStatusExplicito(texto: string): 'disponivel' | 'carregado' | 'indisponivel' | null {
  const t = String(texto).trim().toLowerCase();
  if (!t) return null;
  if (/\b(indispon[ií]vel|n[aã]o\s+estou\s+dispon[ií]vel|n[aã]o\s+t[oô]\s+dispon[ií]vel|sem\s+disponibilidade)\b/.test(t)) return 'indisponivel';
  if (/\b(carregad|em viagem|to\s+cheio|t[oô]\s+carregad|cheio)\b/.test(t)) return 'carregado';
  if (/\b(vazio|livre|dispon[ií]vel|to\s+vazio|t[oô]\s+vazio|t[oô]\s+livre)\b/.test(t)) return 'disponivel';
  return null;
}

function inferirStatusDeterministico(
  historico: Array<{ role: string; content: string }>,
  mensagemAtual: string,
): 'disponivel' | 'carregado' | 'indisponivel' | null {
  for (const texto of [mensagemAtual, ...historico.filter((item) => item.role === 'user').map((item) => item.content).reverse()]) {
    const status = detectarStatusExplicito(texto);
    if (status) return status;
  }
  return null;
}

function inferirDataDeterministica(
  historico: Array<{ role: string; content: string }>,
  mensagemAtual: string,
): string | null {
  for (const texto of [mensagemAtual, ...historico.filter((item) => item.role === 'user').map((item) => item.content).reverse()]) {
    const data = parseDataLiberacao(texto);
    if (data) return data;
  }
  return null;
}

function normalizarLocal(valor: unknown): string | null {
  const t = String(valor ?? '').replace(/\s+/g, ' ').trim();
  if (!t || /^null$/i.test(t)) return null;
  return t;
}

function normalizarData(valor: unknown): string | null {
  const t = String(valor ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(t) ? t : null;
}

function normalizarCamposFaltantes(valor: unknown): CampoDisponibilidadeFaltante[] {
  const permitidos: CampoDisponibilidadeFaltante[] = [
    'status',
    'localizacao_atual',
    'data_previsao_disponibilidade',
    'local_disponibilidade',
  ];
  if (!Array.isArray(valor)) return [];
  return valor
    .map((item) => String(item).trim())
    .filter((item): item is CampoDisponibilidadeFaltante =>
      permitidos.includes(item as CampoDisponibilidadeFaltante),
    );
}

function normalizarExtracao(valor: ExtracaoModeloDisponibilidade | null): ExtracaoModeloDisponibilidade | null {
  if (!valor) return null;
  const status = normalizarStatus(valor.status);
  const confiancaBruta = Number(valor.confianca ?? 0);
  return {
    assunto_disponibilidade: Boolean(valor.assunto_disponibilidade),
    status,
    disponivel:
      typeof valor.disponivel === 'boolean'
        ? valor.disponivel
        : status === 'indefinido'
          ? null
          : status === 'disponivel',
    localizacao_atual: normalizarLocal(valor.localizacao_atual),
    local_disponibilidade: normalizarLocal(valor.local_disponibilidade),
    data_previsao_disponibilidade: normalizarData(valor.data_previsao_disponibilidade),
    faltando: normalizarCamposFaltantes(valor.faltando),
    confianca: Number.isFinite(confiancaBruta) ? Math.max(0, Math.min(1, confiancaBruta)) : 0,
    evidencia: String(valor.evidencia ?? '').trim(),
  };
}

function transcricaoDeHistorico(
  historico: Array<{ role: string; content: string }>,
  mensagemAtual: string,
): string {
  const linhas = historico
    .slice(-16)
    .map((h) => `${h.role === 'assistant' ? 'IA GMX' : h.role === 'user' ? 'Motorista' : 'Sistema'}: ${h.content}`);
  linhas.push(`Motorista: ${mensagemAtual}`);
  return linhas.join('\n');
}

function primeiroNaoNulo(...valores: Array<string | null>): string | null {
  for (const valor of valores) {
    if (valor) return valor;
  }
  return null;
}

function uniaoFaltantes(extracoes: ExtracaoModeloDisponibilidade[]): CampoDisponibilidadeFaltante[] {
  const ordem: CampoDisponibilidadeFaltante[] = [
    'status',
    'localizacao_atual',
    'data_previsao_disponibilidade',
    'local_disponibilidade',
  ];
  const set = new Set<CampoDisponibilidadeFaltante>();
  for (const item of extracoes) {
    for (const campo of item.faltando) set.add(campo);
  }
  return ordem.filter((campo) => set.has(campo));
}

async function extrairComModelo(
  modelo: string,
  transcricao: string,
): Promise<{ extracao: ExtracaoModeloDisponibilidade | null; uso: UsoModeloDisponibilidade | null }> {
  const mensagens: MensagemChat[] = [
    {
      role: 'system',
      content:
        'Voce extrai disponibilidade de motorista. Responda apenas JSON puro, sem markdown e sem texto extra.',
    },
    {
      role: 'user',
      content: `Analise a conversa abaixo e retorne SOMENTE JSON valido:
{
  "assunto_disponibilidade": true ou false,
  "status": "disponivel" | "carregado" | "indisponivel" | "indefinido",
  "disponivel": true | false | null,
  "localizacao_atual": "Cidade UF" ou null,
  "local_disponibilidade": "Cidade UF" ou null,
  "data_previsao_disponibilidade": "AAAA-MM-DD HH:mm:ss" ou null,
  "faltando": ["status","localizacao_atual","data_previsao_disponibilidade","local_disponibilidade"],
  "confianca": 0.0 a 1.0,
  "evidencia": "trecho curto"
}

Regras:
- O objetivo operacional da GMX e sempre saber disponibilidade para carregar e localizacao atual.
- Se o motorista estiver carregado, tambem precisa saber quando vai liberar e onde vai estar disponivel para carregar.
- Se o motorista disser que nao esta disponivel, use "indisponivel" como status.
- localizacao_atual e o lugar onde ele esta agora.
- local_disponibilidade e onde ele vai estar quando liberar para nova carga.
- Se houver conflito ou ambiguidade, use "indefinido" e marque o campo faltando.
- Nunca invente cidade nem data.

Conversa:
${transcricao}`,
    },
  ];
  try {
    const { texto, provedor, uso } = await chatOpenRouterModeloComMeta(modelo, mensagens, {
      temperature: 0,
      max_tokens: 700,
    });
    return {
      extracao: normalizarExtracao(parseJson<ExtracaoModeloDisponibilidade>(texto)),
      uso: { modelo, provedor, uso },
    };
  } catch {
    return { extracao: null, uso: null };
  }
}

export async function resolverDisponibilidadeComRedundancia(opts: {
  historico: Array<{ role: string; content: string }>;
  mensagemAtual: string;
}): Promise<ConsensoDisponibilidade | null> {
  if (!config.redundanciaDisponibilidadeHabilitada || !config.openrouterHabilitado) return null;
  const transcricao = transcricaoDeHistorico(opts.historico, opts.mensagemAtual);
  const modelos = [
    config.modeloChatOpenRouter,
    config.modeloChatOpenRouterAuditoria,
  ].filter((modelo, i, arr) => Boolean(modelo) && arr.indexOf(modelo) === i);
  const amostras = await Promise.all(modelos.map((modelo) => extrairComModelo(modelo, transcricao)));
  const extracoes = amostras
    .map((item) => item.extracao)
    .filter((item): item is ExtracaoModeloDisponibilidade => Boolean(item));
  const usos = amostras
    .map((item) => item.uso)
    .filter((item): item is UsoModeloDisponibilidade => Boolean(item));

  if (extracoes.length === 0) return null;

  const base = [...extracoes].sort((a, b) => b.confianca - a.confianca)[0];
  const statusDeterministico = inferirStatusDeterministico(opts.historico, opts.mensagemAtual);
  const statusDiferentes = new Set(extracoes.map((item) => item.status).filter((item) => item !== 'indefinido'));
  const status =
    statusDeterministico ??
    (statusDiferentes.size > 1 ? 'indefinido' : statusDiferentes.values().next().value ?? base.status);
  const faltando = uniaoFaltantes(extracoes);
  if (status === 'disponivel') {
    const semCampoCarregado = faltando.filter(
      (campo) => campo !== 'data_previsao_disponibilidade' && campo !== 'local_disponibilidade',
    );
    faltando.splice(0, faltando.length, ...semCampoCarregado);
  }

  const localizacaoAtual = primeiroNaoNulo(...extracoes.map((item) => item.localizacao_atual));
  const localDisponibilidade =
    status === 'carregado' || status === 'indisponivel'
      ? primeiroNaoNulo(...extracoes.map((item) => item.local_disponibilidade))
      : null;
  const dataPrevisaoDisponibilidade =
    status === 'carregado' || status === 'indisponivel'
      ? primeiroNaoNulo(
          ...extracoes.map((item) => item.data_previsao_disponibilidade),
          inferirDataDeterministica(opts.historico, opts.mensagemAtual),
        )
      : null;
  const evidencia = extracoes
    .map((item) => item.evidencia)
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');
  const confiancaBase =
    extracoes.reduce((soma, item) => soma + item.confianca, 0) / Math.max(extracoes.length, 1);
  const divergencia = statusDiferentes.size > 1 ? 0.18 : 0;
  const confianca = Math.max(0, Math.min(1, confiancaBase - divergencia));

  return {
    assuntoDisponibilidade: extracoes.some((item) => item.assunto_disponibilidade),
    status,
    disponivel: status === 'indefinido' ? null : status === 'disponivel',
    localizacaoAtual,
    localDisponibilidade,
    dataPrevisaoDisponibilidade,
    faltando,
    confianca,
    evidencia,
    modelos,
    usos,
  };
}
