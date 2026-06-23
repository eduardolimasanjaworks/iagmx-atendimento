/**
 * Cenário 8 — cadastro de documentos (CNH → CRLV → ANTT → endereço → caminhão), sem LLM.
 */
import type { ItemDebounce } from '../tipos/evolution.js';
import { serializarBlocoFerramenta } from './ferramentas.js';
import { limparEstadoFluxo, obterEstadoFluxo, salvarEstadoFluxo } from './estado-fluxo-redis.js';
import { textoOcrValido } from '../util/ocr-qualidade.js';
import { obterConfigMensagensFluxo } from './config-mensagens-fluxo.js';

export type PassoCadastro = 'cnh' | 'crlv' | 'antt' | 'endereco' | 'caminhao';

const ENTRADA_CADASTRO =
  /^(cadastro|quero\s+(?:atualizar|atualiz)\w*\s+(?:o\s+)?(?:meu\s+)?cadastro|quero\s+cadastr|quero\s+me\s+cadastr|preciso\s+(?:atualizar\s+)?cadastr|fazer\s+cadastro|atualizar\s+(?:o\s+)?(?:meu\s+)?cadastro)/i;

const TIPO_OCR: Record<PassoCadastro, string> = {
  cnh: 'cnh',
  crlv: 'crlv',
  antt: 'antt',
  endereco: 'endereco',
  caminhao: 'foto',
};

const ORDEM: PassoCadastro[] = ['cnh', 'crlv', 'antt', 'endereco', 'caminhao'];

export interface ResultadoFluxoCadastro {
  textoComFerramentas: string;
  visivel: string;
  passo: string;
  fragmentar: false;
}

interface EstadoC8 {
  fluxo: 'c8';
  passo: PassoCadastro;
  tentativasOcr?: Partial<Record<PassoCadastro, number>>;
}

function normalizar(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function ultimaAssistant(historico: Array<{ role: string; content: string }>): string {
  return [...historico].reverse().find((h) => h.role === 'assistant')?.content ?? '';
}

function fluxoConcluido(texto: string): boolean {
  return /cadastro enviado.*an[aá]lise|enviado pra an[aá]lise/i.test(texto);
}

function perguntouDocumento(texto: string, passo: PassoCadastro): boolean {
  const t = texto.toLowerCase();
  switch (passo) {
    case 'cnh':
      return /cnh/.test(t) && /foto|manda|preciso/.test(t);
    case 'crlv':
      return /crlv/.test(t);
    case 'antt':
      return /antt/.test(t);
    case 'endereco':
      return /comprovante|endere[cç]o/.test(t);
    case 'caminhao':
      return /caminh[aã]o|cavalo/.test(t);
    default:
      return false;
  }
}

function proximoPasso(passo: PassoCadastro): PassoCadastro | null {
  const i = ORDEM.indexOf(passo);
  return i >= 0 && i < ORDEM.length - 1 ? ORDEM[i + 1] : null;
}

function extrairMidiaId(itens: ItemDebounce[]): string | undefined {
  for (const i of itens) {
    if ((i.tipo === 'imagem' || i.tipo === 'documento') && i.midiaId) {
      return i.midiaId;
    }
  }
  return undefined;
}

function extrairConteudoMidia(itens: ItemDebounce[]): string | undefined {
  for (const i of [...itens].reverse()) {
    if ((i.tipo === 'imagem' || i.tipo === 'documento') && i.conteudo) {
      return i.conteudo;
    }
  }
  return undefined;
}

function montarResultado(
  visivel: string,
  ferramentas: Array<{ ferramenta: string; dados: Record<string, unknown> }> = [],
  passo = 'ok',
): ResultadoFluxoCadastro {
  const blocos = ferramentas.map((f) => serializarBlocoFerramenta(f.ferramenta, f.dados));
  return {
    visivel,
    textoComFerramentas: blocos.length ? `${visivel}\n${blocos.join('\n')}` : visivel,
    passo,
    fragmentar: false,
  };
}

function inferirPasso(
  ultimaAssist: string,
  mensagem: string,
  estado: EstadoC8 | null,
): PassoCadastro | 'entrada' | null {
  if (fluxoConcluido(ultimaAssist)) return null;

  if (ENTRADA_CADASTRO.test(normalizar(mensagem))) return 'entrada';

  if (estado?.fluxo === 'c8' && estado.passo && ORDEM.includes(estado.passo)) {
    return estado.passo;
  }

  for (const passo of [...ORDEM].reverse()) {
    if (perguntouDocumento(ultimaAssist, passo)) return passo;
  }

  return null;
}

/**
 * Indica fluxo C8 ativo (para roteador — bloqueia menu e evita LLM).
 */
export function estaEmFluxoCadastro(
  historico: Array<{ role: string; content: string }>,
  ultimaAssistantMsg?: string,
): boolean {
  const u = ultimaAssistantMsg ?? ultimaAssistant(historico);
  if (fluxoConcluido(u)) return false;
  return ORDEM.some((p) => perguntouDocumento(u, p));
}

/**
 * Tenta responder pelo fluxo C8 (null = fora do cadastro).
 */
export async function tentarFluxoCadastro(opts: {
  telefone: string;
  mensagem: string;
  historico: Array<{ role: string; content: string }>;
  itens?: ItemDebounce[];
}): Promise<ResultadoFluxoCadastro | null> {
  const { telefone, mensagem, historico, itens = [] } = opts;
  const msgs = await obterConfigMensagensFluxo();
  const ultimaAssist = ultimaAssistant(historico);
  const estado = await obterEstadoFluxo<EstadoC8>(telefone);
  const passoAtual = inferirPasso(ultimaAssist, mensagem, estado);

  if (!passoAtual) return null;

  if (passoAtual === 'entrada') {
    await salvarEstadoFluxo(telefone, { fluxo: 'c8', passo: 'cnh' } satisfies EstadoC8);
    return montarResultado(
      msgs.c8_inicio,
      [
        {
          ferramenta: 'atualizar_motorista',
          dados: { status_cadastro: 'FALTA DOCS', telefone },
        },
      ],
      'cadastro_inicio',
    );
  }

  const midiaId = extrairMidiaId(itens);
  if (!midiaId) {
    const reprompts: Record<PassoCadastro, string> = {
      cnh: msgs.c8_reprompt_cnh,
      crlv: msgs.c8_reprompt_crlv,
      antt: msgs.c8_reprompt_antt,
      endereco: msgs.c8_reprompt_endereco,
      caminhao: msgs.c8_reprompt_caminhao,
    };
    return montarResultado(reprompts[passoAtual], [], `reprompt_${passoAtual}`);
  }

  const conteudoOcr = extrairConteudoMidia(itens);
  if (!textoOcrValido(conteudoOcr)) {
    const tentativas = (estado?.tentativasOcr?.[passoAtual] ?? 0) + 1;
    await salvarEstadoFluxo(telefone, {
      fluxo: 'c8',
      passo: passoAtual,
      tentativasOcr: { ...estado?.tentativasOcr, [passoAtual]: tentativas },
    } satisfies EstadoC8);

    if (tentativas >= 2) {
      await limparEstadoFluxo(telefone);
      return montarResultado(
        msgs.c8_ocr_escalonar,
        [
          {
            ferramenta: 'escalonar_negociacao',
            dados: {
              motivo: 'ocr_ilegivel',
              tipo_documento: TIPO_OCR[passoAtual],
              telefone,
            },
          },
        ],
        'ocr_escalonar',
      );
    }

    return montarResultado(msgs.c8_ocr_ilegivel, [], `ocr_reprompt_${passoAtual}`);
  }

  if (passoAtual === 'caminhao') {
    await limparEstadoFluxo(telefone);
    return montarResultado(
      msgs.c8_fechamento,
      [
        {
          ferramenta: 'grava_ocr',
          dados: { tipo: TIPO_OCR.caminhao, midia_id: midiaId, telefone },
        },
        {
          ferramenta: 'atualizar_motorista',
          dados: { status_cadastro: 'AGUARDANDO VALIDACAO', telefone },
        },
      ],
      'cadastro_concluido',
    );
  }

  const proximo = proximoPasso(passoAtual)!;
  await salvarEstadoFluxo(telefone, { fluxo: 'c8', passo: proximo } satisfies EstadoC8);
  const confirmacoes: Record<Exclude<PassoCadastro, 'caminhao'>, string> = {
    cnh: msgs.c8_confirmacao_cnh,
    crlv: msgs.c8_confirmacao_crlv,
    antt: msgs.c8_confirmacao_antt,
    endereco: msgs.c8_confirmacao_endereco,
  };
  return montarResultado(
    confirmacoes[passoAtual],
    [
      {
        ferramenta: 'grava_ocr',
        dados: { tipo: TIPO_OCR[passoAtual], midia_id: midiaId, telefone },
      },
    ],
    `${passoAtual}_ok`,
  );
}
