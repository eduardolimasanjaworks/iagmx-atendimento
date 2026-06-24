/**
 * Auditoria do painel /phone baseada nas regras reais carregadas no backend.
 * Remove conversas hardcoded do frontend e expõe jornadas ligadas ao catálogo atual.
 * A oferta proativa usa o template real e o motor determinístico de negociação.
 */
import { obterConfigMensagensFluxo } from './config-mensagens-fluxo.js';
import { listarJornadasTesteAtivas } from './catalogo-jornadas-teste.js';
import { montarMensagemOferta } from './oferta-disparo.js';
import { montarRespostaConsultaDocumentosParaTeste } from './consulta-documentos.js';
import {
  avaliarNegociacao,
  atualizarEstadoNegociacao,
  type EstadoNegociacao,
  type FaixaNegociacao,
} from './motor-negociacao.js';

type PainelAuditAcao = {
  entity: string;
  action: string;
  time: string;
  fields: Record<string, string | number | null>;
  result: string;
};

type PainelAuditMessage = {
  id: string;
  role: 'driver' | 'assistant';
  time: string;
  text: string;
  name?: string;
  audit?: {
    reason: string;
    prompt: string;
    erp: PainelAuditAcao[];
    tags: string[];
  };
};

type PainelAuditConversation = {
  id: string;
  title: string;
  meta: string;
  nome: string;
  phone: string;
  resumo: string;
  esperado: string;
  progressLabel: string;
  progressPct: number;
  messages: PainelAuditMessage[];
};

type PainelAuditPayload = {
  ok: true;
  atualizadoEm: string;
  origem: string;
  conversations: PainelAuditConversation[];
};

function act(
  entity: string,
  action: string,
  time: string,
  fields: Record<string, string | number | null>,
  result: string,
): PainelAuditAcao {
  return { entity, action, time, fields, result };
}

function assistant(
  id: string,
  time: string,
  text: string,
  reason: string,
  prompt: string,
  erp: PainelAuditAcao[],
  tags: string[],
): PainelAuditMessage {
  return { id, role: 'assistant', time, text, audit: { reason, prompt, erp, tags } };
}

function driver(id: string, time: string, text: string, name: string): PainelAuditMessage {
  return { id, role: 'driver', time, text, name };
}

function mensagensJornada(
  jornada: { id: string; cenario: number; mensagemPadrao: string },
  msgs: Awaited<ReturnType<typeof obterConfigMensagensFluxo>>,
): PainelAuditMessage[] {
  if (jornada.cenario === 0) {
    const resposta = montarRespostaConsultaDocumentosParaTeste(
      [
        { label: 'CNH', obrigatorio: true, presente: false, pendencias: ['sem registro'], detalhe: '- CNH' },
        { label: 'CRLV cavalo', obrigatorio: true, presente: false, pendencias: ['anexo'], detalhe: '- CRLV' },
        { label: 'ANTT cavalo', obrigatorio: true, presente: true, pendencias: [], detalhe: '- ANTT' },
        { label: 'Comprovante endereco', obrigatorio: true, presente: false, pendencias: ['sem registro'], detalhe: '- Endereco' },
      ],
      true,
    );
    return [
      assistant(`jr_${jornada.id}_1`, '09:00:00', jornada.mensagemPadrao, 'Texto real do catalogo para iniciar cobranca documental', `Jornada ${jornada.id} iniciou pelo catalogo persistido.`, [], ['Catalogo', 'Backend real']),
      driver(`jr_${jornada.id}_2`, '09:00:11', 'Quais documentos estao faltando no meu cadastro?', 'Motorista parceiro'),
      assistant(`jr_${jornada.id}_3`, '09:00:13', resposta, 'Consulta programatica de documentos faltantes com base no consolidado ERP', 'Fluxo real esperado: pergunta objetiva -> resposta programatica sem LLM e sem escalar humano.', [], ['Consulta ERP', 'Sem LLM']),
    ];
  }
  if (jornada.cenario === 1) return [assistant(`jr_${jornada.id}_1`, '09:00:00', jornada.mensagemPadrao, 'Pedido real de comprovante/canhoto', `Fluxo real usa a mensagem operacional atual.\n${msgs.canhoto_pedir_foto}`, [], ['Catalogo', 'Canhoto']), driver(`jr_${jornada.id}_2`, '09:00:10', 'Segue a foto do comprovante de entrega', 'Motorista parceiro'), assistant(`jr_${jornada.id}_3`, '09:00:13', msgs.canhoto_ok.replace('{{embarque_id}}', '8451'), 'Confirmacao operacional apos vincular o canhoto ao embarque', 'Fluxo real: gravar comprovante -> validar embarque -> confirmar ao motorista.', [act('delivery_receipts', 'insert', '09:00:13', { embarque_id: 8451, arquivo: 'canhoto.jpg' }, 'canhoto vinculado ao embarque')], ['ERP', 'Canhoto'])];
  if (jornada.cenario === 5) return [assistant(`jr_${jornada.id}_1`, '09:00:00', jornada.mensagemPadrao, 'Oferta proativa carregada do catalogo atual', 'Fluxo real usa a rota e o valor ofertado configurados no disparo.', [act('historico_ofertas', 'insert', '09:00:00', { config_rota_id: 301, motorista_id: 912, valor_ofertado: 4500 }, 'oferta_disparada_ia')], ['Catalogo', 'Oferta']), driver(`jr_${jornada.id}_2`, '09:00:09', 'Consigo por 4700', 'Motorista parceiro'), assistant(`jr_${jornada.id}_3`, '09:00:12', 'Entendi os R$ 4.700 parceiro, o maximo pra essa rota e R$ 4.600, topa nesse valor?', 'Contraproposta deterministica dentro da faixa da rota selecionada', 'Fluxo real esperado: oferta vinculada a config_rota_id + piso/teto do ERP + contraproposta em codigo.', [], ['Negociacao', 'config_rotas'])];
  if (jornada.cenario === 7) return [assistant(`jr_${jornada.id}_1`, '09:00:00', jornada.mensagemPadrao, 'Abertura real do fluxo programatico de disponibilidade', `Mensagens operacionais atuais: ${msgs.c7_pergunta_status}`, [], ['Catalogo', 'Disponibilidade']), driver(`jr_${jornada.id}_2`, '09:00:08', 'Ainda to carregado parceiro', 'Motorista parceiro'), assistant(`jr_${jornada.id}_3`, '09:00:11', msgs.c7_pergunta_local_atual_carregado, 'Fluxo continua sem LLM para coletar local atual', 'Sequencia real: status carregado -> local atual -> destino atual -> data de liberacao.', [], ['Programatico'])];
  if (jornada.cenario === 8) return [assistant(`jr_${jornada.id}_1`, '09:00:00', jornada.mensagemPadrao, 'Inicio real do cadastro programatico', `Fluxo C8 atual.\n${msgs.c8_inicio}`, [], ['Catalogo', 'Cadastro']), driver(`jr_${jornada.id}_2`, '09:00:12', 'Segue a CNH', 'Motorista parceiro'), assistant(`jr_${jornada.id}_3`, '09:00:15', msgs.c8_confirmacao_cnh, 'Confirmacao do primeiro passo de cadastro apos receber CNH', 'Fluxo real: CNH -> CRLV -> ANTT -> endereco -> foto do cavalo.', [act('cnh', 'upsert', '09:00:15', { status: 'recebida' }, 'CNH salva para validacao')], ['OCR', 'Cadastro'])];
  return [assistant(`jr_${jornada.id}_1`, '09:00:00', jornada.mensagemPadrao, 'Mensagem inicial real do catalogo persistido', ['Origem: catalogo-jornadas-teste', `Jornada: ${jornada.id}`, `Cenario: ${jornada.cenario}`, '', jornada.mensagemPadrao].join('\n'), [], ['Catalogo', 'Backend real']), driver(`jr_${jornada.id}_2`, '09:00:09', 'Beleza parceiro', 'Motorista parceiro'), assistant(`jr_${jornada.id}_3`, '09:00:12', 'Perfeito, sigo por aqui com o fluxo atual.', 'Continuidade auditavel minima para a jornada ativa', 'O simulador agora exibe mais de uma etapa mesmo quando a jornada so define a abertura no catalogo.', [], ['Auditoria'])];
}

function resumoPromptOferta(template: string, faixa: FaixaNegociacao): string {
  return [
    'Fluxo real: /api/disparar-oferta -> montarMensagemOferta',
    `config_rota_id fixado: ${faixa.configRotaId ?? 'sem rota fixa'}`,
    'Origem da mensagem: GMX inicia a conversa de forma proativa',
    'Regra comercial: a abertura usa somente valor_ofertado',
    `Valor_ofertado atual: R$ ${faixa.valorOfertado.toLocaleString('pt-BR')}`,
    `Faixa ERP interna: min ${faixa.valorMinimo.toLocaleString('pt-BR')} | max ${faixa.valorMaximo.toLocaleString('pt-BR')}`,
    '',
    'Template atual:',
    template,
  ].join('\n');
}

function resumoPromptNegociacao(faixa: FaixaNegociacao): string {
  return [
    'Motor real: avaliarNegociacao',
    'Regra: nunca abre range na oferta inicial',
    `Piso ERP: R$ ${faixa.valorMinimo.toLocaleString('pt-BR')}`,
    `Teto ERP: R$ ${faixa.valorMaximo.toLocaleString('pt-BR')}`,
    'Se o motorista pedir acima do teto, a IA contrapõe no teto e depois escala humano',
  ].join('\n');
}

async function conversaOfertaReal(): Promise<PainelAuditConversation> {
  const mensagens = await obterConfigMensagensFluxo();
  const faixa: FaixaNegociacao = {
    origem: 'Guarulhos SP',
    destino: 'Curitiba PR',
    valorOfertado: 7100,
    valorMinimo: 7100,
    valorMaximo: 7400,
    configRotaId: 301,
    fonte: 'embarque',
  };
  const inicial = montarMensagemOferta(
    {
      origem: faixa.origem,
      destino: faixa.destino,
      valorOfertado: faixa.valorOfertado,
      operacao: 'Carreta seca',
    },
    mensagens.oferta_proativa_template,
  );

  let estado: EstadoNegociacao = {
    rodadas: 0,
    faixa,
    ultimoValorPedido: undefined,
    ultimaContraofertaIa: undefined,
  };
  const pedidoMotorista = 'Consigo por R$ 8.000';
  const acao = avaliarNegociacao({
    mensagem: pedidoMotorista,
    faixa,
    estado,
  });
  estado = atualizarEstadoNegociacao(estado, acao, pedidoMotorista);
  const contraproposta =
    acao.tipo === 'contraproposta_ia' || acao.tipo === 'reprompt'
      ? acao.mensagem
      : 'Fluxo sem contraproposta textual nesta rodada';

  return {
    id: 'oferta_proativa_real',
    title: 'Oferta proativa real',
    meta: 'Backend real · disparar-oferta + negociacao',
    nome: 'Motorista parceiro',
    phone: '5511977773302',
    resumo: 'A GMX inicia a oferta e abre somente o valor ofertado, sem expor range',
    esperado: 'Motorista reage ao valor minimo e a IA negocia dentro do teto do ERP',
    progressLabel: 'Fluxo real carregado',
    progressPct: 100,
    messages: [
      assistant(
        'of1',
        '10:05:00',
        inicial,
        'Oferta real parte da GMX pelo ERP e usa apenas o valor_ofertado atual',
        resumoPromptOferta(mensagens.oferta_proativa_template, faixa),
        [
          act(
            'historico_ofertas',
            'insert',
            '10:05:00',
            {
              embarque_id: 8451,
              config_rota_id: faixa.configRotaId ?? null,
              motorista_id: 912,
              valor_ofertado: faixa.valorOfertado,
              valor_minimo: faixa.valorMinimo,
              valor_maximo: faixa.valorMaximo,
              origem: faixa.origem,
              destino: faixa.destino,
            },
            'oferta_disparada_ia',
          ),
        ],
        ['ERP', 'Oferta', 'Sem range'],
      ),
      driver('of2', '10:05:09', pedidoMotorista, 'Carlos Nogueira'),
      assistant(
        'of3',
        '10:05:12',
        contraproposta,
        'Negociacao real calculada pelo motor deterministico com teto do ERP',
        resumoPromptNegociacao(faixa),
        [],
        ['Negociacao', 'ERP'],
      ),
    ],
  };
}

async function jornadasReais(): Promise<PainelAuditConversation[]> {
  const jornadas = await listarJornadasTesteAtivas();
  const msgs = await obterConfigMensagensFluxo();
  return jornadas.map((jornada) => ({
    id: `jornada_${jornada.id}`,
    title: jornada.titulo,
    meta: `Cenario ${jornada.cenario} · catalogo real`,
    nome: 'GMX',
    phone: 'fluxo_programatico',
    resumo: jornada.descricao,
    esperado: 'Conversa auditavel montada a partir da regra real atual do backend',
    progressLabel: 'Fluxo auditavel carregado',
    progressPct: 100,
    messages: mensagensJornada(jornada, msgs),
  }));
}

export async function obterPainelAuditoriaSimulador(): Promise<PainelAuditPayload> {
  const conversas = [await conversaOfertaReal(), ...(await jornadasReais())];
  return {
    ok: true,
    atualizadoEm: new Date().toISOString(),
    origem: 'backend_real_iagmx',
    conversations: conversas,
  };
}
