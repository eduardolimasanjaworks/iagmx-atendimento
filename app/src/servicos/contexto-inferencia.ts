/**
 * Monta o prompt de sistema completo para cada inferência (motorista + horário + ferramentas).
 */
import { obterPromptParaInferencia } from './prompt.js';
import { instrucoesFerramentas } from './ferramentas.js';
import { montarContextoErpCompleto } from './contexto-erp-motorista.js';
import { obterContextoHorarioBrasilia } from '../util/horario-brasilia.js';
import { contextoLinguagemMotoristaParaPrompt } from './linguagem-motorista-runtime.js';

export interface OpcoesPromptInferencia {
  telefone: string;
  nomeContato?: string;
  /** Texto da mensagem atual (RAG linguagem) */
  mensagemUsuario?: string;
  historico?: Array<{ role: string; content: string }>;
  memoriaConversa?: string;
  anexosLote?: string;
  promptBase?: string;
}

const REGRA_MOTORISTA = `=== REGRA: TODO CONTATO É UM MOTORISTA ===
Trate sempre quem escreve como motorista parceiro GMX. O bloco CONTEXTO ERP GMX abaixo traz cadastro, documentos, embarques ativos, status da viagem (CT-e, canhoto, pagamento), disponibilidade e histórico de ofertas — use SEMPRE esses dados. O trecho CONTEXTO FIXADO DE PRIORIDADE deve ser seguido literalmente: se houver documento mínimo pendente, a prioridade da conversa é cobrar esse documento antes de avançar para oferta, negociação ou qualquer outro assunto operacional. Não invente carga, valor, localização ou status. Se o motorista enviar nova foto de documento, confirme e oriente o fluxo de atualização.`;

/**
 * Prompt de sistema usado em TODA geração de resposta ao motorista.
 */
export async function montarPromptSistemaInferencia(
  opts: OpcoesPromptInferencia,
): Promise<string> {
  const partes: string[] = [];

  const promptBase =
    opts.promptBase ?? (await obterPromptParaInferencia(opts.mensagemUsuario ?? ''));
  partes.push(promptBase);
  partes.push(REGRA_MOTORISTA);
  partes.push(obterContextoHorarioBrasilia());
  partes.push(await montarContextoErpCompleto(opts.telefone, opts.nomeContato));
  partes.push(instrucoesFerramentas());

  if (opts.mensagemUsuario?.trim()) {
    const refLinguagem = await contextoLinguagemMotoristaParaPrompt(opts.mensagemUsuario);
    if (refLinguagem) partes.push(refLinguagem);
  }

  if (opts.memoriaConversa?.trim()) {
    partes.push(opts.memoriaConversa.trim());
  }

  if (opts.anexosLote) {
    partes.push(`ANEXOS NESTE LOTE: ${opts.anexosLote}`);
  }

  return partes.filter(Boolean).join('\n\n');
}
