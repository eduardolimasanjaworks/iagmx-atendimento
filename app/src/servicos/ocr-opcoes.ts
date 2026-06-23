/**
 * Opcoes assertivas do OCR exibidas no painel.
 * Troca campos livres por listas guiadas de tipo, area e destino.
 * Tambem valida o schema antes de salvar configuracoes novas.
 */
type Opt = { value: string; label: string };

const TIPOS: Opt[] = [
  { value: 'cnh', label: 'CNH' },
  { value: 'crlv', label: 'CRLV' },
  { value: 'antt', label: 'ANTT' },
  { value: 'endereco', label: 'Comprovante de endereco' },
  { value: 'foto', label: 'Foto do caminhao' },
];

const AREAS: Opt[] = [
  { value: 'cnh', label: 'Documento CNH' },
  { value: 'crlv', label: 'Documento CRLV' },
  { value: 'antt', label: 'Documento ANTT' },
  { value: 'comprovante_endereco', label: 'Documento comprovante de endereco' },
  { value: 'fotos', label: 'Fotos do veiculo' },
];

const CHAVES_POR_TIPO: Record<string, Opt[]> = {
  cnh: 'nome,cpf,data_nasc,nome_mae,n_registro_cnh,n_formulario_cnh,categoria,validade,emissao_cnh,n_cnh_seguranca,n_cnh_renach,primeira_habilitacao,cidade_emissao'
    .split(',').map((value) => ({ value, label: value })),
  crlv: 'placa,cnpj_cpf,nome_proprietario,renavam,modelo,ano_fabricacao,ano_modelo,nr_certificado,exercicio_doc,cor,chassi,cidade_emplacado'
    .split(',').map((value) => ({ value, label: value })),
  antt: 'numero_antt,rntrc,cnpj_cpf,nome'.split(',').map((value) => ({ value, label: value })),
  endereco: 'cep'.split(',').map((value) => ({ value, label: value })),
  foto: [],
};

const CAMPOS_AREA: Record<string, Opt[]> = {
  cnh: 'nome,cpf,data_nasc,nome_mae,n_registro_cnh,n_formulario_cnh,categoria,validade,emissao_cnh,n_cnh_seguranca,n_cnh_renach,primeira_habilitacao,cidade_emissao'
    .split(',').map((value) => ({ value, label: value })),
  crlv: 'placa_cavalo,cnpj_cpf,nome_proprietario,renavam,modelo,ano_fabricacao,ano_modelo,nr_certificado,exercicio_doc,cor,chassi,cidade_emplacado'
    .split(',').map((value) => ({ value, label: value })),
  antt: 'numero_antt,cnpj_cpf,nome'.split(',').map((value) => ({ value, label: value })),
  comprovante_endereco: 'cep,nome'.split(',').map((value) => ({ value, label: value })),
  fotos: 'foto_cavalo,foto_lateral,foto_traseira'.split(',').map((value) => ({ value, label: value })),
};

const CAMPOS_CADASTRO: Opt[] = [
  'nome,sobrenome,telefone,cpf,cidade,estado,cep_residencia,status_cadastro,status_validade_cnh,tipo_veiculo,tipo_carroceria,tipo_rota,quantidade_eixo,observacao,forma_pagamento,vencimento_cx,venc_cx,cadastro_cx,card_cx,cliente,pis,nome_mae,data_nascimento,quinta_roda,rastreador,proprietario_rastreador',
].flatMap((raw) => raw.split(',')).map((value) => ({ value, label: value }));

function values(list: Opt[]): Set<string> {
  return new Set(list.map((item) => item.value));
}

export function obterOcrOpcoes() {
  return {
    tiposDocumento: TIPOS,
    areasBanco: AREAS,
    chavesPorTipo: CHAVES_POR_TIPO,
    camposAreaPorDestino: CAMPOS_AREA,
    camposCadastro: CAMPOS_CADASTRO,
  };
}

export function validarOcrAssertivo(item: {
  tipoDocumento?: string;
  colecao?: string;
  campos?: Array<{ chaveExtraida?: string; campoDirectus?: string; destino?: string }>;
}): void {
  if (!values(TIPOS).has(String(item.tipoDocumento || ''))) throw new Error('Escolha um tipo de documento valido');
  const area = String(item.colecao || '');
  if (!values(AREAS).has(area)) throw new Error('Escolha uma area valida do banco de dados');
  const chaves = values(CHAVES_POR_TIPO[String(item.tipoDocumento || '')] || []);
  const camposArea = values(CAMPOS_AREA[area] || []);
  const camposCadastro = values(CAMPOS_CADASTRO);
  for (const campo of item.campos || []) {
    const chave = String(campo.chaveExtraida || '');
    const destino = campo.destino === 'motorista' ? 'motorista' : 'documento';
    const salvo = String(campo.campoDirectus || '');
    if (!chaves.has(chave)) throw new Error(`Campo OCR invalido: ${chave || 'vazio'}`);
    if (destino === 'motorista' && !camposCadastro.has(salvo)) throw new Error(`Campo de cadastro invalido: ${salvo || 'vazio'}`);
    if (destino === 'documento' && !camposArea.has(salvo)) throw new Error(`Campo do banco invalido para a area escolhida: ${salvo || 'vazio'}`);
  }
}
