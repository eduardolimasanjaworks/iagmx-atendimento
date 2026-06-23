/**
 * Atualização de documentos por motorista já cadastrado (fora do fluxo sequencial C8).
 */
import type { ItemDebounce } from '../tipos/evolution.js';
import type { PassoCadastro } from './fluxo-cadastro.js';
import { serializarBlocoFerramenta } from './ferramentas.js';
import { buscarMotoristaPorTelefone } from './motorista-gmx.js';
import { limparEstadoFluxo, obterEstadoFluxo, salvarEstadoFluxo } from './estado-fluxo-redis.js';
import { classificarDocumentoPorOcr } from '../util/classificar-documento-ocr.js';
import { extrairCorpoOcr, textoOcrValido, ehRecusaOcr, motivoOcrInvalido } from '../util/ocr-qualidade.js';
import { reextrairTextoMidia, formatarConteudoOcr } from '../servicos/ocr-reextrair.js';
import {
  montarRespostaConfirmacaoOcr,
  montarRespostaConfirmada,
  montarRespostaDocumentoSalvo,
  obterMensagemAtualizacaoConfirmacaoNegada,
  obterMensagemAtualizacaoFotoIlegivel,
  obterMensagemAtualizacaoOcrRecusa,
  obterMensagemAtualizacaoPedirFoto,
  obterMensagemAtualizacaoTipoIncerto,
  obterMensagemAtualizacaoTipoIncertoComTexto,
} from '../util/resposta-ocr-humana.js';
import { obterConfigMensagensFluxo } from './config-mensagens-fluxo.js';

export interface ResultadoAtualizacaoDoc {
  textoComFerramentas: string;
  visivel: string;
  passo: string;
  fragmentar?: boolean;
}

interface EstadoAtualizacao {
  modo: 'atualizacao';
  tipo?: PassoCadastro;
  aguardandoConfirmacao?: boolean;
  midiaIdPendente?: string;
  resumoOcr?: string;
  textoOcr?: string;
  camposOcr?: Record<string, string>;
  tentativasOcrFalha?: number;
}

const ENTRADA_ATUALIZAR =
  /atualiz|trocar|renovar|mandar de novo|nova cnh|novo crlv|novo antt|atualizar documento|trocar documento|documento vencid|cnh vencid/i;

const EXCLUIR_DADOS_CADASTRO =
  /atualizar (meus )?dados|alterar (meus )?dados|mudar (minha )?cidade|trocar carroceria|atualizar (meu )?pix|atualizar cadastro|carreta|reboque/i;

const TIPO_OCR: Record<PassoCadastro, string> = {
  cnh: 'cnh',
  crlv: 'crlv',
  antt: 'antt',
  endereco: 'endereco',
  caminhao: 'foto',
};

function normalizar(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function extrairMidiaId(itens: ItemDebounce[]): string | undefined {
  for (const i of itens) {
    if ((i.tipo === 'imagem' || i.tipo === 'documento') && i.midiaId) {
      return i.midiaId;
    }
  }
  return undefined;
}

function detectarTipoTexto(mensagem: string): PassoCadastro | null {
  const t = normalizar(mensagem);
  if (/\bcnh\b/.test(t)) return 'cnh';
  if (/\bcrlv\b/.test(t)) return 'crlv';
  if (/\bantt\b/.test(t)) return 'antt';
  if (/comprovante|endere[cç]o/.test(t)) return 'endereco';
  if (/caminh[aã]o|cavalo|foto do caminh/.test(t)) return 'caminhao';
  return null;
}

function ehConfirmacao(mensagem: string): boolean {
  return /^(sim|confirmo|confirma|isso|é isso|e isso|pode ser|correto|ok|certo|exato)[\s!.]*$/i.test(
    mensagem.trim(),
  );
}

function ehNegacao(mensagem: string): boolean {
  return /^(n[aã]o|nao|negativo|errado|não é)[\s!.]*$/i.test(mensagem.trim());
}

function montarResultado(
  visivel: string,
  ferramentas: Array<{ ferramenta: string; dados: Record<string, unknown> }> = [],
  passo = 'ok',
  fragmentar = true,
): ResultadoAtualizacaoDoc {
  const blocos = ferramentas.map((f) => serializarBlocoFerramenta(f.ferramenta, f.dados));
  return {
    visivel,
    textoComFerramentas: blocos.length ? `${visivel}\n${blocos.join('\n')}` : visivel,
    passo,
    fragmentar,
  };
}

function ultimaAssistant(historico: Array<{ role: string; content: string }>): string {
  return [...historico].reverse().find((h) => h.role === 'assistant')?.content ?? '';
}

function tipoDoReprompt(ultimaAssist: string): PassoCadastro | null {
  const marcadores: Record<PassoCadastro, RegExp> = {
    cnh: /CNH atualizada/i,
    crlv: /CRLV atualizado/i,
    antt: /ANTT atualizada|ANTT atualizado/i,
    endereco: /comprovante de endere[cç]o atualizado/i,
    caminhao: /caminh[aã]o \(cavalo\) atualizada|caminh[aã]o \(cavalo\) atualizado/i,
  };
  for (const tipo of Object.keys(marcadores) as PassoCadastro[]) {
    if (marcadores[tipo].test(ultimaAssist)) return tipo;
  }
  return null;
}

function aguardandoConfirmacaoOcr(ultimaAssist: string): boolean {
  return /confirma pra mim se é isso|confirma se é isso que você quer atualizar/i.test(ultimaAssist);
}

export function estaEmAtualizacaoDocumento(
  historico: Array<{ role: string; content: string }>,
  ultimaAssistantMsg?: string,
): boolean {
  const u = ultimaAssistantMsg ?? ultimaAssistant(historico);
  return (
    /manda a foto do documento que quer atualizar/i.test(u) ||
    tipoDoReprompt(u) !== null ||
    aguardandoConfirmacaoOcr(u)
  );
}

function gravarDocumento(
  tipo: PassoCadastro,
  midiaId: string,
  telefone: string,
  textoOcr?: string,
): Array<{ ferramenta: string; dados: Record<string, unknown> }> {
  return [
    {
      ferramenta: 'grava_ocr',
      dados: {
        tipo: TIPO_OCR[tipo],
        midia_id: midiaId,
        telefone,
        ...(textoOcr ? { texto_extraido: textoOcr } : {}),
      },
    },
  ];
}

async function processarMidiaComOcr(opts: {
  telefone: string;
  mensagem: string;
  midiaId: string;
  tipoForcado?: PassoCadastro | null;
  tentativasFalha?: number;
}): Promise<ResultadoAtualizacaoDoc> {
  const { telefone, mensagem, midiaId, tipoForcado, tentativasFalha = 0 } = opts;
  const msgs = await obterConfigMensagensFluxo();

  let conteudoOcr = mensagem;
  if (!textoOcrValido(conteudoOcr) || ehRecusaOcr(conteudoOcr)) {
    const reocr = await reextrairTextoMidia(midiaId);
    if (reocr) conteudoOcr = formatarConteudoOcr(reocr);
  }

  if (!textoOcrValido(conteudoOcr)) {
    const motivo = motivoOcrInvalido(conteudoOcr);
    const proxTentativas = tentativasFalha + 1;
    if (motivo === 'recusa_modelo' || proxTentativas >= 2) {
      await salvarEstadoFluxo(telefone, {
        modo: 'atualizacao',
        tentativasOcrFalha: proxTentativas,
      } satisfies EstadoAtualizacao);
      return montarResultado(
        proxTentativas >= 2
          ? 'Tô com dificuldade técnica pra ler essa imagem, vou acionar a equipe pra te ajudar com o documento'
          : await obterMensagemAtualizacaoOcrRecusa(),
        [],
        proxTentativas >= 2 ? 'ocr_escalonar' : 'ocr_recusa',
      );
    }
    return montarResultado(await obterMensagemAtualizacaoFotoIlegivel(), [], 'ocr_ilegivel');
  }

  const textoOcr = extrairCorpoOcr(conteudoOcr);
  const classificacao = classificarDocumentoPorOcr(conteudoOcr);
  const tipo = tipoForcado ?? classificacao.tipo;

  if (!tipo) {
    const trecho = textoOcr.replace(/\s+/g, ' ').trim().slice(0, 90);
    const visivel =
      trecho.length > 30
        ? await obterMensagemAtualizacaoTipoIncertoComTexto(trecho)
        : await obterMensagemAtualizacaoTipoIncerto();
    return montarResultado(visivel, [], 'ocr_tipo_incerto');
  }

  // Confiança baixa — mostra o que leu e pede confirmação (uma vez)
  if (!tipoForcado && classificacao.confianca < 0.55) {
    const visivel = await montarRespostaConfirmacaoOcr({
      tipo,
      campos: classificacao.campos,
      telefone,
    });
    await salvarEstadoFluxo(telefone, {
      modo: 'atualizacao',
      tipo,
      aguardandoConfirmacao: true,
      midiaIdPendente: midiaId,
      resumoOcr: classificacao.resumo,
      textoOcr,
      camposOcr: classificacao.campos,
    } satisfies EstadoAtualizacao);
    return montarResultado(visivel, [], 'ocr_confirmacao');
  }

  await limparEstadoFluxo(telefone);
  const visivel = await montarRespostaDocumentoSalvo({
    tipo,
    campos: classificacao.campos,
    telefone,
  });
  return montarResultado(
    visivel,
    gravarDocumento(tipo, midiaId, telefone, textoOcr),
    `atualizacao_${tipo}_ok`,
  );
}

/**
 * Atualização avulsa de documento (motorista já no ERP).
 */
export async function tentarAtualizacaoDocumento(opts: {
  telefone: string;
  mensagem: string;
  historico: Array<{ role: string; content: string }>;
  itens?: ItemDebounce[];
}): Promise<ResultadoAtualizacaoDoc | null> {
  const { telefone, mensagem, historico, itens = [] } = opts;
  const msgs = await obterConfigMensagensFluxo();
  const motorista = await buscarMotoristaPorTelefone(telefone);
  if (!motorista) return null;

  const estadoRaw = await obterEstadoFluxo<EstadoAtualizacao>(telefone);
  const estado = estadoRaw?.modo === 'atualizacao' ? estadoRaw : null;
  const ultimaAssist = ultimaAssistant(historico);
  const midiaId = extrairMidiaId(itens);
  const tNorm = normalizar(mensagem);

  if (EXCLUIR_DADOS_CADASTRO.test(tNorm)) return null;

  // Confirmação pendente após OCR incerto
  if (estado?.aguardandoConfirmacao && estado.midiaIdPendente && estado.tipo) {
    if (ehConfirmacao(mensagem)) {
      await limparEstadoFluxo(telefone);
      const visivel = await montarRespostaConfirmada({
        tipo: estado.tipo,
        campos: estado.camposOcr ?? {},
      });
      return montarResultado(
        visivel,
        gravarDocumento(
          estado.tipo,
          estado.midiaIdPendente,
          telefone,
          estado.textoOcr,
        ),
        `atualizacao_${estado.tipo}_confirmada`,
      );
    }
    if (ehNegacao(mensagem)) {
      await limparEstadoFluxo(telefone);
      return montarResultado(await obterMensagemAtualizacaoConfirmacaoNegada(), [], 'ocr_confirmacao_negada');
    }
  }

  const entrada = ENTRADA_ATUALIZAR.test(tNorm);
  const tipoTexto = detectarTipoTexto(mensagem);
  const tipoReprompt = tipoDoReprompt(ultimaAssist);
  const emFluxo =
    entrada || tipoTexto || tipoReprompt || estado?.tipo || aguardandoConfirmacaoOcr(ultimaAssist);

  // Foto solta — OCR identifica e prova o que leu (sem menu CNH/CRLV)
  if (midiaId && !tipoReprompt && !estado?.tipo && !tipoTexto) {
    return processarMidiaComOcr({
      telefone,
      mensagem,
      midiaId,
      tentativasFalha: estado?.tentativasOcrFalha ?? 0,
    });
  }

  if (!emFluxo && !(midiaId && tipoTexto)) return null;

  let tipo = estado?.tipo ?? tipoTexto ?? tipoReprompt;

  if (!tipo && entrada) {
    if (tipoTexto) {
      tipo = tipoTexto;
    } else {
      return montarResultado(await obterMensagemAtualizacaoPedirFoto(), [], 'atualizacao_pedir_foto');
    }
  }

  if (!tipo) return null;

  if (!midiaId) {
    const reprompts: Record<PassoCadastro, string> = {
      cnh: msgs.atualizacao_reprompt_cnh,
      crlv: msgs.atualizacao_reprompt_crlv,
      antt: msgs.atualizacao_reprompt_antt,
      endereco: msgs.atualizacao_reprompt_endereco,
      caminhao: msgs.atualizacao_reprompt_caminhao,
    };
    await salvarEstadoFluxo(telefone, { modo: 'atualizacao', tipo } satisfies EstadoAtualizacao);
    return montarResultado(reprompts[tipo], [], `atualizacao_reprompt_${tipo}`);
  }

  return processarMidiaComOcr({ telefone, mensagem, midiaId, tipoForcado: tipo });
}
