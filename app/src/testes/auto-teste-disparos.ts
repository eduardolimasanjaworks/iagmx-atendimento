/**
 * Testes determinísticos dos textos de disparo proativo.
 * Garante que contato por ranking e oferta automática saem de templates editáveis.
 * Evita regressão para texto hardcoded no fluxo operacional.
 */
import { montarMensagemContatoProativo } from '../servicos/contato-proativo.js';
import { montarMensagemOferta } from '../servicos/oferta-disparo.js';
import type { ResultadoTeste } from './auto-teste.js';

function assert(nome: string, cond: boolean, detalhe?: string): ResultadoTeste {
  return { nome, ok: cond, detalhe: cond ? undefined : detalhe };
}

export async function executarTestesDisparosProativos(): Promise<ResultadoTeste[]> {
  const r: ResultadoTeste[] = [];

  const contatoComLocal = montarMensagemContatoProativo(
    {
      localizacao_atual: 'Jacarei SP',
      nome: 'Victor',
      cidade: 'Jacarei',
      estado: 'SP',
      operacao: 'granel',
    },
    {
      templateComReferencia:
        'Oi {{nome}}, me confirma sua localizacao atual. No ultimo registro voce estava em {{localizacao_atual}}.',
      templateSemReferencia: 'fallback sem local',
    },
  );
  r.push(assert('contato proativo usa template com referencia', contatoComLocal.includes('Victor') && contatoComLocal.includes('Jacarei SP')));

  const contatoSemLocal = montarMensagemContatoProativo(
    {
      localizacao_atual: null,
      nome: 'Victor',
      cidade: 'Jacarei',
      estado: 'SP',
      operacao: 'granel',
    },
    {
      templateComReferencia: 'nao deveria usar',
      templateSemReferencia: 'Oi {{nome}}, me manda cidade e estado de onde voce esta agora.',
    },
  );
  r.push(assert('contato proativo usa template sem referencia', contatoSemLocal === 'Oi Victor, me manda cidade e estado de onde voce esta agora.'));

  const oferta = montarMensagemOferta(
    {
      origem: 'Guarulhos SP',
      destino: 'Curitiba PR',
      operacao: 'carreta seca',
      produto: 'paletizado',
      valorOfertado: 4500,
    },
    'Oferta {{origem}} -> {{destino}}\n{{linha_produto}}\n{{linha_operacao}}\nValor {{valor_ofertado}}',
  );
  r.push(assert('oferta proativa usa template configuravel', oferta.includes('Guarulhos SP -> Curitiba PR') && oferta.includes('Produto: paletizado') && oferta.includes('Operacao: carreta seca') && oferta.includes('R$ 4.500')));

  const ofertaSemLinhaOpcional = montarMensagemOferta(
    {
      origem: 'Betim MG',
      destino: 'Goiania GO',
      valorOfertado: 3200,
    },
    'Carga {{origem}} -> {{destino}}\n{{linha_produto}}\nValor {{valor_ofertado}}',
  );
  r.push(assert('oferta proativa limpa linhas vazias', !ofertaSemLinhaOpcional.includes('\n\n\n')));

  return r;
}
