/**
 * Consolida documentos do motorista em um bloco deterministico para a IA.
 * Distingue documento ausente, cadastro parcial e anexo pendente.
 * Mantem o contexto curto, mas detalhado o bastante para responder faltas.
 */
import { directusListar } from './directus.js';
import type { DocumentoPrioridade } from './contexto-erp-prioridades.js';

interface CampoDocumento {
  campo: string;
  rotulo: string;
}

interface DefinicaoDocumento {
  colecao: string;
  label: string;
  obrigatorio: boolean;
  campos: CampoDocumento[];
  anexos?: string[];
  criticos?: string[];
}

export interface DocumentoMotoristaContexto extends DocumentoPrioridade {
  atualizadoEm?: string;
  detalhe: string;
  pendencias: string[];
}

const DEFINICOES_DOCUMENTO: DefinicaoDocumento[] = [
  {
    colecao: 'cnh',
    label: 'CNH',
    obrigatorio: true,
    anexos: ['link'],
    criticos: ['cpf', 'nome', 'validade', 'categoria'],
    campos: [
      { campo: 'cpf', rotulo: 'CPF' },
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'data_nasc', rotulo: 'Data nasc' },
      { campo: 'nome_mae', rotulo: 'Nome mae' },
      { campo: 'n_registro_cnh', rotulo: 'Registro CNH' },
      { campo: 'n_formulario_cnh', rotulo: 'Formulario CNH' },
      { campo: 'validade', rotulo: 'Validade' },
      { campo: 'emissao_cnh', rotulo: 'Emissao CNH' },
      { campo: 'n_cnh_seguranca', rotulo: 'CNH seguranca' },
      { campo: 'n_cnh_renach', rotulo: 'CNH renach' },
      { campo: 'primeira_habilitacao', rotulo: 'Primeira habilitacao' },
      { campo: 'categoria', rotulo: 'Categoria' },
      { campo: 'cidade_emissao', rotulo: 'Cidade emissao' },
    ],
  },
  {
    colecao: 'crlv',
    label: 'CRLV cavalo',
    obrigatorio: true,
    anexos: ['link'],
    criticos: ['placa_cavalo', 'renavam'],
    campos: [
      { campo: 'placa_cavalo', rotulo: 'Placa' },
      { campo: 'nome_proprietario', rotulo: 'Proprietario' },
      { campo: 'cnpj_cpf', rotulo: 'CPF/CNPJ' },
      { campo: 'renavam', rotulo: 'Renavam' },
      { campo: 'modelo', rotulo: 'Modelo' },
      { campo: 'ano_fabricacao', rotulo: 'Ano fab' },
      { campo: 'ano_modelo', rotulo: 'Ano mod' },
      { campo: 'nr_certificado', rotulo: 'Nr certificado' },
      { campo: 'exercicio_doc', rotulo: 'Exercicio doc' },
      { campo: 'cor', rotulo: 'Cor' },
      { campo: 'chassi', rotulo: 'Chassi' },
      { campo: 'cidade_emplacado', rotulo: 'Cidade emplacado' },
    ],
  },
  {
    colecao: 'antt',
    label: 'ANTT cavalo',
    obrigatorio: true,
    anexos: ['link'],
    criticos: ['numero_antt'],
    campos: [
      { campo: 'numero_antt', rotulo: 'Numero ANTT' },
      { campo: 'cnpj_cpf', rotulo: 'CPF/CNPJ' },
      { campo: 'nome', rotulo: 'Nome' },
    ],
  },
  {
    colecao: 'comprovante_endereco',
    label: 'Comprovante endereco',
    obrigatorio: true,
    anexos: ['link'],
    criticos: ['cep'],
    campos: [
      { campo: 'nome', rotulo: 'Nome' },
      { campo: 'cep', rotulo: 'CEP' },
    ],
  },
  {
    colecao: 'fotos',
    label: 'Fotos caminhao',
    obrigatorio: false,
    anexos: ['foto_cavalo', 'foto_lateral', 'foto_traseira'],
    campos: [
      { campo: 'foto_cavalo', rotulo: 'Foto cavalo' },
      { campo: 'foto_lateral', rotulo: 'Foto lateral' },
      { campo: 'foto_traseira', rotulo: 'Foto traseira' },
    ],
  },
  {
    colecao: 'carreta_1',
    label: 'Carreta 1',
    obrigatorio: false,
    anexos: ['link'],
    campos: [
      { campo: 'placa', rotulo: 'Placa' },
      { campo: 'renavam', rotulo: 'Renavam' },
      { campo: 'proprietario_documento', rotulo: 'Proprietario' },
      { campo: 'cnpj_cpf_proprietario', rotulo: 'CPF/CNPJ' },
      { campo: 'modelo', rotulo: 'Modelo' },
      { campo: 'ano_fabricacao', rotulo: 'Ano fab' },
      { campo: 'ano_modelo', rotulo: 'Ano mod' },
      { campo: 'antt_numero', rotulo: 'Numero ANTT' },
      { campo: 'antt_cnpj_cpf', rotulo: 'ANTT CPF/CNPJ' },
      { campo: 'antt_nome', rotulo: 'ANTT nome' },
    ],
  },
  {
    colecao: 'carreta_2',
    label: 'Carreta 2',
    obrigatorio: false,
    anexos: ['link'],
    campos: [
      { campo: 'placa', rotulo: 'Placa' },
      { campo: 'renavam', rotulo: 'Renavam' },
      { campo: 'proprietario_documento', rotulo: 'Proprietario' },
      { campo: 'cnpj_cpf_proprietario', rotulo: 'CPF/CNPJ' },
      { campo: 'modelo', rotulo: 'Modelo' },
      { campo: 'ano_fabricacao', rotulo: 'Ano fab' },
      { campo: 'ano_modelo', rotulo: 'Ano mod' },
      { campo: 'antt_numero', rotulo: 'Numero ANTT' },
      { campo: 'antt_cnpj_cpf', rotulo: 'ANTT CPF/CNPJ' },
      { campo: 'antt_nome', rotulo: 'ANTT nome' },
    ],
  },
  {
    colecao: 'carreta_3',
    label: 'Carreta 3',
    obrigatorio: false,
    anexos: ['link'],
    campos: [
      { campo: 'placa', rotulo: 'Placa' },
      { campo: 'renavam', rotulo: 'Renavam' },
      { campo: 'proprietario_documento', rotulo: 'Proprietario' },
      { campo: 'cnpj_cpf_proprietario', rotulo: 'CPF/CNPJ' },
      { campo: 'modelo', rotulo: 'Modelo' },
      { campo: 'ano_fabricacao', rotulo: 'Ano fab' },
      { campo: 'ano_modelo', rotulo: 'Ano mod' },
      { campo: 'antt_numero', rotulo: 'Numero ANTT' },
      { campo: 'antt_cnpj_cpf', rotulo: 'ANTT CPF/CNPJ' },
      { campo: 'antt_nome', rotulo: 'ANTT nome' },
    ],
  },
];

function temValor(valor: unknown): boolean {
  if (valor == null) return false;
  const texto = String(valor).trim();
  return texto !== '' && texto !== '-' && texto !== '—' && texto.toLowerCase() !== 'null';
}

function resumirCampos(def: DefinicaoDocumento, registro: Record<string, unknown>): string[] {
  return def.campos
    .filter(({ campo }) => temValor(registro[campo]))
    .map(({ campo, rotulo }) => `${rotulo}=${String(registro[campo]).trim()}`);
}

export function avaliarDocumentoParaTeste(
  def: DefinicaoDocumento,
  registro: Record<string, unknown> | null,
  formatarData: (iso?: string) => string,
): DocumentoMotoristaContexto {
  if (!registro) {
    return {
      label: def.label,
      obrigatorio: def.obrigatorio,
      presente: false,
      pendencias: ['sem registro'],
      detalhe: `- ${def.label}: pendente total`,
    };
  }
  const temAnexo = (def.anexos ?? []).some((campo) => temValor(registro[campo]));
  const faltasCriticas = (def.criticos ?? [])
    .filter((campo) => !temValor(registro[campo]))
    .map((campo) => def.campos.find((item) => item.campo === campo)?.rotulo ?? campo);
  const pendencias = [...faltasCriticas];
  if ((def.anexos ?? []).length > 0 && !temAnexo) pendencias.push('anexo');
  const dados = resumirCampos(def, registro);
  const atualizadoEm = formatarData(
    (registro.date_updated as string) ?? (registro.date_created as string),
  );
  const status = !dados.length && !temAnexo
    ? 'pendente total'
    : pendencias.length
      ? 'cadastro parcial'
      : 'ok';
  const detalhe = [
    `- ${def.label}: ${status}`,
    dados.length ? `dados ${dados.join(', ')}` : 'dados sem preenchimento util',
    pendencias.length ? `faltas ${pendencias.join(', ')}` : 'faltas nenhuma',
    `atualizado ${atualizadoEm}`,
  ].join(' | ');
  return {
    label: def.label,
    obrigatorio: def.obrigatorio,
    presente: (def.anexos ?? []).length > 0 ? temAnexo : dados.length > 0,
    atualizadoEm,
    pendencias,
    detalhe,
  };
}

export async function obterDocumentosDetalhadosMotorista(
  motoristaId: number,
  formatarData: (iso?: string) => string,
): Promise<DocumentoMotoristaContexto[]> {
  const itens = await Promise.all(
    DEFINICOES_DOCUMENTO.map(async (def) => {
      const registros = await directusListar<Record<string, unknown>>(def.colecao, {
        'filter[motorista_id][_eq]': String(motoristaId),
        sort: '-date_updated,-date_created',
        limit: '1',
        fields: [
          ...new Set([
            ...def.campos.map((item) => item.campo),
            ...(def.anexos ?? []),
            'date_updated',
            'date_created',
          ]),
        ].join(','),
      }).catch(() => []);
      return avaliarDocumentoParaTeste(def, registros[0] ?? null, formatarData);
    }),
  );
  return itens;
}
