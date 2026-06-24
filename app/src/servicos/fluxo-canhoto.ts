/**
 * Canhoto / comprovante de entrega — embarque ativo do motorista.
 */
import type { ItemDebounce } from '../tipos/evolution.js';
import { serializarBlocoFerramenta } from './ferramentas.js';
import { obterEmbarqueAtivoPrincipal } from './embarque-motorista.js';
import { obterConfigMensagensFluxo, interpolarMensagem } from './config-mensagens-fluxo.js';

export interface ResultadoFluxoCanhoto {
  textoComFerramentas: string;
  visivel: string;
  passo: string;
  fragmentar: false;
}

const ENTRADA =
  /canhoto|comprovante de entrega|comprovante entrega|mandar canhoto|foto do canhoto|descarga/i;

function pediuCanhotoRecentemente(historico: Array<{ role: string; content: string }>): boolean {
  const ultimaAssist = [...historico].reverse().find((h) => h.role === 'assistant')?.content ?? '';
  return /canhoto|comprovante de entrega|manda a foto do canhoto|em viagem manda o canhoto/i.test(
    ultimaAssist,
  );
}

function extrairMidiaId(itens: ItemDebounce[]): string | undefined {
  for (const i of itens) {
    if ((i.tipo === 'imagem' || i.tipo === 'documento') && i.midiaId) return i.midiaId;
  }
  return undefined;
}

function montar(
  visivel: string,
  ferramenta?: { ferramenta: string; dados: Record<string, unknown> },
  passo = 'ok',
): ResultadoFluxoCanhoto {
  const json = ferramenta ? serializarBlocoFerramenta(ferramenta.ferramenta, ferramenta.dados) : '';
  return {
    visivel,
    textoComFerramentas: json ? `${visivel}\n${json}` : visivel,
    passo,
    fragmentar: false,
  };
}

export async function tentarFluxoCanhoto(opts: {
  telefone: string;
  mensagem: string;
  historico?: Array<{ role: string; content: string }>;
  itens?: ItemDebounce[];
}): Promise<ResultadoFluxoCanhoto | null> {
  const { telefone, mensagem, historico = [], itens = [] } = opts;
  const msgs = await obterConfigMensagensFluxo();
  const t = mensagem.trim().toLowerCase();
  const midiaId = extrairMidiaId(itens);
  const entrada = ENTRADA.test(t);
  const obterEmbarqueUnico = async () => {
    try {
      return await obterEmbarqueAtivoPrincipal(telefone);
    } catch (error) {
      if (error instanceof Error && error.message.includes('motorista_multiplos_embarques_ativos')) {
        return 'ambiguo' as const;
      }
      throw error;
    }
  };

  if (!entrada && !midiaId) return null;
  if (midiaId && !entrada && !pediuCanhotoRecentemente(historico)) return null;
  if (entrada && !midiaId) {
    const emb = await obterEmbarqueUnico();
    if (emb === 'ambiguo') {
      return montar(
        'Vi mais de um embarque ativo no seu nome e nao vou adivinhar o canhoto. A equipe vai conferir o embarque correto antes de salvar.',
        undefined,
        'canhoto_embarque_ambiguo',
      );
    }
    if (!emb) {
      return montar(
        msgs.canhoto_sem_embarque,
        undefined,
        'canhoto_sem_embarque',
      );
    }
    return montar(
      interpolarMensagem(msgs.canhoto_pedir_foto, { embarque_id: String(emb.id) }),
      undefined,
      'canhoto_pedir_foto',
    );
  }

  if (!midiaId) return null;

  const emb = await obterEmbarqueUnico();
  if (emb === 'ambiguo') {
    return montar(
      'Recebi a midia, mas vi mais de um embarque ativo no seu nome. Nao vou anexar no embarque errado; a equipe vai conferir isso manualmente.',
      undefined,
      'canhoto_midia_embarque_ambiguo',
    );
  }
  if (!emb) {
    return montar(
      msgs.canhoto_midia_sem_embarque,
      undefined,
      'canhoto_midia_sem_embarque',
    );
  }

  return montar(
    interpolarMensagem(msgs.canhoto_ok, { embarque_id: String(emb.id) }),
    {
      ferramenta: 'grava_comprovante',
      dados: {
        midia_id: midiaId,
        telefone,
        embarque_id: emb.id,
      },
    },
    'canhoto_ok',
  );
}
