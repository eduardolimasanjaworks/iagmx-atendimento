/**
 * Cenário 7 — disponibilidade (vazio/carregado) em código, sem LLM no fluxo feliz.
 */
import { extrairLocalizacaoTexto } from './ferramentas-contexto.js';
import { serializarBlocoFerramenta } from './ferramentas.js';
import { obterDataHoraBrasilia } from '../util/horario-brasilia.js';
import { limparEstadoFluxo, obterEstadoFluxo, salvarEstadoFluxo } from './estado-fluxo-redis.js';
import type { ItemDebounce } from '../tipos/evolution.js';
import { extrairGpsDosItens, resolverCidadePorGps } from '../util/gps-localizacao.js';
import { obterConfigMensagensFluxo } from './config-mensagens-fluxo.js';

const GMX_PROATIVA =
  /atualizando nossa base de parceiros|confirma[cç][aã]o r[aá]pida|verifica[cç][aã]o de status|como voc[eê] est[aá] agora.*dispon[ií]vel.*onde est[aá]/i;

export interface ResultadoFluxoDisponibilidade {
  textoComFerramentas: string;
  visivel: string;
  passo: string;
  fragmentar: false;
}

interface EstadoC7 {
  passo:
    | 'status'
    | 'vazio_local'
    | 'indisponivel_local_atual'
    | 'indisponivel_data'
    | 'indisponivel_local_disponibilidade'
    | 'carregado_local_atual'
    | 'carregado_data'
    | 'carregado_local_disponibilidade';
  localizacaoAtual?: string;
  dataPrevisaoDisponibilidade?: string;
}

type ContextoC7 =
  | { tipo: 'entrada' }
  | { tipo: 'aguardando_status' }
  | { tipo: 'vazio_localizacao' }
  | { tipo: 'indisponivel_local_atual' }
  | { tipo: 'indisponivel_data'; localizacaoAtual: string }
  | {
      tipo: 'indisponivel_local_disponibilidade';
      localizacaoAtual: string;
      dataPrevisaoDisponibilidade: string;
    }
  | { tipo: 'carregado_local_atual' }
  | { tipo: 'carregado_data'; localizacaoAtual: string }
  | {
      tipo: 'carregado_local_disponibilidade';
      localizacaoAtual: string;
      dataPrevisaoDisponibilidade: string;
    };

function normalizar(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function ultimaAssistant(historico: Array<{ role: string; content: string }>): string {
  return [...historico].reverse().find((h) => h.role === 'assistant')?.content ?? '';
}

function fluxoJaConcluido(ultimaAssist: string): boolean {
  return /dados atualizados.*boa viagem|boa viagem.*dados atualizados/i.test(ultimaAssist);
}

function perguntouStatus(texto: string): boolean {
  return (
    /vazio ou.*carregado|carregado ou.*vazio/i.test(texto) ||
    /verifica[cç][aã]o de status|como voc[eê] est[aá] agora.*dispon[ií]vel.*onde est[aá]/i.test(texto)
  );
}

function perguntouLocalizacao(texto: string): boolean {
  return /localiza[cç][aã]o|cidade e estado|manda sua localiza/i.test(texto);
}

function perguntouLocalAtualCarregado(texto: string): boolean {
  return /localiza[cç][aã]o atual agora|onde voc[eê] est[aá] agora/i.test(texto);
}

function perguntouData(texto: string): boolean {
  return /liberado para carregar/i.test(texto);
}

function perguntouLocalDisponibilidade(texto: string): boolean {
  return /onde .*vai estar dispon[ií]vel|qual cidade.*vai estar dispon[ií]vel/i.test(texto);
}

function ehAckProativo(mensagem: string): boolean {
  const t = normalizar(mensagem);
  return /^(sim|ok|pode|pode sim|pode ser|manda|manda ver|blz|beleza|pode mandar)[\s!.]*$/.test(t);
}

function ehRespostaAmbiguaStatus(mensagem: string): boolean {
  const t = normalizar(mensagem);
  return /^(sim|ok|t[oô]|t[aá]|pode|beleza|blz|aham)[\s!.]*$/.test(t);
}

function ehVazio(mensagem: string): boolean {
  const t = normalizar(mensagem);
  return (
    /\b(vazio|livre|dispon[ií]vel|to\s+vazio|t[oô]\s+vazio|t[oô]\s+livre)\b/.test(t) &&
    !/\bcarregad/.test(t) &&
    !ehIndisponivel(mensagem)
  );
}

function ehCarregado(mensagem: string): boolean {
  const t = normalizar(mensagem);
  return /\b(carregad|em viagem|to\s+cheio|to\s+carregado|t[oô]\s+carregad|cheio)\b/.test(t);
}

function ehIndisponivel(mensagem: string): boolean {
  const t = normalizar(mensagem);
  return (
    /\b(indispon[ií]vel|sem disponibilidade)\b/.test(t) ||
    /n[aã]o.+dispon[ií]vel/.test(t)
  );
}

function localizacaoVaga(mensagem: string): boolean {
  const t = normalizar(mensagem);
  return (
    /perto do posto|na rodovia|em casa|chegando|aqui na|por aqui|no ped[aá]gio/.test(t) &&
    !extrairLocalizacaoTexto(mensagem)
  );
}

function dataVaga(mensagem: string): boolean {
  const t = normalizar(mensagem);
  return /^(logo|n[aã]o sei|depende|talvez|mais tarde)[\s!.]*$/.test(t) || /^n[aã]o\s+sei/.test(t);
}

const DIAS_SEMANA: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  terça: 2,
  'terca-feira': 2,
  'terça-feira': 2,
  quarta: 3,
  'quarta-feira': 3,
  quinta: 4,
  'quinta-feira': 4,
  sexta: 5,
  'sexta-feira': 5,
  sabado: 6,
  sábado: 6,
  'sabado-feira': 6,
};

/** Converte texto do motorista em data ISO (Brasília), hora padrão 08:00. */
export function parseDataLiberacao(mensagem: string, agora = obterDataHoraBrasilia()): string | null {
  const t = normalizar(mensagem);

  if (dataVaga(mensagem)) return null;

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const hojeParts = fmt.formatToParts(agora);
  const y = Number(hojeParts.find((p) => p.type === 'year')?.value);
  const m = Number(hojeParts.find((p) => p.type === 'month')?.value);
  const d = Number(hojeParts.find((p) => p.type === 'day')?.value);
  const base = new Date(y, m - 1, d);

  if (/\bhoje\b/.test(t)) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} 08:00:00`;
  }
  if (/\bamanh[aã]\b/.test(t)) {
    const amanha = new Date(base);
    amanha.setDate(amanha.getDate() + 1);
    return `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, '0')}-${String(amanha.getDate()).padStart(2, '0')} 08:00:00`;
  }

  for (const [nome, diaSemana] of Object.entries(DIAS_SEMANA)) {
    if (t.includes(nome)) {
      const alvo = new Date(base);
      const atualDow = alvo.getDay();
      let delta = diaSemana - atualDow;
      if (delta <= 0) delta += 7;
      if (/\bque\s+vem\b/.test(t)) delta += 7;
      alvo.setDate(alvo.getDate() + delta);
      return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(alvo.getDate()).padStart(2, '0')} 08:00:00`;
    }
  }

  const dm = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dm) {
    const dia = parseInt(dm[1], 10);
    const mes = parseInt(dm[2], 10);
    let ano = dm[3] ? parseInt(dm[3], 10) : y;
    if (ano < 100) ano += 2000;
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')} 08:00:00`;
    }
  }

  const diaSolto = t.match(/\bdia\s+(\d{1,2})\b/);
  if (diaSolto) {
    const dia = parseInt(diaSolto[1], 10);
    if (dia >= 1 && dia <= 31) {
      const alvo = new Date(base);
      alvo.setDate(dia);
      if (alvo < base) {
        alvo.setMonth(alvo.getMonth() + 1);
        alvo.setDate(dia);
      }
      return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(alvo.getDate()).padStart(2, '0')} 08:00:00`;
    }
  }

  if (/\b(libero|libera|sai[uo]|dispon[ií]vel)\b/.test(t) && t.length > 8) {
    for (const [nome, diaSemana] of Object.entries(DIAS_SEMANA)) {
      if (t.includes(nome)) {
        const alvo = new Date(base);
        const delta = ((diaSemana - alvo.getDay() + 7) % 7) || 7;
        alvo.setDate(alvo.getDate() + delta);
        return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(alvo.getDate()).padStart(2, '0')} 08:00:00`;
      }
    }
  }

  return null;
}

function inferirContexto(
  historico: Array<{ role: string; content: string }>,
  ultimaAssist: string,
  mensagem: string,
): ContextoC7 | null {
  if (fluxoJaConcluido(ultimaAssist)) return null;

  if (perguntouLocalDisponibilidade(ultimaAssist)) {
    const localizacaoAtual = extrairLocalAtualDoHistorico(historico) ?? '';
    const dataPrevisaoDisponibilidade = extrairDataDoHistorico(historico) ?? '';
    return historicoTemStatusIndisponivel(historico)
      ? {
          tipo: 'indisponivel_local_disponibilidade',
          localizacaoAtual,
          dataPrevisaoDisponibilidade,
        }
      : {
          tipo: 'carregado_local_disponibilidade',
          localizacaoAtual,
          dataPrevisaoDisponibilidade,
        };
  }

  if (perguntouData(ultimaAssist)) {
    const localizacaoAtual = extrairLocalAtualDoHistorico(historico) ?? '';
    if (/vai estar dispon[ií]vel|qual cidade.*vai estar dispon[ií]vel/i.test(ultimaAssist)) {
      return {
        tipo: 'indisponivel_local_disponibilidade',
        localizacaoAtual,
        dataPrevisaoDisponibilidade: extrairDataDoHistorico(historico) ?? '',
      };
    }
    const usuarioFalouIndisponivel = historicoTemStatusIndisponivel(historico);
    return usuarioFalouIndisponivel
      ? { tipo: 'indisponivel_data', localizacaoAtual }
      : { tipo: 'carregado_data', localizacaoAtual };
  }

  if (perguntouLocalAtualCarregado(ultimaAssist)) return { tipo: 'carregado_local_atual' };

  if (perguntouLocalizacao(ultimaAssist)) return { tipo: 'vazio_localizacao' };

  if (perguntouStatus(ultimaAssist)) return { tipo: 'aguardando_status' };

  if (GMX_PROATIVA.test(ultimaAssist) && ehAckProativo(mensagem)) return { tipo: 'entrada' };

  const assistentes = historico.filter((h) => h.role === 'assistant');
  const ultimaProativa = [...assistentes].reverse().find((h) => GMX_PROATIVA.test(h.content));
  if (ultimaProativa) {
    const idx = historico.lastIndexOf(ultimaProativa);
    const depois = historico.slice(idx + 1);
    const perguntouDepois = depois.some(
      (h) => h.role === 'assistant' && perguntouStatus(h.content),
    );
    if (!perguntouDepois && ehAckProativo(mensagem)) return { tipo: 'entrada' };
  }

  return null;
}

function extrairLocalAtualDoHistorico(
  historico: Array<{ role: string; content: string }>,
): string | null {
  for (const h of [...historico].reverse()) {
    if (h.role !== 'user') continue;
    const loc = extrairLocalizacaoTexto(h.content);
    if (loc) return loc;
  }
  return null;
}

function extrairDataDoHistorico(historico: Array<{ role: string; content: string }>): string | null {
  for (const h of [...historico].reverse()) {
    if (h.role !== 'user') continue;
    const data = parseDataLiberacao(h.content);
    if (data) return data;
  }
  return null;
}

function historicoTemStatusIndisponivel(historico: Array<{ role: string; content: string }>): boolean {
  return [...historico].reverse().some((h) => h.role === 'user' && ehIndisponivel(h.content));
}

function montarResultado(
  visivel: string,
  ferramenta?: { ferramenta: string; dados: Record<string, unknown> },
  passo = 'ok',
): ResultadoFluxoDisponibilidade {
  const json = ferramenta ? serializarBlocoFerramenta(ferramenta.ferramenta, ferramenta.dados) : '';
  return {
    visivel,
    textoComFerramentas: json ? `${visivel}\n${json}` : visivel,
    passo,
    fragmentar: false,
  };
}

/**
 * Tenta responder pelo fluxo C7 (null = usar LLM).
 */
export async function tentarFluxoDisponibilidade(opts: {
  telefone: string;
  mensagem: string;
  historico: Array<{ role: string; content: string }>;
  itens?: ItemDebounce[];
}): Promise<ResultadoFluxoDisponibilidade | null> {
  const { telefone, mensagem, historico, itens = [] } = opts;
  const msgs = await obterConfigMensagensFluxo();
  const ultimaAssist = ultimaAssistant(historico);

  const estadoRedis = await obterEstadoFluxo<EstadoC7>(telefone);
  let contexto = inferirContexto(historico, ultimaAssist, mensagem);

  if (!contexto && estadoRedis) {
    if (estadoRedis.passo === 'vazio_local') contexto = { tipo: 'vazio_localizacao' };
    if (estadoRedis.passo === 'indisponivel_local_atual') contexto = { tipo: 'indisponivel_local_atual' };
    if (estadoRedis.passo === 'indisponivel_data' && estadoRedis.localizacaoAtual) {
      contexto = { tipo: 'indisponivel_data', localizacaoAtual: estadoRedis.localizacaoAtual };
    }
    if (
      estadoRedis.passo === 'indisponivel_local_disponibilidade' &&
      estadoRedis.localizacaoAtual &&
      estadoRedis.dataPrevisaoDisponibilidade
    ) {
      contexto = {
        tipo: 'indisponivel_local_disponibilidade',
        localizacaoAtual: estadoRedis.localizacaoAtual,
        dataPrevisaoDisponibilidade: estadoRedis.dataPrevisaoDisponibilidade,
      };
    }
    if (estadoRedis.passo === 'carregado_local_atual') contexto = { tipo: 'carregado_local_atual' };
    if (estadoRedis.passo === 'carregado_data' && estadoRedis.localizacaoAtual) {
      contexto = { tipo: 'carregado_data', localizacaoAtual: estadoRedis.localizacaoAtual };
    }
    if (
      estadoRedis.passo === 'carregado_local_disponibilidade' &&
      estadoRedis.localizacaoAtual &&
      estadoRedis.dataPrevisaoDisponibilidade
    ) {
      contexto = {
        tipo: 'carregado_local_disponibilidade',
        localizacaoAtual: estadoRedis.localizacaoAtual,
        dataPrevisaoDisponibilidade: estadoRedis.dataPrevisaoDisponibilidade,
      };
    }
    if (estadoRedis.passo === 'status') contexto = { tipo: 'aguardando_status' };
  }

  if (!contexto) return null;

  if (contexto.tipo === 'entrada') {
    await salvarEstadoFluxo(telefone, { passo: 'status' } satisfies EstadoC7);
    return montarResultado(msgs.c7_pergunta_status, undefined, 'pergunta_status');
  }

  if (contexto.tipo === 'aguardando_status') {
    if (
      ehRespostaAmbiguaStatus(mensagem) ||
      (!ehVazio(mensagem) && !ehCarregado(mensagem) && !ehIndisponivel(mensagem))
    ) {
      return montarResultado(msgs.c7_duvida_status, undefined, 'duvida_status');
    }
    if (ehVazio(mensagem)) {
      await salvarEstadoFluxo(telefone, { passo: 'vazio_local' } satisfies EstadoC7);
      return montarResultado(msgs.c7_pede_localizacao, undefined, 'pede_local');
    }
    if (ehIndisponivel(mensagem)) {
      const localizacaoAtual = extrairLocalizacaoTexto(mensagem);
      if (localizacaoAtual && !localizacaoVaga(mensagem)) {
        await salvarEstadoFluxo(
          telefone,
          { passo: 'indisponivel_data', localizacaoAtual } satisfies EstadoC7,
        );
        return montarResultado(msgs.c7_pergunta_data, undefined, 'pede_data_indisponivel');
      }
      await salvarEstadoFluxo(telefone, { passo: 'indisponivel_local_atual' } satisfies EstadoC7);
      return montarResultado(msgs.c7_pede_localizacao, undefined, 'pede_local_indisponivel');
    }
    if (ehCarregado(mensagem)) {
      await salvarEstadoFluxo(telefone, { passo: 'carregado_local_atual' } satisfies EstadoC7);
      return montarResultado(msgs.c7_pergunta_local_atual_carregado, undefined, 'pede_local_atual');
    }
  }

  if (contexto.tipo === 'vazio_localizacao') {
    if (localizacaoVaga(mensagem)) {
      return montarResultado(msgs.c7_local_invalida, undefined, 'local_invalida');
    }

    const coords = extrairGpsDosItens(mensagem, itens);
    if (coords) {
      const resolvido = await resolverCidadePorGps(coords);
      if (resolvido) {
        await limparEstadoFluxo(telefone);
        return montarResultado(
          msgs.c7_fechamento,
          {
            ferramenta: 'registrar_disponibilidade',
            dados: {
              disponivel: true,
              status: 'disponivel',
              localizacao_atual: resolvido.localizacao,
              latitude: resolvido.latitude,
              longitude: resolvido.longitude,
              telefone,
            },
          },
          'vazio_gps_concluido',
        );
      }
    }

    const local = extrairLocalizacaoTexto(mensagem);
    if (!local) {
      return montarResultado(msgs.c7_local_invalida, undefined, 'local_invalida');
    }
    await limparEstadoFluxo(telefone);
    return montarResultado(
      msgs.c7_fechamento,
      {
        ferramenta: 'registrar_disponibilidade',
        dados: {
          disponivel: true,
          status: 'disponivel',
          localizacao_atual: local,
          telefone,
        },
      },
      'vazio_concluido',
    );
  }

  if (contexto.tipo === 'indisponivel_local_atual') {
    const localizacaoAtual = extrairLocalizacaoTexto(mensagem);
    if (!localizacaoAtual || localizacaoVaga(mensagem)) {
      return montarResultado(msgs.c7_local_invalida, undefined, 'local_indisponivel_invalida');
    }
    await salvarEstadoFluxo(
      telefone,
      { passo: 'indisponivel_data', localizacaoAtual } satisfies EstadoC7,
    );
    return montarResultado(msgs.c7_pergunta_data, undefined, 'pede_data_indisponivel');
  }

  if (contexto.tipo === 'indisponivel_data') {
    if (dataVaga(mensagem)) {
      return montarResultado(msgs.c7_data_vaga, undefined, 'data_indisponivel_vaga');
    }
    const dataIso = parseDataLiberacao(mensagem);
    if (!dataIso) {
      return montarResultado(msgs.c7_data_vaga, undefined, 'data_indisponivel_invalida');
    }
    await salvarEstadoFluxo(
      telefone,
      {
        passo: 'indisponivel_local_disponibilidade',
        localizacaoAtual: contexto.localizacaoAtual,
        dataPrevisaoDisponibilidade: dataIso,
      } satisfies EstadoC7,
    );
    return montarResultado(
      msgs.c7_pergunta_local_disponibilidade,
      undefined,
      'pede_local_disponibilidade_indisponivel',
    );
  }

  if (contexto.tipo === 'indisponivel_local_disponibilidade') {
    const localDisponibilidade = extrairLocalizacaoTexto(mensagem);
    if (!localDisponibilidade || localizacaoVaga(mensagem)) {
      return montarResultado(
        msgs.c7_pergunta_local_disponibilidade,
        undefined,
        'local_disponibilidade_indisponivel_invalida',
      );
    }
    await limparEstadoFluxo(telefone);
    return montarResultado(
      msgs.c7_fechamento,
      {
        ferramenta: 'registrar_disponibilidade',
        dados: {
          disponivel: false,
          status: 'indisponivel',
          localizacao_atual: contexto.localizacaoAtual,
          local_disponibilidade: localDisponibilidade,
          data_previsao_disponibilidade: contexto.dataPrevisaoDisponibilidade,
          telefone,
        },
      },
      'indisponivel_concluido',
    );
  }

  if (contexto.tipo === 'carregado_local_atual') {
    const localizacaoAtual = extrairLocalizacaoTexto(mensagem);
    if (!localizacaoAtual || localizacaoVaga(mensagem)) {
      return montarResultado(msgs.c7_local_invalida, undefined, 'local_atual_invalida');
    }
    await salvarEstadoFluxo(
      telefone,
      { passo: 'carregado_data', localizacaoAtual } satisfies EstadoC7,
    );
    return montarResultado(msgs.c7_pergunta_data, undefined, 'pede_data');
  }

  if (contexto.tipo === 'carregado_data') {
    if (dataVaga(mensagem)) {
      return montarResultado(msgs.c7_data_vaga, undefined, 'data_vaga');
    }
    const dataIso = parseDataLiberacao(mensagem);
    if (!dataIso) {
      return montarResultado(msgs.c7_data_vaga, undefined, 'data_invalida');
    }
    await salvarEstadoFluxo(
      telefone,
      {
        passo: 'carregado_local_disponibilidade',
        localizacaoAtual: contexto.localizacaoAtual,
        dataPrevisaoDisponibilidade: dataIso,
      } satisfies EstadoC7,
    );
    return montarResultado(
      msgs.c7_pergunta_local_disponibilidade,
      undefined,
      'pede_local_disponibilidade',
    );
  }

  if (contexto.tipo === 'carregado_local_disponibilidade') {
    const localDisponibilidade = extrairLocalizacaoTexto(mensagem);
    if (!localDisponibilidade || localizacaoVaga(mensagem)) {
      return montarResultado(
        msgs.c7_pergunta_local_disponibilidade,
        undefined,
        'local_disponibilidade_invalida',
      );
    }
    await limparEstadoFluxo(telefone);
    return montarResultado(
      msgs.c7_fechamento,
      {
        ferramenta: 'registrar_disponibilidade',
        dados: {
          disponivel: false,
          status: 'carregado',
          localizacao_atual: contexto.localizacaoAtual,
          local_disponibilidade: localDisponibilidade,
          data_previsao_disponibilidade: contexto.dataPrevisaoDisponibilidade,
          telefone,
        },
      },
      'carregado_concluido',
    );
  }

  return null;
}

/** Indica se o histórico está em fluxo C7 ativo (para roteador futuro). */
export function estaEmFluxoDisponibilidade(
  historico: Array<{ role: string; content: string }>,
): boolean {
  const u = ultimaAssistant(historico);
  if (fluxoJaConcluido(u)) return false;
  return (
    perguntouStatus(u) ||
    perguntouLocalizacao(u) ||
    perguntouLocalAtualCarregado(u) ||
    perguntouData(u) ||
    perguntouLocalDisponibilidade(u) ||
    GMX_PROATIVA.test(u)
  );
}
