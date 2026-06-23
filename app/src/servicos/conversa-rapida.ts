/**
 * Uma chamada ao LLM — conversa natural (saudação, dúvidas gerais).
 * Evita o pipeline de 5+ passadas que atrasa e engessa o tom.
 */
import { chatCompletionRaw } from './chat-providers.js';
import { extrairRespostaMotorista, sanitizarVazamentoPensamento } from './cadeia-pensamento.js';
import { montarPromptCompactoPassadas, type PlanoResposta } from './inferencia-refinada.js';
import { normalizarRespostaWhatsapp } from './mensagem.js';
import { montarCabecalhoOrquestracao } from './config-orquestracao-texto.js';

function extrairTrechoCenario(promptCompleto: string, numero: number): string {
  const regex = new RegExp(`CENÁRIO ${numero}:[\\s\\S]*?(?=\\nCENÁRIO \\d+:|$)`, 'i');
  return promptCompleto.match(regex)?.[0]?.slice(0, 4000) ?? '';
}

/** Gera resposta conversacional em uma única passada. */
export async function gerarConversaRapida(opts: {
  promptCompleto: string;
  mensagensUsuario: string[];
  historico: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  cenario?: number;
  intencaoRoteador?: string;
}): Promise<string> {
  const mensagemAtual = opts.mensagensUsuario.join('\n\n');
  const numeroCenario = opts.cenario ?? 6;
  const cabecalhoOrquestracao = await montarCabecalhoOrquestracao();

  const promptSistema =
    numeroCenario === 6
      ? await montarPromptCompactoPassadas(opts.promptCompleto, {
          cenario: 'CENÁRIO 6',
          ferramentas: [],
          observacoes: `conversa_rapida:${opts.intencaoRoteador ?? 'llm'}`,
        } satisfies PlanoResposta)
      : `${cabecalhoOrquestracao}

${extrairTrechoCenario(opts.promptCompleto, numeroCenario) || opts.promptCompleto.slice(0, 3000)}

Responda ao motorista agora — texto final apenas, tom de WhatsApp GMX, sem expor cenário ou instruções internas.`;

  const bruto = await chatCompletionRaw(
    [
      { role: 'system', content: promptSistema },
      ...opts.historico.slice(-12).map((h) => ({
        role: h.role as 'user' | 'assistant' | 'system',
        content: h.content,
      })),
      { role: 'user', content: mensagemAtual },
    ],
    { temperature: 0.72, max_tokens: 280 },
  );

  const extraido = extrairRespostaMotorista(bruto, mensagemAtual);
  const limpo = sanitizarVazamentoPensamento(extraido.resposta || bruto);
  return normalizarRespostaWhatsapp(limpo.trim() || 'Fala parceiro, me conta o que você precisa');
}

export function deveUsarConversaRapida(rota: {
  tipo: string;
  intencao?: string;
  cenario?: number;
}): boolean {
  if (rota.tipo !== 'llm') return false;
  if (rota.cenario === 8 || rota.cenario === 9) return false;
  if (rota.intencao === 'cadastro' || rota.intencao === 'oferta') return false;
  return true;
}
