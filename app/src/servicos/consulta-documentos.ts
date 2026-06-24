/**
 * Consulta programatica de documentos pendentes do motorista.
 * Responde de forma objetiva com base no ERP, sem cair no LLM.
 * Evita escalonamento humano para perguntas simples de cadastro.
 */
import {
  obterDocumentosDetalhadosMotorista,
  type DocumentoMotoristaContexto,
} from './contexto-erp-documentos.js';
import { buscarMotoristaPorTelefone } from './motorista-gmx.js';

export interface ResultadoConsultaDocumentos {
  textoComFerramentas: string;
  visivel: string;
  passo: string;
  fragmentar: false;
}

const PADROES_CONSULTA_DOCUMENTOS = [
  /quais?\s+(?:documentos?|docs?)\s+(?:est[aã]o\s+)?(?:faltando|faltam|pendentes?)/i,
  /que\s+(?:documentos?|docs?)\s+(?:faltam|faltando|pendentes?)/i,
  /o\s+que\s+falta\s+no\s+(?:meu\s+)?cadastro/i,
  /meu\s+cadastro.*(?:faltando|faltam|pendentes?)/i,
  /(?:documentos?|docs?)\s+pendentes?/i,
];

function formatarDataCurta(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function resumirPendencia(item: DocumentoMotoristaContexto): string {
  const faltas = item.pendencias.length ? item.pendencias.join(', ') : 'nenhuma';
  if (item.atualizadoEm && item.atualizadoEm !== '—') {
    return `${item.label} (${faltas}; atualizado ${item.atualizadoEm})`;
  }
  return `${item.label} (${faltas})`;
}

export function ehConsultaDocumentosParaTeste(mensagem: string): boolean {
  const texto = String(mensagem || '').trim();
  return PADROES_CONSULTA_DOCUMENTOS.some((regex) => regex.test(texto));
}

export function montarRespostaConsultaDocumentosParaTeste(
  docs: DocumentoMotoristaContexto[],
  motoristaEncontrado: boolean,
): string {
  if (!motoristaEncontrado) {
    return [
      'Ainda nao achei seu telefone vinculado ao cadastro da GMX.',
      'Pra iniciar, preciso de: CNH, CRLV do cavalo, ANTT do cavalo e comprovante de endereco.',
      'Pode mandar foto ou PDF por aqui.',
    ].join(' ');
  }

  const obrigatoriosPendentes = docs.filter((item) => item.obrigatorio && item.pendencias.length > 0);
  const opcionaisPendentes = docs.filter((item) => !item.obrigatorio && item.pendencias.length > 0);

  if (obrigatoriosPendentes.length === 0 && opcionaisPendentes.length === 0) {
    return 'No seu cadastro nao falta nenhum documento no momento.';
  }

  const partes: string[] = [];
  if (obrigatoriosPendentes.length > 0) {
    partes.push(
      `Hoje faltam estes documentos obrigatorios: ${obrigatoriosPendentes.map(resumirPendencia).join('; ')}.`,
    );
  } else {
    partes.push('Os documentos obrigatorios estao completos no seu cadastro.');
  }

  if (opcionaisPendentes.length > 0) {
    partes.push(
      `Pendencias complementares: ${opcionaisPendentes.map(resumirPendencia).join('; ')}.`,
    );
  }

  partes.push('Pode mandar foto ou PDF por aqui que eu atualizo.');
  return partes.join(' ');
}

function montarResultado(visivel: string, passo: string): ResultadoConsultaDocumentos {
  return {
    visivel,
    textoComFerramentas: visivel,
    passo,
    fragmentar: false,
  };
}

export async function tentarConsultaDocumentos(opts: {
  telefone: string;
  mensagem: string;
}): Promise<ResultadoConsultaDocumentos | null> {
  if (!ehConsultaDocumentosParaTeste(opts.mensagem)) return null;

  const motorista = await buscarMotoristaPorTelefone(opts.telefone);
  if (!motorista) {
    return montarResultado(
      montarRespostaConsultaDocumentosParaTeste([], false),
      'consulta_documentos_sem_motorista',
    );
  }

  const docs = await obterDocumentosDetalhadosMotorista(motorista.id, formatarDataCurta);
  return montarResultado(
    montarRespostaConsultaDocumentosParaTeste(docs, true),
    'consulta_documentos_erp',
  );
}
