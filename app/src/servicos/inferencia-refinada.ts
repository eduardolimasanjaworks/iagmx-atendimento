/**
 * Inferência com cadeia de pensamento invisível: planejar → analisar → rascunho (JSON) → revisar (JSON) → auditar.
 * Passada 1 usa prompt completo; passadas 2–3 usam contexto compacto (menos TPM).
 */
import {
  extrairRespostaMotorista,
  INSTRUCAO_RASCUNHO_COM_RACIOCINIO,
  INSTRUCAO_REVISAO_COM_AUTOCRITICA,
  sanitizarVazamentoPensamento,
  type RaciocinioInterno,
} from './cadeia-pensamento.js';
import { extrairBlocosFerramenta, instrucoesFerramentas, mesclarFerramentasPreservadas } from './ferramentas.js';
import { anexarFerramentasProgramaticas } from './ferramentas-contexto.js';
import { montarCabecalhoOrquestracao } from './config-orquestracao-texto.js';
import {
  analisarIntencaoMotorista,
  auditarRespostaEFerramentas,
  montarBlocoApoioSemantico,
  montarInstrucaoAnaliseNoRascunho,
  type AnaliseDesambiguacao,
} from './desambiguacao-intencao.js';
import { chatCompletionRaw } from './openai.js';
import { executarNaFilaInferencia } from './fila-inferencia.js';

export interface PlanoResposta {
  cenario: string;
  ferramentas: string[];
  observacoes: string;
}

export interface ResultadoInferenciaRefinada {
  texto: string;
  plano: PlanoResposta;
  passadas: number;
  revisoes: string[];
  analise?: AnaliseDesambiguacao;
  /** Raciocínio interno — só logs/diagnóstico, nunca vai ao motorista */
  cadeiaPensamento?: RaciocinioInterno[];
}

const MAPA_CENARIO_NUMERO: Array<{ chaves: string[]; numero: number }> = [
  { chaves: ['documento', 'ocr', 'evasiv'], numero: 0 },
  { chaves: ['pix', 'comprovante'], numero: 1 },
  { chaves: ['oferta', 'embarque', 'carga'], numero: 5 },
  { chaves: ['saud', 'menu', 'fallback', 'bate-papo'], numero: 6 },
  { chaves: ['disponib', 'localiz', 'vazio', 'carregado'], numero: 7 },
  { chaves: ['cadastro', 'cnh', 'crlv', 'antt'], numero: 8 },
  { chaves: ['negoci', 'contraprop', 'valor'], numero: 9 },
];

function parseJson<T>(texto: string): T | null {
  const match = texto.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function numeroDoCenario(cenario: string): number | null {
  const digito = cenario.match(/\b(\d+)\b/);
  if (digito) return parseInt(digito[1], 10);
  const lower = cenario.toLowerCase();
  for (const item of MAPA_CENARIO_NUMERO) {
    if (item.chaves.some((k) => lower.includes(k))) return item.numero;
  }
  return null;
}

/** Extrai só o bloco do cenário escolhido + camadas fixas (passadas 2–3). */
export async function montarPromptCompactoPassadas(
  promptCompleto: string,
  plano: PlanoResposta,
): Promise<string> {
  const n = numeroDoCenario(plano.cenario);
  let trechoCenario = '';
  if (n !== null) {
    const regex = new RegExp(`CENÁRIO ${n}:[\\s\\S]*?(?=\\nCENÁRIO \\d+:|$)`, 'i');
    trechoCenario = promptCompleto.match(regex)?.[0]?.slice(0, 3800) ?? '';
  }
  if (!trechoCenario) {
    trechoCenario = promptCompleto.slice(0, 2200);
  }

  const cabecalhoOrquestracao = await montarCabecalhoOrquestracao();

  return `${cabecalhoOrquestracao}
${instrucoesFerramentas()}

=== CENÁRIO ATIVO (planejado: ${plano.cenario}) ===
${trechoCenario}

=== PLANO APROVADO ===
${JSON.stringify(plano)}`;
}

async function planejar(
  promptSistema: string,
  mensagemUsuario: string,
  historico: Array<{ role: string; content: string }>,
): Promise<PlanoResposta> {
  const hist = historico
    .slice(-12)
    .map((h) => `${h.role}: ${h.content}`)
    .join('\n');

  const texto = await chatCompletionRaw(
    [
      {
        role: 'system',
        content: `${promptSistema}

PASSO 1 — PLANEJAMENTO (não responda ao motorista ainda).
Analise histórico + mensagem atual. Escolha UM cenário do prompt.
Liste ferramentas JSON necessárias (ou array vazio).
Responda SOMENTE JSON:
{"cenario":"nome","ferramentas":["registrar_disponibilidade"],"observacoes":"..."}`,
      },
      {
        role: 'user',
        content: `HISTÓRICO:\n${hist || '(vazio)'}\n\nMENSAGEM ATUAL DO MOTORISTA:\n${mensagemUsuario}`,
      },
    ],
    { temperature: 0.1, max_tokens: 400 },
  );

  return (
    parseJson<PlanoResposta>(texto) ?? {
      cenario: 'indefinido',
      ferramentas: [],
      observacoes: texto.slice(0, 200),
    }
  );
}

async function rascunhar(
  promptCompacto: string,
  mensagemUsuario: string,
  historico: Array<{ role: string; content: string }>,
  plano: PlanoResposta,
  instrucaoAnalise?: string,
): Promise<{ texto: string; raciocinio?: RaciocinioInterno }> {
  const bruto = await chatCompletionRaw(
    [
      {
        role: 'system',
        content: `${promptCompacto}
${instrucaoAnalise ?? ''}

${INSTRUCAO_RASCUNHO_COM_RACIOCINIO}

Cenário ativo: "${plano.cenario}". Ferramentas planejadas: ${plano.ferramentas.join(', ') || 'nenhuma'}.`,
      },
      ...historico.map((h) => ({
        role: h.role as 'user' | 'assistant' | 'system',
        content: h.content,
      })),
      { role: 'user', content: mensagemUsuario },
    ],
    { temperature: 0.25, max_tokens: 900 },
  );

  const { resposta, registro } = extrairRespostaMotorista(bruto, 'passo2-rascunho');
  return { texto: resposta, raciocinio: registro };
}

async function revisar(
  promptCompacto: string,
  mensagemUsuario: string,
  plano: PlanoResposta,
  rascunho: string,
): Promise<{ texto: string; raciocinio?: RaciocinioInterno }> {
  const bruto = await chatCompletionRaw(
    [
      {
        role: 'system',
        content: `${promptCompacto}

${INSTRUCAO_REVISAO_COM_AUTOCRITICA}

Cenário: "${plano.cenario}". Ferramentas obrigatórias: ${plano.ferramentas.join(', ') || 'nenhuma'}.
Se o rascunho já tiver blocos {"ferramenta":...}, MANTENHA-OS intactos em resposta_motorista.`,
      },
      {
        role: 'user',
        content: `Mensagem motorista: ${mensagemUsuario}\n\nRascunho:\n${rascunho}`,
      },
    ],
    { temperature: 0.15, max_tokens: 900 },
  );

  const { resposta, registro } = extrairRespostaMotorista(bruto, 'passo3-revisao');
  return { texto: resposta, raciocinio: registro };
}

function faltamFerramentas(texto: string, esperadas: string[]): string[] {
  const blocos = extrairBlocosFerramenta(texto).map((b) => b.ferramenta);
  const presentes = new Set([
    ...blocos,
    ...blocos.map((b) => (b === 'escalonar_equipe' ? 'escalonar_negociacao' : b)),
  ]);
  return esperadas.filter((f) => {
    const canon = f === 'escalonar_equipe' ? 'escalonar_negociacao' : f;
    return !presentes.has(f) && !presentes.has(canon);
  });
}

function extrairContextoErp(promptSistema: string): string {
  const m = promptSistema.match(/=== CONTEXTO ERP GMX[\s\S]*?(?=\n===|\nANEXOS|$)/);
  return m?.[0] ?? promptSistema.slice(0, 3000);
}

async function gerarRespostaRefinadaInterno(
  promptSistema: string,
  mensagensUsuario: string[],
  historico: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [],
  meta?: { telefone?: string; midiaId?: string },
): Promise<ResultadoInferenciaRefinada> {
  const mensagemUsuario = mensagensUsuario.join('\n\n');
  const revisoes: string[] = [];
  const cadeiaPensamento: RaciocinioInterno[] = [];
  const temMidia = Boolean(meta?.midiaId);
  const blocoApoio = await montarBlocoApoioSemantico(mensagemUsuario);
  const contextoErp = extrairContextoErp(promptSistema);

  const plano = await planejar(promptSistema, mensagemUsuario, historico);
  revisoes.push('passo1-planejar');

  const analise = await analisarIntencaoMotorista({
    mensagem: mensagemUsuario,
    historico,
    contextoErp,
    temMidia,
    blocoApoio,
  });
  revisoes.push(
    `passo1b-analise:${analise.intencao_provavel}:${analise.ambiguo ? 'ambiguo' : 'claro'}`,
  );

  const promptCompacto = `${await montarPromptCompactoPassadas(promptSistema, plano)}\n\n${blocoApoio}`;
  const instrucaoAnalise = montarInstrucaoAnaliseNoRascunho(analise);

  const rascunhoResult = await rascunhar(
    promptCompacto,
    mensagemUsuario,
    historico,
    plano,
    instrucaoAnalise,
  );
  const rascunho = rascunhoResult.texto;
  if (rascunhoResult.raciocinio) cadeiaPensamento.push(rascunhoResult.raciocinio);
  revisoes.push('passo2-rascunho');

  let revisaoResult = await revisar(promptCompacto, mensagemUsuario, plano, rascunho);
  if (revisaoResult.raciocinio) cadeiaPensamento.push(revisaoResult.raciocinio);
  let texto = mesclarFerramentasPreservadas([rascunho], revisaoResult.texto);
  revisoes.push('passo3-revisao');

  const auditoria = await auditarRespostaEFerramentas({
    mensagem: mensagemUsuario,
    rascunho: texto,
    analise,
    planoFerramentas: plano.ferramentas,
    blocoApoio,
    temMidia,
  });
  texto = auditoria.texto;
  if (auditoria.raciocinio) cadeiaPensamento.push(auditoria.raciocinio);
  revisoes.push(...auditoria.ajustes);

  const ctxFerramentas = {
    telefone: meta?.telefone ?? '',
    mensagem: mensagemUsuario,
    historico,
    midiaId: meta?.midiaId,
  };

  const ferramentasEsperadas =
    analise.perguntar_antes_de_ferramenta || analise.ambiguo
      ? plano.ferramentas.filter((f) =>
          ['registrar_disponibilidade', 'resposta_oferta_carga', 'escalonar_negociacao'].includes(f),
        )
      : plano.ferramentas;

  let faltando = faltamFerramentas(texto, ferramentasEsperadas);
  if (faltando.length > 0) {
    revisoes.push(`retry-ferramentas:${faltando.join(',')}`);
    texto = await chatCompletionRaw(
      [
        {
          role: 'system',
          content: `${promptCompacto}\nFALTAM ferramentas JSON: ${faltando.join(', ')}. Reescreva a resposta incluindo-as AO FINAL.`,
        },
        ...historico.map((h) => ({
          role: h.role as 'user' | 'assistant' | 'system',
          content: h.content,
        })),
        { role: 'user', content: mensagemUsuario },
        { role: 'assistant', content: texto },
        {
          role: 'user',
          content: `Inclua obrigatoriamente JSON: ${faltando.map((f) => `{"ferramenta":"${f}","dados":{...}}`).join(' ')}`,
        },
      ],
      { temperature: 0.1, max_tokens: 700 },
    );
    texto = mesclarFerramentasPreservadas([rascunho, texto], texto);
  }

  texto = sanitizarVazamentoPensamento(texto);

  faltando = faltamFerramentas(texto, ferramentasEsperadas);
  if (faltando.length > 0) {
    const presentes = extrairBlocosFerramenta(texto).map((b) => b.ferramenta);
    texto = await anexarFerramentasProgramaticas(texto, ferramentasEsperadas, ctxFerramentas, presentes);
    revisoes.push(`programatico:${faltando.join(',')}`);
  }

  return {
    texto: sanitizarVazamentoPensamento(texto.trim()),
    plano,
    passadas: revisoes.filter((r) => r.startsWith('passo') || r.startsWith('retry')).length,
    revisoes,
    analise,
    cadeiaPensamento: cadeiaPensamento.length > 0 ? cadeiaPensamento : undefined,
  };
}

/**
 * Gera resposta com cadeia de pensamento invisível (planejar → analisar → rascunho JSON → revisar JSON → auditar) + retry programático.
 * Entra na fila global de inferência (concorrência limitada).
 */
export async function gerarRespostaRefinada(
  promptSistema: string,
  mensagensUsuario: string[],
  historico: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [],
  meta?: { telefone?: string; midiaId?: string },
): Promise<ResultadoInferenciaRefinada> {
  return executarNaFilaInferencia(
    () => gerarRespostaRefinadaInterno(promptSistema, mensagensUsuario, historico, meta),
    { telefone: meta?.telefone, mensagens: mensagensUsuario.length },
  );
}
