/**
 * Detecção e execução de ferramentas — integração Directus GMX.
 */
import type { ItemDebounce } from '../tipos/evolution.js';
import { obterMidiaCache } from './midia-cache.js';
import {
  atualizarMotorista,
  buscarMotoristaPorTelefone,
  garantirMotorista,
  gravarDocumentoMotorista,
  registrarDisponibilidade,
  registrarRespostaOfertaCarga,
  salvarCarretaMotorista,
  verificarDocumentoMotoristaNoErp,
  verificarDisponibilidadeNoErp,
} from './motorista-gmx.js';
import {
  gravarCanhotoEmbarque,
  resolverEmbarqueAtivoPorTelefone,
  verificarCanhotoEmbarqueNoErp,
} from './embarque-motorista.js';
import { escalonarNegociacao } from './escalonar-negociacao.js';
import { jidParaTelefone } from '../util/telefone.js';
import { directusConfigurado } from './directus.js';
import { logEvento } from '../util/log-eventos.js';
import { invalidarCacheContextoErp } from './contexto-erp-motorista.js';
import { pausarContato } from './pausa.js';
import {
  novoEventoHistoricoId,
  verificarHistoricoOfertaNoErp,
} from './historico-ofertas-gmx.js';
import { adicionarEtapa } from './trace-pipeline.js';

export interface ContextoFerramenta {
  remoteJid: string;
  instance: string;
  itens: ItemDebounce[];
  traceId?: string;
}

const FERRAMENTAS = [
  'grava_ocr',
  'grava_comprovante',
  'resposta_oferta_carga',
  'registrar_disponibilidade',
  'atualizar_motorista',
  'salvar_carreta',
  'escalonar_negociacao',
  'escalonar_equipe',
] as const;

type NomeFerramenta = (typeof FERRAMENTAS)[number];

export interface BlocoFerramenta {
  ferramenta: string;
  dados: Record<string, unknown>;
  raw: string;
}

const ALIAS_FERRAMENTA: Record<string, NomeFerramenta> = {
  escalonar_equipe: 'escalonar_negociacao',
};

const PADROES_RESPOSTA_VAGA = [
  /preciso confirmar .*?(?:interna|aqui)/i,
  /preciso verificar/i,
  /vou verificar/i,
  /vou checar/i,
  /deixa eu conferir/i,
  /confirmar .*?com a equipe/i,
  /antes de te responder com seguranca/i,
];

export function serializarBlocoFerramenta(
  ferramenta: string,
  dados: Record<string, unknown>,
): string {
  return JSON.stringify({ ferramenta, dados });
}

function normalizarTextoParaExtracao(texto: string): string {
  return texto
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

/** Localiza início de objeto JSON de ferramenta (aspas simples ou duplas). */
function indiceProximaFerramenta(texto: string, from: number): number {
  const padroes = ['{"ferramenta"', "{'ferramenta'", '{"ferramenta" :', '{ "ferramenta"'];
  let menor = -1;
  for (const p of padroes) {
    const i = texto.indexOf(p.replace(/'/g, '"'), from);
    if (i === -1) continue;
    if (menor === -1 || i < menor) menor = i;
  }
  const aspasSimples = texto.indexOf("{'ferramenta'", from);
  if (aspasSimples !== -1 && (menor === -1 || aspasSimples < menor)) menor = aspasSimples;
  return menor;
}

/** Extrai blocos JSON {"ferramenta":"...","dados":{...}} da resposta */
export function extrairBlocosFerramenta(texto: string): BlocoFerramenta[] {
  const blocos: BlocoFerramenta[] = [];
  const normalizado = normalizarTextoParaExtracao(texto);
  let i = 0;

  while (i < normalizado.length) {
    const start = indiceProximaFerramenta(normalizado, i);
    if (start === -1) break;

    let depth = 0;
    let end = -1;
    let emString = false;
    let escape = false;
    let quote = '';

    for (let j = start; j < normalizado.length; j++) {
      const ch = normalizado[j];
      if (emString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === quote) emString = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        emString = true;
        quote = ch;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }

    if (end === -1) break;
    const raw = normalizado.slice(start, end);
    try {
      const parsed = JSON.parse(raw.replace(/'/g, '"')) as {
        ferramenta?: string;
        dados?: Record<string, unknown>;
      };
      if (parsed.ferramenta) {
        blocos.push({
          ferramenta: parsed.ferramenta,
          dados: parsed.dados ?? {},
          raw,
        });
      }
    } catch {
      try {
        const reparado = raw.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        const parsed = JSON.parse(reparado.replace(/'/g, '"')) as {
          ferramenta?: string;
          dados?: Record<string, unknown>;
        };
        if (parsed.ferramenta) {
          blocos.push({ ferramenta: parsed.ferramenta, dados: parsed.dados ?? {}, raw });
        }
      } catch {
        /* ignora JSON inválido */
      }
    }
    i = end;
  }
  return blocos;
}

/** Preserva JSON de rascunhos anteriores se a revisão removeu. */
export function mesclarFerramentasPreservadas(
  textosAnteriores: string[],
  textoFinal: string,
): string {
  const presentes = new Set(extrairBlocosFerramenta(textoFinal).map((b) => b.ferramenta));
  let saida = textoFinal;

  for (const anterior of textosAnteriores) {
    for (const bloco of extrairBlocosFerramenta(anterior)) {
      const canon = ALIAS_FERRAMENTA[bloco.ferramenta] ?? bloco.ferramenta;
      if (presentes.has(canon) || presentes.has(bloco.ferramenta)) continue;
      saida += `\n${bloco.raw}`;
      presentes.add(canon);
    }
  }

  return saida.trim();
}

function telefoneDoContexto(ctx: ContextoFerramenta, dados: Record<string, unknown>): string {
  if (typeof dados.telefone === 'string' && dados.telefone) {
    return dados.telefone.replace(/\D/g, '');
  }
  return jidParaTelefone(ctx.remoteJid);
}

async function midiaDoContexto(
  ctx: ContextoFerramenta,
  dados: Record<string, unknown>,
) {
  const id = (dados.midia_id as string) ?? ctx.itens.find((i) => i.midiaId)?.midiaId;
  if (!id) return null;
  const midia = await obterMidiaCache(id);
  if (!midia) return null;
  return { ...midia, midiaId: id };
}

function resolverNomeFerramenta(nome: string): NomeFerramenta | null {
  const canon = ALIAS_FERRAMENTA[nome] ?? nome;
  return FERRAMENTAS.includes(canon as NomeFerramenta) ? (canon as NomeFerramenta) : null;
}

async function autoPausarSeRespostaVaga(texto: string, ctx: ContextoFerramenta): Promise<void> {
  if (!texto || !PADROES_RESPOSTA_VAGA.some((regex) => regex.test(texto))) return;
  const telefone = jidParaTelefone(ctx.remoteJid);
  const motivo = 'IA sinalizou incerteza e pediu ajuda humana';
  await pausarContato(telefone, motivo);
  if (ctx.traceId) {
    await adicionarEtapa(ctx.traceId, 'auto_pausa', 'IA pediu apoio humano', {
      telefone,
      motivo,
      mensagem: `${motivo} · ${texto.slice(0, 220)}`,
    });
  }
}

async function executarFerramenta(
  nome: NomeFerramenta,
  dados: Record<string, unknown>,
  ctx: ContextoFerramenta,
): Promise<void> {
  if (!directusConfigurado() && nome !== 'escalonar_negociacao') {
    logEvento('ferramenta', 'Directus não configurado — ferramenta ignorada', { nome }, 'warn');
    return;
  }

  const telefone = telefoneDoContexto(ctx, dados);

  switch (nome) {
    case 'grava_comprovante': {
      const midia = await midiaDoContexto(ctx, dados);
      if (!midia) {
        console.warn(`[ferramenta] grava_comprovante: sem mídia em cache para ${telefone}`);
        return;
      }
      const embarque = await resolverEmbarqueAtivoPorTelefone({
        telefone,
        embarqueId: (dados.embarque_id as string | number | undefined) ?? null,
        origem: (dados.origem as string | undefined) ?? null,
        destino: (dados.destino as string | undefined) ?? null,
      });
      const embId = embarque?.id ?? null;
      if (embId) {
        const r = await gravarCanhotoEmbarque({
          telefone,
          embarqueId: embId,
          midia,
          textoExtraido:
            (dados.texto_extraido as string) ??
            ctx.itens.map((i) => i.conteudo).join('\n'),
        });
        const verificacao = await verificarCanhotoEmbarqueNoErp({
          embarqueId: embId,
          fileUrl: r.fileUrl,
        });
        if (!verificacao.ok) {
          throw new Error(verificacao.motivo ?? 'Canhoto não confirmado no ERP');
        }
        console.log(`[ferramenta] grava_comprovante embarque OK`, r);
      } else {
        const doc = await gravarDocumentoMotorista({
          telefone,
          midia,
          tipo: 'comprovante_entrega',
          textoExtraido:
            (dados.texto_extraido as string) ??
            ctx.itens.map((i) => i.conteudo).join('\n'),
        });
        const verificacao = await verificarDocumentoMotoristaNoErp({
          telefone,
          colecao: doc.colecao,
          fileUrl: doc.fileUrl,
        });
        if (!verificacao.ok) {
          throw new Error(verificacao.motivo ?? 'Comprovante não confirmado no ERP');
        }
      }
      invalidarCacheContextoErp(telefone);
      break;
    }

    case 'grava_ocr': {
      const midia = await midiaDoContexto(ctx, dados);
      if (!midia) {
        console.warn(`[ferramenta] grava_ocr: sem mídia em cache para ${telefone}`);
        return;
      }
      const tipo = (dados.tipo as string) ?? 'cnh';
      const textoExtraido =
        (dados.texto_extraido as string) ??
        ctx.itens.map((i) => i.conteudo).join('\n');
      const resultado = await gravarDocumentoMotorista({
        telefone,
        midia,
        tipo,
        textoExtraido,
        campos: dados.campos as Record<string, unknown> | undefined,
      });
      if (resultado.pendente) {
        console.log(`[ferramenta] grava_ocr pendente`, resultado);
        invalidarCacheContextoErp(telefone);
        break;
      }
      const verificacao = await verificarDocumentoMotoristaNoErp({
        telefone,
        colecao: resultado.colecao,
        fileUrl: resultado.fileUrl,
      });
      if (!verificacao.ok) {
        throw new Error(verificacao.motivo ?? 'Documento OCR não confirmado no ERP');
      }
      console.log(`[ferramenta] grava_ocr OK`, resultado);
      invalidarCacheContextoErp(telefone);
      break;
    }

    case 'registrar_disponibilidade': {
      const r = await registrarDisponibilidade({
        telefone,
        disponivel: dados.disponivel as boolean | undefined,
        status: dados.status as string | undefined,
        localizacao_atual: (dados.localizacao_atual ?? dados.local) as string | undefined,
        local_disponibilidade: dados.local_disponibilidade as string | undefined,
        latitude: dados.latitude as number | undefined,
        longitude: dados.longitude as number | undefined,
        data_previsao_disponibilidade: dados.data_previsao_disponibilidade as string | undefined,
      });

      const verificacao = await verificarDisponibilidadeNoErp(telefone, {
        disponivel: dados.disponivel as boolean | undefined,
        status: dados.status as string | undefined,
        localizacao_atual: (dados.localizacao_atual ?? dados.local) as string | undefined,
        local_disponibilidade: dados.local_disponibilidade as string | undefined,
        latitude: dados.latitude as number | undefined,
        longitude: dados.longitude as number | undefined,
        data_previsao_disponibilidade: dados.data_previsao_disponibilidade as string | undefined,
      });

      if (!verificacao.ok) {
        console.error(
          `[ferramenta] registrar_disponibilidade VERIFICAÇÃO FALHOU telefone=${telefone}`,
          verificacao.motivo,
        );
        throw new Error(
          verificacao.motivo ?? 'Disponibilidade não confirmada no ERP após gravação',
        );
      }

      console.log(`[ferramenta] registrar_disponibilidade OK ERP confirmado`, {
        telefone,
        id: verificacao.registro?.id ?? r.id,
        local: dados.localizacao_atual ?? dados.local,
        status: dados.status,
      });
      invalidarCacheContextoErp(telefone);
      break;
    }

    case 'atualizar_motorista': {
      let motorista = await buscarMotoristaPorTelefone(telefone);
      if (!motorista) {
        motorista = await garantirMotorista(telefone, dados.nome as string | undefined);
      }
      const atualizado = await atualizarMotorista(motorista.id, dados);
      console.log(`[ferramenta] atualizar_motorista OK id=${atualizado.id}`);
      invalidarCacheContextoErp(telefone);
      break;
    }

    case 'salvar_carreta': {
      const indice = Number(dados.indice) as 1 | 2 | 3;
      if (![1, 2, 3].includes(indice)) {
        console.warn('[ferramenta] salvar_carreta: indice inválido', dados.indice);
        return;
      }
      const midia = await midiaDoContexto(ctx, dados);
      const campos = (dados.campos as Record<string, unknown>) ?? {};
      const r = await salvarCarretaMotorista({
        telefone,
        indice,
        campos,
        midia: midia ?? undefined,
      });
      console.log(`[ferramenta] salvar_carreta OK`, r);
      invalidarCacheContextoErp(telefone);
      break;
    }

    case 'resposta_oferta_carga': {
      const aceite = dados.aceite === true;
      const eventoId = novoEventoHistoricoId();
      const embarque = await resolverEmbarqueAtivoPorTelefone({
        telefone,
        embarqueId: (dados.embarque_id as number | string | undefined) ?? null,
        origem: (dados.origem as string | undefined) ?? null,
        destino: (dados.destino as string | undefined) ?? null,
      });
      const embarqueId = embarque?.id ?? null;
      const registro = await registrarRespostaOfertaCarga({
        telefone,
        event_id: eventoId,
        aceite,
        valor_aceito: dados.valor_aceito as number | undefined,
        valor_ofertado: dados.valor_ofertado as number | undefined,
        origem: dados.origem as string | undefined,
        destino: dados.destino as string | undefined,
        observacao: dados.observacao as string | undefined,
        embarque_id: embarqueId ?? undefined,
        motorista_id: dados.motorista_id as number | string | undefined,
        match_id: dados.match_id as number | null | undefined,
      });
      const subtipoEsperado =
        aceite
          ? ((dados.valor_aceito as number | undefined) != null &&
              (dados.valor_ofertado as number | undefined) != null &&
              dados.valor_aceito !== dados.valor_ofertado
              ? 'aceite_negociado_ia'
              : 'aceite_ia')
          : ((dados.valor_aceito as number | undefined) != null ? 'negociacao_ia' : 'recusa_ia');
      const verificacao = await verificarHistoricoOfertaNoErp({
        telefone,
        eventoId,
      });
      if (!verificacao.ok) {
        throw new Error(verificacao.motivo ?? 'Histórico da oferta não confirmado no ERP');
      }
      logEvento('ferramenta', 'resposta_oferta_carga', {
        telefone,
        aceite,
        historico_id: registro.id,
        event_id: eventoId,
        subtipo: subtipoEsperado,
        embarque_id: embarqueId,
        valor_aceito: dados.valor_aceito,
        origem: dados.origem,
        destino: dados.destino,
      });
      console.log(`[ferramenta] resposta_oferta_carga OK id=${registro.id}`);
      invalidarCacheContextoErp(telefone);
      break;
    }

    case 'escalonar_negociacao': {
      const eventoId = novoEventoHistoricoId();
      const embarque = await resolverEmbarqueAtivoPorTelefone({
        telefone,
        embarqueId: (dados.embarque_id as number | string | undefined) ?? null,
        origem: (dados.origem as string | undefined) ?? null,
        destino: (dados.destino as string | undefined) ?? null,
      });
      const embarqueId = embarque?.id ?? null;
      const r = await escalonarNegociacao({
        telefoneMotorista: telefone,
        eventId: eventoId,
        origem: dados.origem as string | undefined,
        destino: dados.destino as string | undefined,
        valorPedido: dados.valor_pedido_motorista as number | undefined,
        valorMinimo: dados.valor_minimo as number | undefined,
        valorMaximo: dados.valor_maximo as number | undefined,
        motivo: (dados.motivo as string) ?? 'negociacao_sem_acordo',
        embarqueId,
        matchId: (dados.match_id as number | null | undefined) ?? null,
      });
      const verificacao = await verificarHistoricoOfertaNoErp({
        telefone,
        eventoId,
      });
      if (!verificacao.ok) {
        throw new Error(verificacao.motivo ?? 'Escalonamento não confirmado no ERP');
      }
      console.log(`[ferramenta] escalonar_negociacao OK`, r);
      break;
    }
  }
}

/**
 * Executa ferramentas na resposta da IA e remove blocos JSON do texto ao usuário.
 */
export async function processarFerramentas(
  resposta: string,
  ctx: ContextoFerramenta,
): Promise<string> {
  let texto = resposta;
  const blocos = extrairBlocosFerramenta(resposta);
  let houveErroFerramenta = false;

  for (const bloco of blocos) {
    const nome = resolverNomeFerramenta(bloco.ferramenta);
    if (nome) {
      try {
        await executarFerramenta(nome, bloco.dados, ctx);
        if (ctx.traceId) {
          await adicionarEtapa(ctx.traceId, 'ferramenta', `Ferramenta ${nome} executada`, {
            ferramenta: nome,
            status: 'ok',
            dados: bloco.dados,
          });
        }
      } catch (err) {
        houveErroFerramenta = true;
        console.error(`[ferramenta] Erro em ${bloco.ferramenta}:`, err);
        if (ctx.traceId) {
          await adicionarEtapa(ctx.traceId, 'ferramenta', `Ferramenta ${nome} falhou`, {
            ferramenta: nome,
            status: 'erro',
            dados: bloco.dados,
            erro: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } else {
      logEvento('ferramenta', 'Ferramenta desconhecida ignorada', { nome: bloco.ferramenta }, 'warn');
    }
    texto = texto.replace(bloco.raw, '').trim();
  }

  if (houveErroFerramenta) {
    const respostaErro = 'Parceiro, preciso confirmar uma informacao interna aqui antes de te responder com seguranca';
    await autoPausarSeRespostaVaga(respostaErro, ctx);
    return respostaErro;
  }

  const saida = texto.trim();
  await autoPausarSeRespostaVaga(saida, ctx);
  return saida;
}

/** Instruções de ferramentas para o modelo */
export function instrucoesFerramentas(): string {
  return `
=== FERRAMENTAS INTERNAS GMX (OBRIGATÓRIO QUANDO O CENÁRIO MANDAR GRAVAR) ===
Inclua AO FINAL da resposta, uma linha por ferramenta, JSON em linha única. O motorista NÃO vê isso.
SEM JSON = dado NÃO salvo no ERP. A revisão remove seu texto mas NÃO pode remover os JSON.

{"ferramenta":"grava_ocr","dados":{"tipo":"cnh","midia_id":"ID_SE_HOUVER"}}
{"ferramenta":"grava_comprovante","dados":{"midia_id":"ID_SE_HOUVER"}}
{"ferramenta":"registrar_disponibilidade","dados":{"disponivel":true,"status":"disponivel","localizacao_atual":"Cidade UF"}}
{"ferramenta":"registrar_disponibilidade","dados":{"disponivel":false,"status":"carregado","localizacao_atual":"Cidade UF","data_previsao_disponibilidade":"2026-06-25 08:00:00","local_disponibilidade":"Cidade UF"}}
{"ferramenta":"resposta_oferta_carga","dados":{"aceite":true,"valor_aceito":4500,"valor_ofertado":4500,"origem":"X","destino":"Y"}}
{"ferramenta":"atualizar_motorista","dados":{"cidade":"Guarulhos","estado":"SP"}}
{"ferramenta":"salvar_carreta","dados":{"indice":1,"campos":{"placa":"ABC1D23"}}}
{"ferramenta":"grava_comprovante","dados":{"midia_id":"ID","embarque_id":123}}
{"ferramenta":"escalonar_negociacao","dados":{"motivo":"negociacao_sem_acordo","valor_pedido_motorista":5000,"origem":"X","destino":"Y"}}

Alias aceito: escalonar_equipe → escalonar_negociacao (pausa IA + avisa operadores).
Use midia_id dos anexos quando houver imagem ou PDF.`;
}
