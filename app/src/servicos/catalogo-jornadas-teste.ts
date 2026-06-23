/**
 * Catalogo persistido das jornadas de teste.
 * Mantem CRUD simples no Postgres sem abrir outra tela.
 * Permite editar os cenarios reais sem hardcode no frontend.
 */
import pg from 'pg';
import { config } from '../config.js';
import { registrarHistoricoConfiguracao } from './historico-configuracao.js';
import { obterConfigMensagensFluxo } from './config-mensagens-fluxo.js';
import { montarMensagemOferta } from './oferta-disparo.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const CHAVE = 'jornadas_teste_catalogo';

export interface JornadaTesteDefinicao {
  id: string;
  cenario: number;
  titulo: string;
  descricao: string;
  origemMensagem: 'empresa';
  mensagemPadrao: string;
  ativa: boolean;
}

function normalizarId(valor: unknown): string {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function normalizarLinha(item: unknown): JornadaTesteDefinicao | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const id = normalizarId(raw.id);
  const titulo = String(raw.titulo || '').trim().slice(0, 120);
  const mensagemPadrao = String(raw.mensagemPadrao || '').trim();
  if (!id || !titulo || !mensagemPadrao) return null;
  return {
    id,
    cenario: Math.max(0, Math.min(999, Number(raw.cenario) || 0)),
    titulo,
    descricao: String(raw.descricao || '').trim().slice(0, 280),
    origemMensagem: 'empresa',
    mensagemPadrao,
    ativa: raw.ativa !== false,
  };
}

async function catalogoPadrao(): Promise<JornadaTesteDefinicao[]> {
  const mensagens = await obterConfigMensagensFluxo();
  return [
    {
      id: 'cenario_0_documentos',
      cenario: 0,
      titulo: 'Documentos Pendentes',
      descricao: 'Cobranca de foto ou PDF dos documentos pendentes',
      origemMensagem: 'empresa',
      mensagemPadrao:
        'Fala parceiro, ficou pendente uns documentos do seu cadastro aqui, pode mandar as fotos ou PDF por esse numero pra eu atualizar',
      ativa: true,
    },
    {
      id: 'cenario_1_comprovante',
      cenario: 1,
      titulo: 'Comprovante De Entrega',
      descricao: 'Pedido do canhoto ou comprovante de entrega',
      origemMensagem: 'empresa',
      mensagemPadrao:
        'Para finalizarmos, preciso que voce me envie uma foto legivel do comprovante de entrega, pode mandar por aqui?',
      ativa: true,
    },
    {
      id: 'cenario_5_oferta',
      cenario: 5,
      titulo: 'Oferta Proativa',
      descricao: 'Disparo de oferta real com continuidade no fluxo de negociacao',
      origemMensagem: 'empresa',
      mensagemPadrao: montarMensagemOferta({
        origem: 'Guarulhos SP',
        destino: 'Curitiba PR',
        valorOfertado: 4500,
      }, mensagens.oferta_proativa_template),
      ativa: true,
    },
    {
      id: 'cenario_6_saudacao',
      cenario: 6,
      titulo: 'Saudacao E Menu',
      descricao: 'Abertura curta para cair no atendimento geral',
      origemMensagem: 'empresa',
      mensagemPadrao: 'Fala parceiro, sou da GMX, me diz no que voce precisa hoje',
      ativa: true,
    },
    {
      id: 'cenario_7_disponibilidade',
      cenario: 7,
      titulo: 'Disponibilidade E Localizacao',
      descricao: 'Abordagem proativa para vazio, carregado e local atual',
      origemMensagem: 'empresa',
      mensagemPadrao:
        'Bom dia parceiro, estou atualizando nossa base de parceiros aqui e preciso confirmar se voce esta vazio agora ou se ainda esta carregado',
      ativa: true,
    },
    {
      id: 'cenario_8_cadastro',
      cenario: 8,
      titulo: 'Cadastro De Motorista',
      descricao: 'Inicio do cadastro com coleta de documentos',
      origemMensagem: 'empresa',
      mensagemPadrao: mensagens.c8_inicio,
      ativa: true,
    },
  ];
}

async function lerCatalogoCru(): Promise<{ valor: string; atualizadoEm: string | null } | null> {
  const res = await pool.query('SELECT valor, atualizado_em FROM configuracao WHERE chave = $1', [CHAVE]);
  if (!res.rowCount) return null;
  return {
    valor: String(res.rows[0].valor || '[]'),
    atualizadoEm: res.rows[0]?.atualizado_em
      ? new Date(res.rows[0].atualizado_em as string).toISOString()
      : null,
  };
}

function validarCatalogo(itens: JornadaTesteDefinicao[]): JornadaTesteDefinicao[] {
  const ids = new Set<string>();
  const saida: JornadaTesteDefinicao[] = [];
  for (const item of itens) {
    const normalizado = normalizarLinha(item);
    if (!normalizado) continue;
    if (ids.has(normalizado.id)) throw new Error(`ID de jornada duplicado: ${normalizado.id}`);
    ids.add(normalizado.id);
    saida.push(normalizado);
  }
  return saida;
}

export async function listarCatalogoJornadasTeste(): Promise<JornadaTesteDefinicao[]> {
  const salvo = await lerCatalogoCru().catch(() => null);
  if (!salvo) return catalogoPadrao();
  try {
    const bruto = JSON.parse(salvo.valor);
    if (!Array.isArray(bruto)) return catalogoPadrao();
    const itens = validarCatalogo(bruto as JornadaTesteDefinicao[]);
    return itens.length ? itens : catalogoPadrao();
  } catch {
    return catalogoPadrao();
  }
}

export async function obterCatalogoJornadasTesteMeta(): Promise<{
  jornadas: JornadaTesteDefinicao[];
  atualizadoEm: string | null;
}> {
  const salvo = await lerCatalogoCru().catch(() => null);
  return {
    jornadas: await listarCatalogoJornadasTeste(),
    atualizadoEm: salvo?.atualizadoEm ?? null,
  };
}

async function salvarCatalogo(
  jornadas: JornadaTesteDefinicao[],
  origem: string,
): Promise<JornadaTesteDefinicao[]> {
  const atual = await lerCatalogoCru().catch(() => null);
  const validado = validarCatalogo(jornadas);
  const serializado = JSON.stringify(validado, null, 2);
  await pool.query(
    `INSERT INTO configuracao (chave, valor, atualizado_em)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = NOW()`,
    [CHAVE, serializado],
  );
  await registrarHistoricoConfiguracao({
    chave: CHAVE,
    antes: atual?.valor ?? '',
    depois: serializado,
    origem,
  });
  return validado;
}

export async function criarJornadaTesteCatalogo(
  item: JornadaTesteDefinicao,
): Promise<JornadaTesteDefinicao[]> {
  const catalogo = await listarCatalogoJornadasTeste();
  const novo = normalizarLinha(item);
  if (!novo) throw new Error('Jornada invalida');
  if (catalogo.some((linha) => linha.id === novo.id)) {
    throw new Error('Ja existe uma jornada com esse id');
  }
  return salvarCatalogo([...catalogo, novo], 'api_admin_jornada_create');
}

export async function atualizarJornadaTesteCatalogo(
  id: string,
  item: JornadaTesteDefinicao,
): Promise<JornadaTesteDefinicao[]> {
  const catalogo = await listarCatalogoJornadasTeste();
  const alvo = normalizarId(id);
  const novo = normalizarLinha({ ...item, id: item.id || alvo });
  if (!novo) throw new Error('Jornada invalida');
  const existe = catalogo.some((linha) => linha.id === alvo);
  if (!existe) throw new Error('Jornada nao encontrada');
  if (novo.id !== alvo && catalogo.some((linha) => linha.id === novo.id)) {
    throw new Error('Ja existe outra jornada com esse id');
  }
  return salvarCatalogo(
    catalogo.map((linha) => (linha.id === alvo ? novo : linha)),
    'api_admin_jornada_update',
  );
}

export async function removerJornadaTesteCatalogo(id: string): Promise<JornadaTesteDefinicao[]> {
  const alvo = normalizarId(id);
  const catalogo = await listarCatalogoJornadasTeste();
  if (!catalogo.some((linha) => linha.id === alvo)) throw new Error('Jornada nao encontrada');
  const proximo = catalogo.filter((linha) => linha.id !== alvo);
  return salvarCatalogo(proximo, 'api_admin_jornada_delete');
}

export async function listarJornadasTesteAtivas(): Promise<JornadaTesteDefinicao[]> {
  return (await listarCatalogoJornadasTeste()).filter((item) => item.ativa);
}

export async function obterJornadaTestePorId(id: string): Promise<JornadaTesteDefinicao> {
  const jornada = (await listarCatalogoJornadasTeste()).find((item) => item.id === normalizarId(id));
  if (!jornada) throw new Error('Jornada invalida');
  if (!jornada.ativa) throw new Error('Essa jornada esta inativa');
  return jornada;
}
