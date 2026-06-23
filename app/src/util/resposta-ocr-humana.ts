/**
 * Textos humanos para confirmação de leitura OCR — tom WhatsApp GMX.
 * Vírgulas separam bolhas no envio; sem ponto final.
 */
import type { PassoCadastro } from '../servicos/fluxo-cadastro.js';
import { obterConfigMensagensFluxo, interpolarMensagem } from '../servicos/config-mensagens-fluxo.js';

const ROTULOS: Record<PassoCadastro, string> = {
  cnh: 'CNH',
  crlv: 'CRLV',
  antt: 'ANTT',
  endereco: 'comprovante de endereço',
  caminhao: 'foto do caminhão',
};

async function escolherAbertura(semente: string): Promise<string> {
  const cfg = await obterConfigMensagensFluxo();
  const aberturas = cfg.ocr_humano_aberturas.length
    ? cfg.ocr_humano_aberturas
    : ['Opa recebi a foto aqui'];
  let n = 0;
  for (let i = 0; i < semente.length; i++) n += semente.charCodeAt(i);
  return aberturas[n % aberturas.length];
}

function fraseCampos(tipo: PassoCadastro, campos: Record<string, string>): string {
  const p: string[] = [];

  switch (tipo) {
    case 'cnh':
      if (campos.nome) p.push(`nome ${campos.nome}`);
      if (campos.cpf) p.push(`CPF ${campos.cpf}`);
      if (campos.registro) {
        p.push(
          campos.categoria
            ? `registro ${campos.registro} cat ${campos.categoria}`
            : `registro ${campos.registro}`,
        );
      } else if (campos.categoria) {
        p.push(`categoria ${campos.categoria}`);
      }
      if (campos.validade) p.push(`validade ${campos.validade}`);
      break;
    case 'crlv':
      if (campos.placa) p.push(`placa ${campos.placa}`);
      if (campos.renavam) p.push(`RENAVAM ${campos.renavam}`);
      if (campos.nome) p.push(`proprietário ${campos.nome}`);
      break;
    case 'antt':
      if (campos.rntrc) p.push(`RNTRC ${campos.rntrc}`);
      if (campos.nome) p.push(`transportador ${campos.nome}`);
      break;
    case 'endereco':
      if (campos.nome) p.push(`titular ${campos.nome}`);
      break;
    case 'caminhao':
      if (campos.placa) p.push(`placa ${campos.placa}`);
      break;
  }

  return p.join(', ');
}

/** Documento lido com confiança — prova o que entendeu e confirma gravação. */
export async function montarRespostaDocumentoSalvo(opts: {
  tipo: PassoCadastro;
  campos: Record<string, string>;
  telefone: string;
}): Promise<string> {
  const { tipo, campos, telefone } = opts;
  const cfg = await obterConfigMensagensFluxo();
  const doc = ROTULOS[tipo];
  const abertura = await escolherAbertura(telefone);
  const detalhes = fraseCampos(tipo, campos);

  if (detalhes) {
    return interpolarMensagem(cfg.ocr_humano_documento_salvo_com_detalhes, {
      abertura,
      doc,
      detalhes,
    });
  }
  return interpolarMensagem(cfg.ocr_humano_documento_salvo_sem_detalhes, {
    abertura,
    doc,
  });
}

/** OCR incerto — mostra o que leu e pede confirmação humana. */
export async function montarRespostaConfirmacaoOcr(opts: {
  tipo: PassoCadastro;
  campos: Record<string, string>;
  telefone: string;
}): Promise<string> {
  const { tipo, campos, telefone } = opts;
  const cfg = await obterConfigMensagensFluxo();
  const doc = ROTULOS[tipo];
  const abertura = await escolherAbertura(telefone);
  const detalhes = fraseCampos(tipo, campos);

  if (detalhes) {
    return interpolarMensagem(cfg.ocr_humano_confirmacao_com_detalhes, {
      abertura,
      doc,
      detalhes,
    });
  }
  return interpolarMensagem(cfg.ocr_humano_confirmacao_sem_detalhes, {
    abertura,
    doc,
  });
}

/** Após motorista confirmar leitura incerta. */
export async function montarRespostaConfirmada(opts: {
  tipo: PassoCadastro;
  campos: Record<string, string>;
}): Promise<string> {
  const cfg = await obterConfigMensagensFluxo();
  const doc = ROTULOS[opts.tipo];
  const detalhes = fraseCampos(opts.tipo, opts.campos);
  if (detalhes) {
    return interpolarMensagem(cfg.ocr_humano_confirmada_com_detalhes, {
      doc,
      detalhes,
    });
  }
  return interpolarMensagem(cfg.ocr_humano_confirmada_sem_detalhes, {
    doc,
  });
}

export async function obterMensagemAtualizacaoFotoIlegivel(): Promise<string> {
  return (await obterConfigMensagensFluxo()).atualizacao_foto_ilegivel;
}

export async function obterMensagemAtualizacaoOcrRecusa(): Promise<string> {
  return (await obterConfigMensagensFluxo()).atualizacao_ocr_recusa;
}

export async function obterMensagemAtualizacaoTipoIncerto(): Promise<string> {
  return (await obterConfigMensagensFluxo()).atualizacao_tipo_incerto;
}

export async function obterMensagemAtualizacaoTipoIncertoComTexto(trecho: string): Promise<string> {
  const cfg = await obterConfigMensagensFluxo();
  return interpolarMensagem(cfg.atualizacao_tipo_incerto_com_texto, { trecho });
}

export async function obterMensagemAtualizacaoConfirmacaoNegada(): Promise<string> {
  return (await obterConfigMensagensFluxo()).atualizacao_confirmacao_negada;
}

export async function obterMensagemAtualizacaoPedirFoto(): Promise<string> {
  return (await obterConfigMensagensFluxo()).atualizacao_pedir_foto;
}
