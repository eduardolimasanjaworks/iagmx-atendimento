/**
 * Testes automáticos executáveis em runtime (diagnóstico).
 */
import { dividirResposta } from '../servicos/mensagem.js';
import {
  extrairBlocosFerramenta,
  mesclarFerramentasPreservadas,
  serializarBlocoFerramenta,
} from '../servicos/ferramentas.js';
import {
  anexarFerramentasProgramaticas,
  extrairLocalizacaoTexto,
  extrairOfertaGmX,
} from '../servicos/ferramentas-contexto.js';
import { montarMemoriaConversaMesmoDia } from '../servicos/memoria-conversa.js';
import { aleatorioEntre } from '../servicos/config-humanizacao.js';
import {
  jidEhGrupoOuLista,
  normalizarTelefone,
  telefoneEhContatoValido,
  telefoneParaJid,
} from '../util/telefone.js';
import { obterContextoHorarioBrasilia } from '../util/horario-brasilia.js';
import {
  classificarEntrada,
  tentarRespostaEntradaConfusa,
} from '../util/entrada-confusa.js';
import {
  extrairRespostaMotorista,
  sanitizarVazamentoPensamento,
} from '../servicos/cadeia-pensamento.js';
import { rotearMensagem } from '../servicos/roteador-intencao.js';
import {
  parseDataLiberacao,
  tentarFluxoDisponibilidade,
} from '../servicos/fluxo-disponibilidade.js';
import { avaliarNegociacao } from '../servicos/motor-negociacao.js';
import { executarTestesDisparosProativos } from './auto-teste-disparos.js';

export interface ResultadoTeste {
  nome: string;
  ok: boolean;
  detalhe?: string;
}

function assert(nome: string, cond: boolean, detalhe?: string): ResultadoTeste {
  return { nome, ok: cond, detalhe: cond ? undefined : detalhe };
}

function ehMensagemRecebida(evento: string | undefined): boolean {
  const e = (evento ?? '').toLowerCase().replace(/\./g, '_');
  return e === 'messages_upsert';
}

export async function executarTestesUnidade(): Promise<ResultadoTeste[]> {
  const r: ResultadoTeste[] = [];
  r.push(...(await executarTestesDisparosProativos()));

  const partes = dividirResposta('Oi parceiro, tudo bem, sou da GMX.');
  r.push(assert('dividirResposta remove pontos', !partes.some((p) => p.endsWith('.'))));
  r.push(assert('dividirResposta divide por vírgula', partes.length >= 2));

  const umaLinha = dividirResposta('Linha1.\n\nLinha2.');
  r.push(assert('dividirResposta achata quebras', umaLinha.length >= 1));

  const blocos = extrairBlocosFerramenta(
    'Ok parceiro {"ferramenta":"registrar_disponibilidade","dados":{"disponivel":true}}',
  );
  r.push(assert('extrairBlocosFerramenta', blocos.length === 1 && blocos[0].ferramenta === 'registrar_disponibilidade'));

  const comMarkdown = extrairBlocosFerramenta(
    'Ok\n```json\n{"ferramenta":"resposta_oferta_carga","dados":{"aceite":true}}\n```',
  );
  r.push(assert('extrairBlocosFerramenta markdown', comMarkdown.length === 1));

  const mesclado = mesclarFerramentasPreservadas(
    ['texto {"ferramenta":"registrar_disponibilidade","dados":{"disponivel":true}}'],
    'só texto visível',
  );
  r.push(assert('mesclarFerramentasPreservadas', mesclado.includes('registrar_disponibilidade')));

  r.push(assert('extrairLocalizacaoTexto', extrairLocalizacaoTexto('to em Campinas SP') === 'Campinas SP'));

  const memoriaMesmoDia = montarMemoriaConversaMesmoDia([
    { papel: 'assistant', conteudo: 'Bom dia parceiro, me confirma sua situacao', timestamp: Date.now() - 60000 },
    { papel: 'user', conteudo: 'to livre', timestamp: Date.now() - 50000 },
    { papel: 'assistant', conteudo: 'manda a localizacao', timestamp: Date.now() - 40000 },
    { papel: 'user', conteudo: 'Campinas SP', timestamp: Date.now() - 30000 },
    { papel: 'assistant', conteudo: 'ok', timestamp: Date.now() - 25000 },
    { papel: 'user', conteudo: 'preciso atualizar a cnh depois', timestamp: Date.now() - 20000 },
    { papel: 'assistant', conteudo: 'beleza', timestamp: Date.now() - 15000 },
    { papel: 'user', conteudo: 'ta certo', timestamp: Date.now() - 10000 },
    { papel: 'assistant', conteudo: 'fechou', timestamp: Date.now() - 9000 },
    { papel: 'user', conteudo: 'show', timestamp: Date.now() - 8000 },
    { papel: 'assistant', conteudo: 'mais algo', timestamp: Date.now() - 7000 },
  ]);
  r.push(assert('memoria conversa mesmo dia', memoriaMesmoDia.includes('Campinas SP') && memoriaMesmoDia.includes('CNH')));

  const oferta = extrairOfertaGmX([
    {
      role: 'assistant',
      content: 'retirada Guarulhos SP, entrega Curitiba PR, valor R$ 4.500,00',
    },
  ]);
  r.push(assert('extrairOfertaGmX', oferta?.valor === 4500 && oferta.origem.includes('Guarulhos')));
  r.push(assert('extrairLocalizacaoTexto lowercase uf', extrairLocalizacaoTexto('jacarei sp') === 'jacarei SP'));

  const prog = await anexarFerramentasProgramaticas(
    'beleza parceiro',
    ['registrar_disponibilidade'],
    {
      telefone: '5511999887766',
      mensagem: 'Campinas SP',
      historico: [
        {
          role: 'assistant',
          content:
            'Bom dia parceiro, estou atualizando nossa base de parceiros aqui e preciso confirmar se voce esta vazio agora ou se ainda esta carregado',
        },
        { role: 'user', content: 'to vazio' },
      ],
    },
    [],
  );
  r.push(assert('anexarFerramentasProgramaticas', prog.includes('registrar_disponibilidade')));

  const disponibilidadeEspontanea = await rotearMensagem({
    telefone: '5511999887766',
    mensagem: 'disponibilidade',
    historico: [],
  });
  r.push(
    assert(
      'motorista nao inicia fluxo de disponibilidade',
      !(disponibilidadeEspontanea.tipo === 'programatico' && disponibilidadeEspontanea.intencao === 'disponibilidade'),
      'entrada espontanea do motorista nao deveria abrir o cenario 7',
    ),
  );

  const disponibilidadeProativa = await rotearMensagem({
    telefone: '5511999887766',
    mensagem: 'estou livre',
    historico: [
      {
        role: 'assistant',
        content:
          'Bom dia parceiro, estou atualizando nossa base de parceiros aqui e preciso confirmar se voce esta vazio agora ou se ainda esta carregado',
      },
    ],
  });
  r.push(
    assert(
      'disponibilidade proativa pede local depois de livre',
      disponibilidadeProativa.tipo === 'programatico' &&
        disponibilidadeProativa.intencao === 'disponibilidade' &&
        disponibilidadeProativa.passo === 'pede_local',
      JSON.stringify(disponibilidadeProativa),
    ),
  );

  const disponibilidadeStatusReal = await rotearMensagem({
    telefone: '5511999887766',
    mensagem: 'nao estou disponivel, estou em jacarei sp',
    historico: [
      {
        role: 'assistant',
        content:
          'Oi, aqui e da GMX, verificacao de status, me confirma por favor como voce esta agora, se esta disponivel e onde esta',
      },
    ],
  });
  r.push(
    assert(
      'disponibilidade prompt real pede data para indisponivel com local',
      disponibilidadeStatusReal.tipo === 'programatico' &&
        disponibilidadeStatusReal.intencao === 'disponibilidade' &&
        disponibilidadeStatusReal.passo === 'pede_data_indisponivel',
      JSON.stringify(disponibilidadeStatusReal),
    ),
  );

  const indisponivelPerguntaLocalDisponibilidade = await tentarFluxoDisponibilidade({
    telefone: '5511999887766',
    mensagem: 'vou ficar disponivel dia 26',
    historico: [
      { role: 'assistant', content: 'E em que data você estará liberado para carregar?' },
      { role: 'user', content: 'nao estou disponivel, estou em jacarei sp' },
    ],
  });
  r.push(
    assert(
      'disponibilidade indisponivel pede local futuro depois da data',
      indisponivelPerguntaLocalDisponibilidade?.passo === 'pede_local_disponibilidade_indisponivel',
      JSON.stringify(indisponivelPerguntaLocalDisponibilidade),
    ),
  );

  const indisponivelConcluido = await tentarFluxoDisponibilidade({
    telefone: '5511999887766',
    mensagem: 'sao jose dos campos sp',
    historico: [
      {
        role: 'assistant',
        content:
          'Oi, aqui e da GMX, verificacao de status, me confirma por favor como voce esta agora, se esta disponivel e onde esta',
      },
      { role: 'user', content: 'nao estou disponivel, estou em jacarei sp' },
      { role: 'assistant', content: 'E em que data você estará liberado para carregar?' },
      { role: 'user', content: 'vou ficar disponivel dia 26' },
      {
        role: 'assistant',
        content: 'E quando liberar, em qual cidade e estado você vai estar disponível para carregar?',
      },
    ],
  });
  r.push(
    assert(
      'disponibilidade indisponivel conclui com status e data',
      indisponivelConcluido?.passo === 'indisponivel_concluido' &&
        indisponivelConcluido.textoComFerramentas.includes('"status":"indisponivel"') &&
        indisponivelConcluido.textoComFerramentas.includes('"data_previsao_disponibilidade":"2026-06-26 08:00:00"'),
      JSON.stringify(indisponivelConcluido),
    ),
  );

  const carregadoLocalAtual = await rotearMensagem({
    telefone: '5511999887766',
    mensagem: 'to carregado',
    historico: [
      {
        role: 'assistant',
        content:
          'Bom dia parceiro, estou atualizando nossa base de parceiros aqui e preciso confirmar se voce esta vazio agora ou se ainda esta carregado',
      },
    ],
  });
  r.push(
    assert(
      'disponibilidade carregado pede local atual',
      carregadoLocalAtual.tipo === 'programatico' &&
        carregadoLocalAtual.intencao === 'disponibilidade' &&
        carregadoLocalAtual.passo === 'pede_local_atual',
      JSON.stringify(carregadoLocalAtual),
    ),
  );

  const carregadoPerguntaData = await tentarFluxoDisponibilidade({
    telefone: '5511999887766',
    mensagem: 'Betim MG',
    historico: [{ role: 'assistant', content: 'Entendido parceiro, me fala sua localização atual agora com cidade e estado' }],
  });
  r.push(
    assert(
      'disponibilidade carregado pede data depois da localizacao atual',
      carregadoPerguntaData?.passo === 'pede_data',
      JSON.stringify(carregadoPerguntaData),
    ),
  );

  const carregadoPerguntaLocalDisponibilidade = await tentarFluxoDisponibilidade({
    telefone: '5511999887766',
    mensagem: 'amanha',
    historico: [{ role: 'assistant', content: 'E em que data você estará liberado para carregar?' }],
  });
  r.push(
    assert(
      'disponibilidade carregado pede local de liberacao depois da data',
      carregadoPerguntaLocalDisponibilidade?.passo === 'pede_local_disponibilidade',
      JSON.stringify(carregadoPerguntaLocalDisponibilidade),
    ),
  );

  const carregadoDestinoEstadoSemCidade = await tentarFluxoDisponibilidade({
    telefone: '5511999887766',
    mensagem: 'vou estar disponivel la em alagoas',
    historico: [
      {
        role: 'assistant',
        content: 'E qual é a cidade e estado do destino da viagem atual que você está levando agora?',
      },
    ],
  });
  r.push(
    assert(
      'disponibilidade carregado repete cidade quando motorista fala so o estado',
      carregadoDestinoEstadoSemCidade?.passo === 'destino_atual_estado_sem_cidade' &&
        carregadoDestinoEstadoSemCidade.visivel.includes('cidade em Alagoas'),
      JSON.stringify(carregadoDestinoEstadoSemCidade),
    ),
  );

  const carregadoDisponibilidadeEstadoSemCidade = await tentarFluxoDisponibilidade({
    telefone: '5511999887766',
    mensagem: 'vou estar disponivel la em alagoas',
    historico: [
      {
        role: 'assistant',
        content: 'E quando liberar, em qual cidade e estado você vai estar disponível para carregar?',
      },
      { role: 'user', content: 'to em betim mg' },
      { role: 'assistant', content: 'E em que data você estará liberado para carregar?' },
      { role: 'user', content: 'amanha' },
    ],
  });
  r.push(
    assert(
      'disponibilidade pede cidade especifica quando motorista informa so o estado de liberacao',
      carregadoDisponibilidadeEstadoSemCidade?.passo === 'local_disponibilidade_estado_sem_cidade' &&
        carregadoDisponibilidadeEstadoSemCidade.visivel.includes('cidade em Alagoas'),
      JSON.stringify(carregadoDisponibilidadeEstadoSemCidade),
    ),
  );

  const perguntaAumento = avaliarNegociacao({
    mensagem: 'o quanto voce pode aumentar pra mim?',
    faixa: {
      origem: 'Ball - Cabo De Santo Agostinho',
      destino: 'F. Belém',
      valorOfertado: 11200,
      valorMinimo: 11200,
      valorMaximo: 11800,
      fonte: 'config_rotas',
    },
    estado: {
      rodadas: 0,
      faixa: {
        origem: 'Ball - Cabo De Santo Agostinho',
        destino: 'F. Belém',
        valorOfertado: 11200,
        valorMinimo: 11200,
        valorMaximo: 11800,
        fonte: 'config_rotas',
      },
    },
  });
  r.push(
    assert(
      'negociacao responde teto quando motorista pergunta quanto pode aumentar',
      perguntaAumento.tipo === 'reprompt' && perguntaAumento.mensagem.includes('R$ 11.800'),
      JSON.stringify(perguntaAumento),
    ),
  );

  r.push(assert('serializarBlocoFerramenta', serializarBlocoFerramenta('teste', { a: 1 }).includes('teste')));

  r.push(assert('ehMensagemRecebida v2', ehMensagemRecebida('messages.upsert')));
  r.push(assert('ehMensagemRecebida v1', ehMensagemRecebida('MESSAGES_UPSERT')));
  r.push(assert('ignora connection', !ehMensagemRecebida('connection.update')));

  r.push(assert('normalizarTelefone', normalizarTelefone('+55 (12) 99791-8525') === '5512997918525'));
  r.push(assert('telefoneParaJid', telefoneParaJid('5512997918525') === '5512997918525@s.whatsapp.net'));
  r.push(assert('telefoneEhContatoValido contato', telefoneEhContatoValido('5512997918525')));
  r.push(assert('telefoneEhContatoValido grupo invalido', !telefoneEhContatoValido('1203630253867301234')));
  r.push(assert('jidEhGrupoOuLista grupo', jidEhGrupoOuLista('120363025386730123@g.us')));
  r.push(
    assert(
      'parseDataLiberacao dia solto',
      parseDataLiberacao('vou ficar disponivel dia 26', new Date('2026-06-23T12:00:00-03:00')) ===
        '2026-06-26 08:00:00',
    ),
  );

  const a = aleatorioEntre(100, 100);
  const b = aleatorioEntre(50, 200);
  r.push(assert('aleatorioEntre fixo', a === 100));
  r.push(assert('aleatorioEntre range', b >= 50 && b <= 200));

  const horario = obterContextoHorarioBrasilia();
  r.push(assert('horario Brasilia', horario.includes('Brasília') && horario.includes('America/Sao_Paulo')));

  const spam = classificarEntrada('hshshsh asdfgh');
  r.push(assert('entrada nonsense spam', spam.qualidade === 'nonsense'));

  const ilegivel = classificarEntrada('gostaria de saber sobr hshshsh');
  r.push(assert('entrada ilegivel', ilegivel.qualidade === 'ilegivel'));

  const clara = classificarEntrada('mudei de carro');
  r.push(assert('entrada operacional clara', clara.qualidade === 'clara'));

  const confusaProg = tentarRespostaEntradaConfusa('hshshsh asdfgh', {
    historico: [{ role: 'assistant', content: 'Fala parceiro, sou da GMX, me conta no que você precisa' }],
  });
  r.push(assert('resposta programatica confusa', Boolean(confusaProg)));

  const jsonPensamento = extrairRespostaMotorista(
    '{"raciocinio":{"o_que_motorista_quis":"teste"},"resposta_motorista":"Beleza parceiro, manda o CRLV"}',
    'teste',
  );
  r.push(
    assert(
      'extrai só resposta_motorista',
      jsonPensamento.resposta.includes('CRLV') && !jsonPensamento.resposta.includes('raciocinio'),
    ),
  );

  const vazamento = sanitizarVazamentoPensamento(
    'PASSO 2 — rascunho\nCENÁRIO 7 ativo\nBeleza parceiro, manda a localização',
  );
  r.push(assert('sanitiza vazamento pensamento', vazamento === 'Beleza parceiro, manda a localização'));

  return r;
}
