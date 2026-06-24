/**
 * Roteador de intenção — decide silêncio, fluxos programáticos ou LLM.
 */
import { mensagemObviamenteEncerramento } from '../util/mensagem-encerramento.js';
import { tentarRespostaEntradaConfusa } from '../util/entrada-confusa.js';
import { tentarFluxoDisponibilidade, estaEmFluxoDisponibilidade } from './fluxo-disponibilidade.js';
import { tentarFluxoCadastro, estaEmFluxoCadastro } from './fluxo-cadastro.js';
import {
  tentarAtualizacaoDocumento,
  estaEmAtualizacaoDocumento,
} from './fluxo-atualizar-documento.js';
import { tentarAtualizacaoDados, estaEmAtualizacaoDados } from './fluxo-atualizar-dados.js';
import { tentarFluxoCarreta, estaEmFluxoCarreta } from './fluxo-carreta.js';
import { tentarFluxoCanhoto } from './fluxo-canhoto.js';
import { tentarFluxoNegociacao } from './fluxo-negociacao.js';
import { tentarConsultaDocumentos } from './consulta-documentos.js';
import type { ItemDebounce } from '../tipos/evolution.js';
import { extrairOfertaGmX } from './ferramentas-contexto.js';
import { avaliarSeDeveResponder } from './linguagem-motorista-runtime.js';

export type IntencaoRoteada =
  | 'silencio'
  | 'disponibilidade'
  | 'menu'
  | 'cadastro'
  | 'pagamento'
  | 'oferta'
  | 'llm';

export type ResultadoRoteador =
  | { tipo: 'silencio'; motivo: string; intencao: 'silencio' }
  | {
      tipo: 'programatico';
      intencao: IntencaoRoteada;
      resposta: string;
      textoComFerramentas: string;
      fragmentar?: boolean;
      passo?: string;
      executarFerramentas: boolean;
    }
  | {
      tipo: 'llm';
      intencao: 'oferta' | 'cadastro' | 'llm';
      cenario?: number;
    };

const PERGUNTA_PAGAMENTO =
  /^(pagamento|quando\s+paga|como\s+paga|adiantamento|quanto\s+tempo\s+paga)/i;

const RESPOSTA_PAGAMENTO =
  'Pagamos 90% adiantado e 10% na entrega, mais alguma coisa?';

function normalizar(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function ehSaudacaoOuConfusao(mensagem: string): boolean {
  const t = normalizar(mensagem);
  if (!t) return false;
  if (
    /^(oi|olá|ola|bom dia|boa tarde|boa noite|eae|e aí|e ai|fala|opa|hey|salve|blz|beleza|show|tmj|fechou|certo|tranquilo|ok|valeu)[\s!.?]*$/i.test(
      t,
    )
  ) {
    return true;
  }
  return /n[aã]o entendi|n[aã]o peguei|como assim|que isso|explique|n[aã]o ficou claro/i.test(t);
}

function temOfertaAtiva(historico: Array<{ role: string; content: string }>): boolean {
  return extrairOfertaGmX(historico) !== null;
}

function respostaProgramatica(
  intencao: IntencaoRoteada,
  r: { visivel: string; textoComFerramentas?: string; passo: string; fragmentar?: boolean },
): ResultadoRoteador {
  const texto = r.textoComFerramentas ?? r.visivel ?? '';
  return {
    tipo: 'programatico',
    intencao,
    resposta: r.visivel,
    textoComFerramentas: texto,
    fragmentar: r.fragmentar,
    passo: r.passo,
    executarFerramentas: texto.includes('{"ferramenta"'),
  };
}

/**
 * Roteia mensagem do motorista antes de chamar o LLM.
 */
export async function rotearMensagem(opts: {
  telefone: string;
  mensagem: string;
  historico: Array<{ role: string; content: string }>;
  ultimaAssistant?: string;
  itens?: ItemDebounce[];
  nomeContato?: string;
}): Promise<ResultadoRoteador> {
  const { telefone, mensagem, historico, ultimaAssistant, itens = [] } = opts;
  const emC7 = estaEmFluxoDisponibilidade(historico);

  const emFluxoInterno =
    estaEmFluxoCadastro(historico, ultimaAssistant) ||
    estaEmAtualizacaoDocumento(historico, ultimaAssistant) ||
    estaEmAtualizacaoDados(historico, ultimaAssistant) ||
    estaEmFluxoCarreta(historico, ultimaAssistant);

  const silencioRapido = mensagemObviamenteEncerramento(mensagem, ultimaAssistant);
  if (silencioRapido.encerrar) {
    return {
      tipo: 'silencio',
      motivo: silencioRapido.motivo ?? 'encerramento',
      intencao: 'silencio',
    };
  }

  if (emC7 || /atualizando nossa base de parceiros/i.test(ultimaAssistant ?? '')) {
    const fluxo = await tentarFluxoDisponibilidade({
      telefone,
      mensagem,
      historico,
      itens,
    });
    if (fluxo) return respostaProgramatica('disponibilidade', fluxo);
  }

  if (!emC7 && !emFluxoInterno) {
    const temMidia = itens.some((i) => Boolean(i.midiaId) || i.tipo !== 'texto');
    const confusa = tentarRespostaEntradaConfusa(mensagem, {
      ultimaAssistant,
      historico,
      emFluxoAtivo: emFluxoInterno,
      temMidia,
    });
    if (confusa) {
      return respostaProgramatica('menu', {
        visivel: confusa,
        textoComFerramentas: confusa,
        passo: 'entrada_confusa',
      });
    }
  }

  const silencio = await avaliarSeDeveResponder(mensagem, ultimaAssistant);
  if (silencio.encerrar) {
    return {
      tipo: 'silencio',
      motivo: silencio.motivo ?? 'encerramento',
      intencao: 'silencio',
    };
  }

  const atualizacaoDados = await tentarAtualizacaoDados({ telefone, mensagem, historico });
  if (atualizacaoDados) return respostaProgramatica('cadastro', atualizacaoDados);

  const carreta = await tentarFluxoCarreta({ telefone, mensagem, historico, itens });
  if (carreta) return respostaProgramatica('cadastro', carreta);

  const atualizacaoDoc = await tentarAtualizacaoDocumento({
    telefone,
    mensagem,
    historico,
    itens,
  });
  if (atualizacaoDoc) return respostaProgramatica('cadastro', atualizacaoDoc);

  const fluxoCadastro = await tentarFluxoCadastro({
    telefone,
    mensagem,
    historico,
    itens,
  });
  if (fluxoCadastro) return respostaProgramatica('cadastro', fluxoCadastro);

  const canhoto = await tentarFluxoCanhoto({ telefone, mensagem, historico, itens });
  if (canhoto) return respostaProgramatica('cadastro', canhoto);

  const consultaDocumentos = await tentarConsultaDocumentos({ telefone, mensagem });
  if (consultaDocumentos) return respostaProgramatica('cadastro', consultaDocumentos);

  if (PERGUNTA_PAGAMENTO.test(mensagem) && !temOfertaAtiva(historico)) {
    return respostaProgramatica('pagamento', {
      visivel: RESPOSTA_PAGAMENTO,
      textoComFerramentas: RESPOSTA_PAGAMENTO,
      passo: 'pagamento',
    });
  }

  if (temOfertaAtiva(historico)) {
    const negociacao = await tentarFluxoNegociacao({ telefone, mensagem, historico });
    if (negociacao) return respostaProgramatica('oferta', negociacao);
    return { tipo: 'llm', intencao: 'oferta', cenario: 9 };
  }

  if (/cadastr|cnh|crlv|documento|antt/i.test(mensagem)) {
    return { tipo: 'llm', intencao: 'cadastro', cenario: 8 };
  }

  if (!emC7 && !emFluxoInterno && ehSaudacaoOuConfusao(mensagem)) {
    return { tipo: 'llm', intencao: 'llm', cenario: 6 };
  }

  return { tipo: 'llm', intencao: 'llm' };
}
