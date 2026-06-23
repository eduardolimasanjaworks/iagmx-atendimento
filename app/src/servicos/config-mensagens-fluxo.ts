/**
 * Mensagens operacionais editaveis dos fluxos programaticos e OCR humano.
 */
import pg from 'pg';
import { config } from '../config.js';
import { registrarHistoricoConfiguracao } from './historico-configuracao.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const CHAVE = 'mensagens_fluxo';

export interface ConfigMensagensFluxo {
  contato_proativo_localizacao_com_referencia: string;
  contato_proativo_localizacao_sem_referencia: string;
  oferta_proativa_template: string;
  c7_pergunta_status: string;
  c7_duvida_status: string;
  c7_pede_localizacao: string;
  c7_local_invalida: string;
  c7_pergunta_local_atual_carregado: string;
  c7_pergunta_data: string;
  c7_pergunta_local_disponibilidade: string;
  c7_data_vaga: string;
  c7_fechamento: string;
  c8_inicio: string;
  c8_fechamento: string;
  c8_reprompt_cnh: string;
  c8_reprompt_crlv: string;
  c8_reprompt_antt: string;
  c8_reprompt_endereco: string;
  c8_reprompt_caminhao: string;
  c8_confirmacao_cnh: string;
  c8_confirmacao_crlv: string;
  c8_confirmacao_antt: string;
  c8_confirmacao_endereco: string;
  c8_ocr_ilegivel: string;
  c8_ocr_escalonar: string;
  atualizacao_pedir_foto: string;
  atualizacao_reprompt_cnh: string;
  atualizacao_reprompt_crlv: string;
  atualizacao_reprompt_antt: string;
  atualizacao_reprompt_endereco: string;
  atualizacao_reprompt_caminhao: string;
  atualizacao_ocr_recusa: string;
  atualizacao_foto_ilegivel: string;
  atualizacao_tipo_incerto: string;
  atualizacao_tipo_incerto_com_texto: string;
  atualizacao_confirmacao_negada: string;
  canhoto_sem_embarque: string;
  canhoto_pedir_foto: string;
  canhoto_midia_sem_embarque: string;
  canhoto_ok: string;
  ocr_humano_aberturas: string[];
  ocr_humano_documento_salvo_com_detalhes: string;
  ocr_humano_documento_salvo_sem_detalhes: string;
  ocr_humano_confirmacao_com_detalhes: string;
  ocr_humano_confirmacao_sem_detalhes: string;
  ocr_humano_confirmada_com_detalhes: string;
  ocr_humano_confirmada_sem_detalhes: string;
}

export const MENSAGENS_FLUXO_PADRAO: ConfigMensagensFluxo = {
  contato_proativo_localizacao_com_referencia:
    'Bom dia parceiro, a GMX esta atualizando a localizacao da frota de hoje, me confirma por favor sua localizacao atual, no ultimo registro voce estava em {{localizacao_atual}}',
  contato_proativo_localizacao_sem_referencia:
    'Bom dia parceiro, a GMX esta atualizando a localizacao da frota de hoje, me confirma por favor sua localizacao atual com cidade e estado',
  oferta_proativa_template:
    'Adriano - GMX / CargoX\n\nTemos carga {{origem}} -> {{destino}}\n{{linha_produto}}\n{{linha_operacao}}\nValor: {{valor_ofertado}}\n\nTem interesse?',
  c7_pergunta_status: 'Show parceiro! Você está vazio ou já está carregado?',
  c7_duvida_status: 'Fiquei na dúvida parceiro, você está vazio ou carregado?',
  c7_pede_localizacao:
    'Perfeito! Como você está vazio, manda sua localização atual pelo clipe 📎 ou escreve cidade e estado',
  c7_local_invalida:
    'Preciso do nome da cidade e estado onde você está (ou mande a localização pelo clipe)',
  c7_pergunta_local_atual_carregado:
    'Entendido parceiro, me fala sua localização atual agora com cidade e estado',
  c7_pergunta_data: 'E em que data você estará liberado para carregar?',
  c7_pergunta_local_disponibilidade:
    'E quando liberar, em qual cidade e estado você vai estar disponível para carregar?',
  c7_data_vaga: 'Preciso de uma estimativa de data parceiro, que dia acha que libera?',
  c7_fechamento: 'Show parceiro, dados atualizados, boa viagem',
  c8_inicio: 'Beleza parceiro, vamos fazer seu cadastro, manda a foto da sua CNH por favor',
  c8_fechamento: 'Show parceiro, cadastro enviado pra análise da equipe, em breve te retornamos',
  c8_reprompt_cnh: 'Preciso da foto da CNH parceiro, manda aí por favor',
  c8_reprompt_crlv: 'Preciso da foto do CRLV do cavalo parceiro, manda aí por favor',
  c8_reprompt_antt: 'Preciso da foto ou PDF da ANTT parceiro, manda aí por favor',
  c8_reprompt_endereco: 'Preciso do comprovante de endereço parceiro, manda a foto ou PDF',
  c8_reprompt_caminhao:
    'Preciso de uma foto do caminhão (cavalo) parceiro, manda aí por favor',
  c8_confirmacao_cnh: 'CNH recebida parceiro, agora manda a foto do CRLV do cavalo',
  c8_confirmacao_crlv: 'Show parceiro, agora manda a foto ou PDF da ANTT',
  c8_confirmacao_antt: 'Beleza, agora manda o comprovante de endereço parceiro',
  c8_confirmacao_endereco: 'Recebido parceiro, agora manda uma foto do caminhão (cavalo)',
  c8_ocr_ilegivel: 'Não consegui ler direito parceiro, manda outra foto com boa luz por favor',
  c8_ocr_escalonar:
    'Não consegui ler o documento parceiro, vou passar pra equipe te ajudar com o cadastro, aguarda um pouco',
  atualizacao_pedir_foto: 'Beleza parceiro, manda a foto do documento que você quer atualizar',
  atualizacao_reprompt_cnh: 'Beleza, manda a foto da CNH atualizada por favor',
  atualizacao_reprompt_crlv: 'Show, manda a foto do CRLV atualizado por favor',
  atualizacao_reprompt_antt: 'Beleza, manda a foto ou PDF da ANTT atualizada por favor',
  atualizacao_reprompt_endereco: 'Manda o comprovante de endereço atualizado por favor',
  atualizacao_reprompt_caminhao: 'Manda a foto do caminhão (cavalo) atualizada por favor',
  atualizacao_ocr_recusa:
    'Deu um problema técnico na leitura aqui do meu lado, manda a foto de novo que eu tento outra vez',
  atualizacao_foto_ilegivel:
    'Eita ficou meio embaçada a foto parceiro, manda de novo com boa luz sem cortar o documento',
  atualizacao_tipo_incerto:
    'Recebi a foto mas não fechei o tipo de documento, me fala se é CNH, CRLV ou outro que eu salvo certinho',
  atualizacao_tipo_incerto_com_texto:
    'Li um pedaço assim: {{trecho}}, mas não fechei qual documento é — me fala se é CNH, CRLV ou outro',
  atualizacao_confirmacao_negada: 'Beleza sem problema, manda a foto certa que eu leio de novo',
  canhoto_sem_embarque:
    'Não achei viagem ativa no seu nome parceiro, quando estiver em viagem manda o canhoto aqui',
  canhoto_pedir_foto: 'Beleza parceiro, manda a foto do canhoto da entrega (embarque #{{embarque_id}})',
  canhoto_midia_sem_embarque:
    'Recebi a imagem parceiro, mas não encontrei embarque ativo seu no sistema — nossa equipe vai conferir',
  canhoto_ok: 'Canhoto recebido parceiro, já vinculei ao embarque #{{embarque_id}}',
  ocr_humano_aberturas: [
    'Opa recebi a foto aqui',
    'Beleza deu pra ler sim',
    'Show recebi aqui',
    'Fechou vi aqui',
  ],
  ocr_humano_documento_salvo_com_detalhes:
    '{{abertura}}, vi que é {{doc}} — {{detalhes}}, já subi pro cadastro da equipe',
  ocr_humano_documento_salvo_sem_detalhes:
    '{{abertura}}, identifiquei {{doc}} na imagem, já subi pro cadastro da equipe',
  ocr_humano_confirmacao_com_detalhes:
    '{{abertura}}, acho que é {{doc}} — {{detalhes}}, confirma pra mim se é isso que você quer atualizar no cadastro',
  ocr_humano_confirmacao_sem_detalhes:
    '{{abertura}}, parece ser {{doc}} mas não peguei todos os dados direito, confirma se é isso que você quer atualizar',
  ocr_humano_confirmada_com_detalhes:
    'Fechou então, {{doc}} — {{detalhes}}, já salvei no cadastro',
  ocr_humano_confirmada_sem_detalhes: 'Fechou, {{doc}} salva no cadastro então',
};

let cache: ConfigMensagensFluxo | null = null;
let cacheEm = 0;
const CACHE_TTL_MS = 5000;

function normalizarArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : fallback;
}

function normalizar(
  partial?: Partial<ConfigMensagensFluxo> | null,
): ConfigMensagensFluxo {
  const base = { ...MENSAGENS_FLUXO_PADRAO, ...(partial ?? {}) } as Record<string, unknown>;
  return {
    contato_proativo_localizacao_com_referencia: String(
      base.contato_proativo_localizacao_com_referencia,
    ).trim(),
    contato_proativo_localizacao_sem_referencia: String(
      base.contato_proativo_localizacao_sem_referencia,
    ).trim(),
    oferta_proativa_template: String(base.oferta_proativa_template).trim(),
    c7_pergunta_status: String(base.c7_pergunta_status).trim(),
    c7_duvida_status: String(base.c7_duvida_status).trim(),
    c7_pede_localizacao: String(base.c7_pede_localizacao).trim(),
    c7_local_invalida: String(base.c7_local_invalida).trim(),
    c7_pergunta_local_atual_carregado: String(base.c7_pergunta_local_atual_carregado).trim(),
    c7_pergunta_data: String(base.c7_pergunta_data).trim(),
    c7_pergunta_local_disponibilidade: String(base.c7_pergunta_local_disponibilidade).trim(),
    c7_data_vaga: String(base.c7_data_vaga).trim(),
    c7_fechamento: String(base.c7_fechamento).trim(),
    c8_inicio: String(base.c8_inicio).trim(),
    c8_fechamento: String(base.c8_fechamento).trim(),
    c8_reprompt_cnh: String(base.c8_reprompt_cnh).trim(),
    c8_reprompt_crlv: String(base.c8_reprompt_crlv).trim(),
    c8_reprompt_antt: String(base.c8_reprompt_antt).trim(),
    c8_reprompt_endereco: String(base.c8_reprompt_endereco).trim(),
    c8_reprompt_caminhao: String(base.c8_reprompt_caminhao).trim(),
    c8_confirmacao_cnh: String(base.c8_confirmacao_cnh).trim(),
    c8_confirmacao_crlv: String(base.c8_confirmacao_crlv).trim(),
    c8_confirmacao_antt: String(base.c8_confirmacao_antt).trim(),
    c8_confirmacao_endereco: String(base.c8_confirmacao_endereco).trim(),
    c8_ocr_ilegivel: String(base.c8_ocr_ilegivel).trim(),
    c8_ocr_escalonar: String(base.c8_ocr_escalonar).trim(),
    atualizacao_pedir_foto: String(base.atualizacao_pedir_foto).trim(),
    atualizacao_reprompt_cnh: String(base.atualizacao_reprompt_cnh).trim(),
    atualizacao_reprompt_crlv: String(base.atualizacao_reprompt_crlv).trim(),
    atualizacao_reprompt_antt: String(base.atualizacao_reprompt_antt).trim(),
    atualizacao_reprompt_endereco: String(base.atualizacao_reprompt_endereco).trim(),
    atualizacao_reprompt_caminhao: String(base.atualizacao_reprompt_caminhao).trim(),
    atualizacao_ocr_recusa: String(base.atualizacao_ocr_recusa).trim(),
    atualizacao_foto_ilegivel: String(base.atualizacao_foto_ilegivel).trim(),
    atualizacao_tipo_incerto: String(base.atualizacao_tipo_incerto).trim(),
    atualizacao_tipo_incerto_com_texto: String(base.atualizacao_tipo_incerto_com_texto).trim(),
    atualizacao_confirmacao_negada: String(base.atualizacao_confirmacao_negada).trim(),
    canhoto_sem_embarque: String(base.canhoto_sem_embarque).trim(),
    canhoto_pedir_foto: String(base.canhoto_pedir_foto).trim(),
    canhoto_midia_sem_embarque: String(base.canhoto_midia_sem_embarque).trim(),
    canhoto_ok: String(base.canhoto_ok).trim(),
    ocr_humano_aberturas: normalizarArray(
      base.ocr_humano_aberturas,
      MENSAGENS_FLUXO_PADRAO.ocr_humano_aberturas,
    ),
    ocr_humano_documento_salvo_com_detalhes: String(
      base.ocr_humano_documento_salvo_com_detalhes,
    ).trim(),
    ocr_humano_documento_salvo_sem_detalhes: String(
      base.ocr_humano_documento_salvo_sem_detalhes,
    ).trim(),
    ocr_humano_confirmacao_com_detalhes: String(
      base.ocr_humano_confirmacao_com_detalhes,
    ).trim(),
    ocr_humano_confirmacao_sem_detalhes: String(
      base.ocr_humano_confirmacao_sem_detalhes,
    ).trim(),
    ocr_humano_confirmada_com_detalhes: String(
      base.ocr_humano_confirmada_com_detalhes,
    ).trim(),
    ocr_humano_confirmada_sem_detalhes: String(
      base.ocr_humano_confirmada_sem_detalhes,
    ).trim(),
  };
}

export async function obterConfigMensagensFluxo(): Promise<ConfigMensagensFluxo> {
  if (cache && Date.now() - cacheEm < CACHE_TTL_MS) return cache;
  try {
    const res = await pool.query('SELECT valor FROM configuracao WHERE chave = $1', [CHAVE]);
    if (res.rowCount && res.rows[0]?.valor) {
      const parsed = JSON.parse(res.rows[0].valor as string) as Partial<ConfigMensagensFluxo>;
      cache = normalizar(parsed);
      cacheEm = Date.now();
      return cache;
    }
  } catch {
    /* tabela pode nao existir ainda */
  }
  cache = { ...MENSAGENS_FLUXO_PADRAO };
  cacheEm = Date.now();
  return cache;
}

export async function obterConfigMensagensFluxoMeta(): Promise<{
  config: ConfigMensagensFluxo;
  padrao: ConfigMensagensFluxo;
  atualizadoEm: string | null;
}> {
  try {
    const res = await pool.query(
      'SELECT valor, atualizado_em FROM configuracao WHERE chave = $1',
      [CHAVE],
    );
    if (res.rowCount && res.rows[0]?.valor) {
      const parsed = JSON.parse(res.rows[0].valor as string) as Partial<ConfigMensagensFluxo>;
      return {
        config: normalizar(parsed),
        padrao: MENSAGENS_FLUXO_PADRAO,
        atualizadoEm: res.rows[0].atualizado_em
          ? new Date(res.rows[0].atualizado_em as string).toISOString()
          : null,
      };
    }
  } catch {
    /* ignora */
  }
  return {
    config: { ...MENSAGENS_FLUXO_PADRAO },
    padrao: MENSAGENS_FLUXO_PADRAO,
    atualizadoEm: null,
  };
}

export async function salvarConfigMensagensFluxo(
  dados: Partial<ConfigMensagensFluxo>,
  origem = 'api_admin',
): Promise<ConfigMensagensFluxo> {
  const atual = await obterConfigMensagensFluxo();
  const normalizado = normalizar({ ...atual, ...dados });
  await pool.query(
    `INSERT INTO configuracao (chave, valor, atualizado_em)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = NOW()`,
    [CHAVE, JSON.stringify(normalizado)],
  );
  await registrarHistoricoConfiguracao({
    chave: CHAVE,
    antes: JSON.stringify(atual, null, 2),
    depois: JSON.stringify(normalizado, null, 2),
    origem,
  });
  cache = normalizado;
  cacheEm = Date.now();
  return normalizado;
}

export function interpolarMensagem(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? '');
}
