/**
 * Montagem de mensagem de oferta — texto fixo do ERP (nunca LLM).
 */
import { interpolarMensagem } from './config-mensagens-fluxo.js';

export interface DadosOfertaDisparo {
  origem: string;
  destino: string;
  operacao?: string;
  valorOfertado: number;
  produto?: string;
}

function limparTemplateRenderizado(texto: string): string {
  return texto
    .split('\n')
    .map((linha) => linha.replace(/[ \t]+$/g, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function montarMensagemOferta(
  dados: DadosOfertaDisparo,
  template?: string | null,
): string {
  const valor = Number(dados.valorOfertado);
  const valorFmt = Number.isFinite(valor)
    ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
    : '—';

  if (String(template ?? '').trim()) {
    return limparTemplateRenderizado(
      interpolarMensagem(String(template), {
        origem: dados.origem,
        destino: dados.destino,
        operacao: dados.operacao?.trim() || '',
        produto: dados.produto?.trim() || '',
        valor_ofertado: valorFmt,
        linha_produto: dados.produto?.trim() ? `Produto: ${dados.produto.trim()}` : '',
        linha_operacao: dados.operacao?.trim() ? `Operacao: ${dados.operacao.trim()}` : '',
      }),
    );
  }

  const linhas = [
    'Adriano - GMX / CargoX',
    '',
    `Temos carga ${dados.origem} → ${dados.destino}`,
  ];

  if (dados.produto?.trim()) {
    linhas.push(`Produto: ${dados.produto.trim()}`);
  }
  if (dados.operacao?.trim()) {
    linhas.push(`Operação: ${dados.operacao.trim()}`);
  }

  linhas.push(`Valor: ${valorFmt}`, '', 'Tem interesse?');

  return linhas.join('\n');
}
