/**
 * Esquema editavel dos documentos OCR e seus campos.
 * Controla o mapeamento final para o Directus e reforca o prompt.
 * Mantem tudo na mesma base configuravel do painel admin.
 */
import pg from 'pg';
import { config } from '../config.js';
import { registrarHistoricoConfiguracao } from './historico-configuracao.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const CHAVE = 'ocr_documentos_schema';

export interface OcrCampoConfig {
  id: string;
  rotulo: string;
  chaveExtraida: string;
  campoDirectus: string;
  destino: 'documento' | 'motorista';
  regex?: string;
}

export interface OcrDocumentoConfig {
  id: string;
  rotulo: string;
  tipoDocumento: string;
  colecao: string;
  dicaPrompt: string;
  ativo: boolean;
  campos: OcrCampoConfig[];
}

function nId(valor: unknown): string {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function nCampo(item: unknown): OcrCampoConfig | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const chaveExtraida = nId(raw.chaveExtraida);
  const campoDirectus = nId(raw.campoDirectus);
  if (!chaveExtraida || !campoDirectus) return null;
  return {
    id: nId(raw.id || `${chaveExtraida}_${campoDirectus}`),
    rotulo: String(raw.rotulo || chaveExtraida).trim().slice(0, 80),
    chaveExtraida,
    campoDirectus,
    destino: raw.destino === 'motorista' ? 'motorista' : 'documento',
    regex: String(raw.regex || '').trim() || undefined,
  };
}

function nDocumento(item: unknown): OcrDocumentoConfig | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const id = nId(raw.id || raw.tipoDocumento);
  const tipoDocumento = nId(raw.tipoDocumento || id);
  const colecao = nId(raw.colecao);
  if (!id || !tipoDocumento || !colecao) return null;
  const campos = Array.isArray(raw.campos) ? raw.campos.map(nCampo).filter(Boolean) as OcrCampoConfig[] : [];
  return {
    id,
    rotulo: String(raw.rotulo || tipoDocumento).trim().slice(0, 100),
    tipoDocumento,
    colecao,
    dicaPrompt: String(raw.dicaPrompt || '').trim().slice(0, 300),
    ativo: raw.ativo !== false,
    campos,
  };
}

function padrao(): OcrDocumentoConfig[] {
  return [
    {
      id: 'cnh',
      rotulo: 'CNH',
      tipoDocumento: 'cnh',
      colecao: 'cnh',
      dicaPrompt: 'Priorize nome, CPF, datas, registro, formulario, renach, categoria e cidade de emissao',
      ativo: true,
      campos: [
        { id: 'cnh_nome_doc', rotulo: 'Nome', chaveExtraida: 'nome', campoDirectus: 'nome', destino: 'documento' },
        { id: 'cnh_nome_motorista', rotulo: 'Nome motorista', chaveExtraida: 'nome', campoDirectus: 'nome', destino: 'motorista' },
        { id: 'cnh_cpf_doc', rotulo: 'CPF', chaveExtraida: 'cpf', campoDirectus: 'cpf', destino: 'documento' },
        { id: 'cnh_cpf_motorista', rotulo: 'CPF motorista', chaveExtraida: 'cpf', campoDirectus: 'cpf', destino: 'motorista' },
        { id: 'cnh_data_nasc', rotulo: 'Data nascimento', chaveExtraida: 'data_nasc', campoDirectus: 'data_nasc', destino: 'documento' },
        { id: 'cnh_nome_mae', rotulo: 'Nome mae', chaveExtraida: 'nome_mae', campoDirectus: 'nome_mae', destino: 'documento' },
        { id: 'cnh_registro', rotulo: 'Registro CNH', chaveExtraida: 'n_registro_cnh', campoDirectus: 'n_registro_cnh', destino: 'documento', regex: '(?:registro|n[°º.]?\\s*reg)[:\\s]*(\\d{9,11})' },
        { id: 'cnh_formulario', rotulo: 'Formulario CNH', chaveExtraida: 'n_formulario_cnh', campoDirectus: 'n_formulario_cnh', destino: 'documento' },
        { id: 'cnh_categoria', rotulo: 'Categoria', chaveExtraida: 'categoria', campoDirectus: 'categoria', destino: 'documento' },
        { id: 'cnh_validade', rotulo: 'Validade', chaveExtraida: 'validade', campoDirectus: 'validade', destino: 'documento' },
        { id: 'cnh_emissao', rotulo: 'Emissao CNH', chaveExtraida: 'emissao_cnh', campoDirectus: 'emissao_cnh', destino: 'documento' },
        { id: 'cnh_seguranca', rotulo: 'CNH seguranca', chaveExtraida: 'n_cnh_seguranca', campoDirectus: 'n_cnh_seguranca', destino: 'documento' },
        { id: 'cnh_renach', rotulo: 'CNH renach', chaveExtraida: 'n_cnh_renach', campoDirectus: 'n_cnh_renach', destino: 'documento' },
        { id: 'cnh_primeira', rotulo: 'Primeira habilitacao', chaveExtraida: 'primeira_habilitacao', campoDirectus: 'primeira_habilitacao', destino: 'documento' },
        { id: 'cnh_cidade_emissao', rotulo: 'Cidade emissao', chaveExtraida: 'cidade_emissao', campoDirectus: 'cidade_emissao', destino: 'documento' },
      ],
    },
    {
      id: 'crlv',
      rotulo: 'CRLV',
      tipoDocumento: 'crlv',
      colecao: 'crlv',
      dicaPrompt: 'Priorize placa, proprietario, CPF ou CNPJ, RENAVAM, modelo, anos, certificado e chassi',
      ativo: true,
      campos: [
        { id: 'crlv_placa', rotulo: 'Placa', chaveExtraida: 'placa', campoDirectus: 'placa_cavalo', destino: 'documento' },
        { id: 'crlv_cnpj_cpf', rotulo: 'CPF ou CNPJ', chaveExtraida: 'cnpj_cpf', campoDirectus: 'cnpj_cpf', destino: 'documento' },
        { id: 'crlv_nome_proprietario', rotulo: 'Nome proprietario', chaveExtraida: 'nome_proprietario', campoDirectus: 'nome_proprietario', destino: 'documento' },
        { id: 'crlv_renavam', rotulo: 'RENAVAM', chaveExtraida: 'renavam', campoDirectus: 'renavam', destino: 'documento' },
        { id: 'crlv_modelo', rotulo: 'Modelo', chaveExtraida: 'modelo', campoDirectus: 'modelo', destino: 'documento' },
        { id: 'crlv_ano_fabricacao', rotulo: 'Ano fabricacao', chaveExtraida: 'ano_fabricacao', campoDirectus: 'ano_fabricacao', destino: 'documento' },
        { id: 'crlv_ano_modelo', rotulo: 'Ano modelo', chaveExtraida: 'ano_modelo', campoDirectus: 'ano_modelo', destino: 'documento' },
        { id: 'crlv_nr_certificado', rotulo: 'Numero certificado', chaveExtraida: 'nr_certificado', campoDirectus: 'nr_certificado', destino: 'documento' },
        { id: 'crlv_exercicio_doc', rotulo: 'Exercicio documento', chaveExtraida: 'exercicio_doc', campoDirectus: 'exercicio_doc', destino: 'documento' },
        { id: 'crlv_cor', rotulo: 'Cor', chaveExtraida: 'cor', campoDirectus: 'cor', destino: 'documento' },
        { id: 'crlv_chassi', rotulo: 'Chassi', chaveExtraida: 'chassi', campoDirectus: 'chassi', destino: 'documento' },
        { id: 'crlv_cidade_emplacado', rotulo: 'Cidade emplacado', chaveExtraida: 'cidade_emplacado', campoDirectus: 'cidade_emplacado', destino: 'documento' },
      ],
    },
    {
      id: 'antt',
      rotulo: 'ANTT',
      tipoDocumento: 'antt',
      colecao: 'antt',
      dicaPrompt: 'Priorize numero ANTT, CPF ou CNPJ e nome do transportador',
      ativo: true,
      campos: [
        { id: 'antt_numero', rotulo: 'Numero ANTT', chaveExtraida: 'numero_antt', campoDirectus: 'numero_antt', destino: 'documento' },
        { id: 'antt_rntrc', rotulo: 'RNTRC', chaveExtraida: 'rntrc', campoDirectus: 'numero_antt', destino: 'documento' },
        { id: 'antt_cnpj_cpf', rotulo: 'CPF ou CNPJ', chaveExtraida: 'cnpj_cpf', campoDirectus: 'cnpj_cpf', destino: 'documento' },
        { id: 'antt_nome', rotulo: 'Nome', chaveExtraida: 'nome', campoDirectus: 'nome', destino: 'documento' },
      ],
    },
    {
      id: 'endereco',
      rotulo: 'Comprovante De Endereco',
      tipoDocumento: 'endereco',
      colecao: 'comprovante_endereco',
      dicaPrompt: 'Priorize CEP e preserve o texto bruto do endereco no OCR',
      ativo: true,
      campos: [
        { id: 'endereco_cep', rotulo: 'CEP', chaveExtraida: 'cep', campoDirectus: 'cep', destino: 'documento', regex: '\\b(\\d{5}-?\\d{3})\\b' },
        { id: 'endereco_cep_motorista', rotulo: 'CEP motorista', chaveExtraida: 'cep', campoDirectus: 'cep_residencia', destino: 'motorista', regex: '\\b(\\d{5}-?\\d{3})\\b' },
      ],
    },
    {
      id: 'foto',
      rotulo: 'Foto Do Caminhao',
      tipoDocumento: 'foto',
      colecao: 'fotos',
      dicaPrompt: 'Nao precisa extrair campos, apenas salvar a imagem correta',
      ativo: true,
      campos: [],
    },
  ];
}

async function cru(): Promise<{ valor: string; atualizadoEm: string | null } | null> {
  const res = await pool.query('SELECT valor, atualizado_em FROM configuracao WHERE chave = $1', [CHAVE]);
  if (!res.rowCount) return null;
  return {
    valor: String(res.rows[0].valor || '[]'),
    atualizadoEm: res.rows[0]?.atualizado_em ? new Date(res.rows[0].atualizado_em as string).toISOString() : null,
  };
}

function validar(documentos: OcrDocumentoConfig[]): OcrDocumentoConfig[] {
  const ids = new Set<string>();
  const saida: OcrDocumentoConfig[] = [];
  for (const item of documentos) {
    const doc = nDocumento(item);
    if (!doc) continue;
    if (ids.has(doc.id)) throw new Error(`Documento OCR duplicado: ${doc.id}`);
    ids.add(doc.id);
    saida.push(doc);
  }
  return saida;
}

export async function listarOcrDocumentos(): Promise<OcrDocumentoConfig[]> {
  const salvo = await cru().catch(() => null);
  if (!salvo) return padrao();
  try {
    const bruto = JSON.parse(salvo.valor);
    if (!Array.isArray(bruto)) return padrao();
    const docs = validar(bruto as OcrDocumentoConfig[]);
    return docs.length ? docs : padrao();
  } catch {
    return padrao();
  }
}

export async function obterOcrDocumentosMeta(): Promise<{
  documentos: OcrDocumentoConfig[];
  atualizadoEm: string | null;
}> {
  const salvo = await cru().catch(() => null);
  return { documentos: await listarOcrDocumentos(), atualizadoEm: salvo?.atualizadoEm ?? null };
}

async function salvar(documentos: OcrDocumentoConfig[], origem: string): Promise<OcrDocumentoConfig[]> {
  const atual = await cru().catch(() => null);
  const validado = validar(documentos);
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

export async function salvarOcrDocumentos(documentos: OcrDocumentoConfig[], origem: string): Promise<OcrDocumentoConfig[]> {
  return salvar(documentos, origem);
}

export async function criarOcrDocumento(item: OcrDocumentoConfig): Promise<OcrDocumentoConfig[]> {
  const docs = await listarOcrDocumentos();
  const novo = nDocumento(item);
  if (!novo) throw new Error('Documento OCR invalido');
  if (docs.some((doc) => doc.id === novo.id)) throw new Error('Ja existe um documento com esse id');
  return salvar([...docs, novo], 'api_admin_ocr_doc_create');
}

export async function atualizarOcrDocumento(id: string, item: OcrDocumentoConfig): Promise<OcrDocumentoConfig[]> {
  const docs = await listarOcrDocumentos();
  const alvo = nId(id);
  const novo = nDocumento({ ...item, id: item.id || alvo });
  if (!novo) throw new Error('Documento OCR invalido');
  if (!docs.some((doc) => doc.id === alvo)) throw new Error('Documento OCR nao encontrado');
  if (novo.id !== alvo && docs.some((doc) => doc.id === novo.id)) throw new Error('Ja existe outro documento com esse id');
  return salvar(docs.map((doc) => (doc.id === alvo ? novo : doc)), 'api_admin_ocr_doc_update');
}

export async function removerOcrDocumento(id: string): Promise<OcrDocumentoConfig[]> {
  const docs = await listarOcrDocumentos();
  const alvo = nId(id);
  if (!docs.some((doc) => doc.id === alvo)) throw new Error('Documento OCR nao encontrado');
  return salvar(docs.filter((doc) => doc.id !== alvo), 'api_admin_ocr_doc_delete');
}

export async function montarResumoSchemaOcr(): Promise<string> {
  const docs = (await listarOcrDocumentos()).filter((doc) => doc.ativo);
  if (!docs.length) return '';
  const linhas = docs.map((doc) => {
    const campos = doc.campos.map((campo) => `${campo.chaveExtraida}->${campo.campoDirectus}/${campo.destino}`).join(', ') || 'sem campos estruturados';
    return `- ${doc.tipoDocumento} / ${doc.colecao}: ${campos}${doc.dicaPrompt ? ` | ${doc.dicaPrompt}` : ''}`;
  });
  return ['DOCUMENTOS E CAMPOS GMX PARA OCR:', ...linhas, 'Quando encontrar esses campos, preserve os rótulos e valores com fidelidade.'].join('\n');
}

export async function resolverMapeamentoOcr(
  tipoDocumento: string,
  camposInformados?: Record<string, unknown>,
  textoExtraido?: string,
): Promise<{ colecao: string | null; documento: Record<string, unknown>; motorista: Record<string, unknown> }> {
  const tipo = nId(tipoDocumento);
  const doc = (await listarOcrDocumentos()).find((item) => item.id === tipo || item.tipoDocumento === tipo);
  const base = { ...(camposInformados || {}) } as Record<string, unknown>;
  for (const campo of doc?.campos || []) {
    if (base[campo.chaveExtraida] || !campo.regex || !textoExtraido) continue;
    const regex = new RegExp(campo.regex, 'i');
    const valor = textoExtraido.match(regex)?.[1]?.trim();
    if (valor) base[campo.chaveExtraida] = valor;
  }
  const documento: Record<string, unknown> = {};
  const motorista: Record<string, unknown> = {};
  for (const campo of doc?.campos || []) {
    const valor = base[campo.chaveExtraida];
    if (valor == null || String(valor).trim() === '') continue;
    if (campo.destino === 'motorista') motorista[campo.campoDirectus] = valor;
    else documento[campo.campoDirectus] = valor;
  }
  return { colecao: doc?.colecao ?? null, documento, motorista };
}
