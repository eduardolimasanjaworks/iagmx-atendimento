#!/usr/bin/env node
/**
 * Validação sequencial — 1 motorista, inferência REAL refinada, histórico gravado.
 *
 * Uso: node scripts/teste-fluxos-motorista-unico.mjs [--pausa=25] [--paralelo] [--paralelo-max=10]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = existsSync('/app/dist/servicos')
  ? '/app/dist/servicos'
  : resolve(ROOT, 'app/dist/servicos');
const OUT_DIR = existsSync('/app/scripts')
  ? '/app/scripts/relatorios-simulacao'
  : resolve(ROOT, 'scripts/relatorios-simulacao');

for (const p of [resolve(ROOT, '.env'), '/app/.env']) {
  try {
    for (const linha of readFileSync(p, 'utf-8').split('\n')) {
      const t = linha.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0 && !process.env[t.slice(0, i).trim()]) {
        process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      }
    }
    break;
  } catch { /* */ }
}

const ARGS = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

const PAUSA_MS = parseInt(ARGS.pausa ?? '25', 10) * 1000;
const PARALELO = ARGS.paralelo === 'true' || ARGS.paralelo === true;
const PARALELO_MAX = parseInt(ARGS['paralelo-max'] ?? '10', 10);

const TELEFONE = '5511999887766';
const NOME = 'Validação Fluxos';
const GMX_DISP =
  '[GMX]: Estamos atualizando nossa base de parceiros para novas ofertas de frete e vi que seu cadastro precisa de uma confirmação rápida';
const GMX_OFERTA =
  '[GMX]: Temos uma carga — retirada Guarulhos SP, entrega Curitiba PR, valor R$ 4.500,00 — você está por onde e tem interesse?';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizar(texto) {
  return texto
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ', ')
    .replace(/\.\s+/g, ', ')
    .replace(/\.\s*$/g, '')
    .replace(/,{2,}/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairFerramentas(texto) {
  const blocos = [];
  let i = 0;
  while (i < texto.length) {
    const start = texto.indexOf('{"ferramenta"', i);
    if (start === -1) break;
    let depth = 0;
    let end = -1;
    for (let j = start; j < texto.length; j++) {
      if (texto[j] === '{') depth++;
      if (texto[j] === '}') {
        depth--;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end === -1) break;
    try {
      blocos.push(JSON.parse(texto.slice(start, end)));
    } catch { /* */ }
    i = end;
  }
  return blocos;
}

function textoVisivel(texto) {
  let t = texto;
  for (const b of extrairFerramentas(texto)) t = t.replace(JSON.stringify(b), '');
  return normalizar(t);
}

function validarResposta(visivel, ctx) {
  const problemas = [];
  if (/\.\s*$/.test(visivel)) problemas.push('ponto_final');
  if (/Como posso ajudar/i.test(visivel)) problemas.push('robotico');
  if (/\braciocinio\b|auto_critica|auto_checklist|o_que_motorista_quis/i.test(visivel)) {
    problemas.push('vazou_pensamento');
  }
  if (/CENÁRIO|PASSO \d/i.test(visivel)) problemas.push('vazou_instrucao');
  if (ctx.deveConter?.length) {
    const ok = ctx.deveConter.some((s) => visivel.toLowerCase().includes(s.toLowerCase()));
    if (!ok) problemas.push(`faltou:${ctx.deveConter.join('|')}`);
  }
  if (ctx.naoDeveConter?.length) {
    for (const s of ctx.naoDeveConter) {
      if (visivel.toLowerCase().includes(s.toLowerCase())) problemas.push(`sobra:${s}`);
    }
  }
  if (ctx.esperaFerramenta) {
    const ferr = extrairFerramentas(ctx.bruto ?? '').map((b) => b.ferramenta);
    if (!ferr.includes(ctx.esperaFerramenta)) problemas.push(`faltou_ferramenta_${ctx.esperaFerramenta}`);
  }
  return problemas;
}

/** Todos os fluxos críticos — turnos scriptados, inferência real na GMX */
const FLUXOS = [
  {
    id: 'c6-saudacao',
    titulo: 'Cenário 6 — Saudação / menu',
    turnos: [
      { motorista: 'oi' },
      { validar: { deveConter: ['cadastro', 'disponibilidade'] } },
    ],
  },
  {
    id: 'c6-menu-repetido',
    titulo: 'Cenário 6 — Segunda saudação vazia',
    turnos: [
      { motorista: 'oi' },
      { validar: { deveConter: ['cadastro'] } },
      { motorista: 'olá' },
      { validar: { deveConter: ['cadastro', 'disponibilidade'], naoDeveConter: ['Não entendi', 'Como posso ajudar', 'sou da GMX'] } },
    ],
  },
  {
    id: 'c7-disponibilidade-vazio',
    titulo: 'Cenário 7 — Disponibilidade proativa (vazio)',
    reset: true,
    turnos: [
      { gmx: GMX_DISP },
      { motorista: 'pode sim' },
      { validar: { deveConter: ['vazio', 'carregado'] } },
      { motorista: 'to vazio' },
      { validar: { deveConter: ['localização', 'cidade'] } },
      { motorista: 'Campinas SP' },
      { validar: { esperaFerramenta: 'registrar_disponibilidade', deveConter: ['boa viagem', 'show'] } },
      { motorista: 'valeu' },
      { silencio: true, motivo: 'encerramento pós-despedida' },
    ],
  },
  {
    id: 'c7-disponibilidade-carregado',
    titulo: 'Cenário 7 — Disponibilidade proativa (carregado)',
    reset: true,
    turnos: [
      { gmx: GMX_DISP },
      { motorista: 'sim' },
      { motorista: 'to carregado' },
      { validar: { deveConter: ['cidade', 'estado'] } },
      { motorista: 'indo pro Rio de Janeiro RJ' },
      { validar: { deveConter: ['data', 'liber'] } },
      { motorista: 'libero sexta-feira' },
      { validar: { deveConter: ['cidade', 'estado', 'disponível'] } },
      { motorista: 'Betim MG' },
      { validar: { esperaFerramenta: 'registrar_disponibilidade', deveConter: ['dados atualizados', 'boa viagem', 'show'] } },
    ],
  },
  {
    id: 'c7-menu-disponibilidade',
    titulo: 'Cenário 7 — Disponibilidade via menu',
    reset: true,
    turnos: [
      { motorista: 'disponibilidade' },
      { validar: { deveConter: ['vazio', 'carregado'] } },
      { motorista: 'vazio' },
      { validar: { deveConter: ['localização', 'cidade'] } },
    ],
  },
  {
    id: 'c5-oferta-aceite',
    titulo: 'Cenário 5 — Oferta proativa (aceite)',
    reset: true,
    turnos: [
      { gmx: GMX_OFERTA },
      { motorista: 'to em Guarulhos SP, topo sim' },
      { validar: { esperaFerramenta: 'resposta_oferta_carga', deveConter: ['boa viagem', 'show', 'confirm', 'aceit', 'anotei', 'perfeito', 'fechou'] } },
    ],
  },
  {
    id: 'c5-oferta-negociacao',
    titulo: 'Cenário 5/9 — Oferta com contraproposta',
    reset: true,
    turnos: [
      { gmx: GMX_OFERTA },
      { motorista: 'to em SP, mas só faço por 5 mil' },
      { validar: { deveConter: ['valor', '5'] } },
      { motorista: 'fechado então no 4800' },
      { validar: { deveConter: ['boa viagem', 'fechado', '4800', 'registr', 'combinado', 'perfeito'] } },
    ],
  },
  {
    id: 'c5-oferta-recusa',
    titulo: 'Cenário 5 — Oferta recusada',
    reset: true,
    turnos: [
      { gmx: GMX_OFERTA },
      { motorista: 'to longe, não rola essa' },
      { validar: { esperaFerramenta: 'resposta_oferta_carga', deveConter: ['próxima', 'boa viagem', 'combinado', 'obrigado', 'sem problema', 'entendi'] } },
    ],
  },
  {
    id: 'c8-cadastro-inicio',
    titulo: 'Cenário 8 — Cadastro (início CNH)',
    reset: true,
    turnos: [
      { motorista: 'quero me cadastrar' },
      { validar: { deveConter: ['cnh', 'foto'] } },
      { motorista: '12345678900' },
      { validar: { deveConter: ['foto', 'cnh'], naoDeveConter: ['grava_ocr'] } },
    ],
  },
  {
    id: 'c6-pagamento',
    titulo: 'Cenário 6 — Pergunta pagamento (fallback)',
    reset: true,
    turnos: [
      { motorista: 'quando paga o frete?' },
      { validar: { deveConter: ['pagamento', 'cadastro'] } },
    ],
  },
  {
    id: 'c6-entrada-confusa',
    titulo: 'Entrada confusa — teclado aleatório após menu',
    reset: true,
    turnos: [
      { motorista: 'oi' },
      { validar: { deveConter: ['cadastro', 'disponibilidade'] } },
      { motorista: 'hshshsh asdfgh' },
      {
        validar: {
          naoDeveConter: ['raciocinio', 'CENÁRIO', 'PASSO', 'Como posso ajudar'],
          deveConter: ['manda', 'de novo', 'perdi', 'fio', 'brincadeira', 'frete', 'explica', 'pegou'],
        },
      },
    ],
  },
  {
    id: 'c6-entrada-vaga',
    titulo: 'Entrada vaga — redireciona ao menu',
    reset: true,
    turnos: [
      { motorista: 'oi' },
      { motorista: 'sei lá mano' },
      { validar: { deveConter: ['cadastro', 'disponibilidade', 'pagamento'] } },
    ],
  },
  {
    id: 'desambiguacao-veiculo',
    titulo: 'Desambiguação — troca de veículo ambígua',
    reset: true,
    turnos: [
      { motorista: 'mudei de carro' },
      {
        validar: {
          deveConter: ['cavalo', 'carreta'],
          naoDeveConter: ['grava_ocr', 'raciocinio', 'CENÁRIO'],
        },
      },
    ],
  },
  {
    id: 'c6-nonsense-longo',
    titulo: 'Entrada nonsense — frase fora de contexto',
    reset: true,
    turnos: [
      { motorista: 'oi' },
      { motorista: 'o abacate de calças cantou no chuveiro' },
      {
        validar: {
          naoDeveConter: ['raciocinio', 'CENÁRIO', 'PASSO', 'auto_critica'],
          deveConter: ['frete', 'brincadeira', 'meada', 'explica', 'cadastro', 'disponibilidade', 'pagamento', 'peguei', 'manda', 'de novo'],
        },
      },
    ],
  },
];

async function carregarModulos() {
  const { montarPromptSistemaInferencia } = await import(`${DIST}/contexto-inferencia.js`);
  const { gerarRespostaRefinada } = await import(`${DIST}/inferencia-refinada.js`);
  const { processarFerramentas } = await import(`${DIST}/ferramentas.js`);
  const { avaliarSeDeveResponder } = await import(`${DIST}/linguagem-motorista-runtime.js`);
  const { statusFilaInferencia } = await import(`${DIST}/fila-inferencia.js`);
  const { tentarFluxoDisponibilidade } = await import(`${DIST}/fluxo-disponibilidade.js`);
  const { tentarRespostaMenuProgramatica } = await import(`${DIST}/respostas-menu.js`);
  const { limparEstadoFluxo } = await import(`${DIST}/estado-fluxo-redis.js`);
  const { rotearMensagem } = await import(`${DIST}/roteador-intencao.js`);
  const { montarPromptCompactoPassadas } = await import(`${DIST}/inferencia-refinada.js`);
  return {
    montarPromptSistemaInferencia,
    gerarRespostaRefinada,
    processarFerramentas,
    avaliarSeDeveResponder,
    statusFilaInferencia,
    tentarFluxoDisponibilidade,
    tentarRespostaMenuProgramatica,
    limparEstadoFluxo,
    rotearMensagem,
    montarPromptCompactoPassadas,
  };
}

function carregarPromptBase() {
  const caminhos = [
    resolve(ROOT, 'prompt inicial para avaliarmos dificuldade'),
    '/app/prompt-inicial.txt',
  ];
  for (const c of caminhos) {
    try {
      return readFileSync(c, 'utf-8');
    } catch { /* */ }
  }
  return '';
}

async function inferirGmx(mod, historico, mensagem, promptBase) {
  const ultimaAssistant = [...historico].reverse().find((h) => h.role === 'assistant')?.content;

  const rota = await mod.rotearMensagem({
    telefone: TELEFONE,
    mensagem,
    historico,
    ultimaAssistant,
  });

  const ctxFerr = {
    remoteJid: `${TELEFONE}@s.whatsapp.net`,
    instance: 'gmx-atendimento',
    itens: [{
      tipo: 'texto',
      conteudo: mensagem,
      instance: 'gmx-atendimento',
      remoteJid: `${TELEFONE}@s.whatsapp.net`,
      pushName: NOME,
      timestamp: Date.now(),
    }],
  };

  if (rota.tipo === 'silencio') {
    return {
      bruto: '',
      visivel: '',
      silencio: true,
      plano: { cenario: `silêncio (${rota.motivo})` },
      passadas: 0,
      revisoes: [],
      duracaoMs: 0,
      ferramentas: [],
      fila: mod.statusFilaInferencia(),
    };
  }

  if (rota.tipo === 'programatico') {
    const aposFerr = rota.executarFerramentas
      ? await mod.processarFerramentas(rota.textoComFerramentas, ctxFerr).catch(() => rota.resposta)
      : rota.resposta;
    return {
      bruto: rota.textoComFerramentas,
      visivel: textoVisivel(aposFerr),
      plano: { cenario: `${rota.intencao} programático (${rota.passo ?? ''})` },
      passadas: 0,
      revisoes: [],
      duracaoMs: 0,
      ferramentas: extrairFerramentas(rota.textoComFerramentas).map((b) => b.ferramenta),
      fila: mod.statusFilaInferencia(),
    };
  }

  const promptCompleto = await mod.montarPromptSistemaInferencia({
    telefone: TELEFONE,
    nomeContato: NOME,
    mensagemUsuario: mensagem,
    historico: historico,
    promptBase,
  });

  const prompt =
    rota.cenario !== undefined
      ? mod.montarPromptCompactoPassadas(promptCompleto, {
          cenario: `CENÁRIO ${rota.cenario}`,
          ferramentas: [],
          observacoes: `roteador:${rota.intencao}`,
        })
      : promptCompleto;

  const hist = historico.map((h) => ({ role: h.role, content: h.content }));
  const inicio = Date.now();
  const { texto, plano, passadas, revisoes, cadeiaPensamento } = await mod.gerarRespostaRefinada(
    prompt,
    [mensagem],
    hist,
    { telefone: TELEFONE },
  );
  const duracaoMs = Date.now() - inicio;

  const aposFerr = texto.includes('{"ferramenta"')
    ? await mod.processarFerramentas(texto, ctxFerr).catch(() => texto)
    : texto;

  return {
    bruto: texto,
    visivel: textoVisivel(aposFerr),
    plano,
    passadas,
    revisoes,
    cadeiaPensamento,
    duracaoMs,
    ferramentas: extrairFerramentas(texto).map((b) => b.ferramenta),
    fila: mod.statusFilaInferencia(),
  };
}

async function executarFluxo(fluxo, mod, promptBase, historicoInicial = []) {
  let historico = [...historicoInicial];
  const blocos = [];
  const resumoFluxo = { ok: 0, falha: 0, silencioOk: 0, turnos: 0 };
  let fluxoOk = true;

  if (fluxo.reset) {
    historico = [];
    await mod.limparEstadoFluxo(TELEFONE);
  }

  blocos.push(`## ${fluxo.titulo}`);
  blocos.push(`ID: \`${fluxo.id}\``);
  blocos.push('');

  let turnoIdx = 0;
  let ultimaRespostaBruta = '';

  for (const turno of fluxo.turnos) {
    turnoIdx++;
    resumoFluxo.turnos++;

    if (turno.gmx) {
      historico.push({ role: 'assistant', content: turno.gmx });
      blocos.push(`### Turno ${turnoIdx} — GMX (proativa)`);
      blocos.push(`> ${turno.gmx}`);
      blocos.push('');
      continue;
    }

    if (turno.motorista) {
      const msg = turno.motorista;
      blocos.push(`### Turno ${turnoIdx} — Motorista`);
      blocos.push(`> ${msg}`);
      blocos.push('');

      const ultimaAssistant = [...historico].reverse().find((h) => h.role === 'assistant')?.content;
      const silencio = await mod.avaliarSeDeveResponder(msg, ultimaAssistant);
      if (silencio.encerrar) {
        blocos.push(`**Silêncio (código)** — ${silencio.motivo}`);
        blocos.push('');
        historico.push({ role: 'user', content: msg });
        continue;
      }

      historico.push({ role: 'user', content: msg });

      console.log(`[${fluxo.id}] turno ${turnoIdx}: motorista → roteando...`);
      const resp = await inferirGmx(mod, historico.slice(0, -1), msg, promptBase);

      if (resp.silencio) {
        blocos.push(`**Silêncio (roteador)** — ${resp.plano.cenario}`);
        blocos.push('');
        continue;
      }

      ultimaRespostaBruta = resp.bruto;
      historico.push({ role: 'assistant', content: resp.visivel });

      blocos.push(`**GMX** (${resp.passadas} passadas, ${(resp.duracaoMs / 1000).toFixed(1)}s)`);
      blocos.push(`- Cenário plano: ${resp.plano.cenario}`);
      if (resp.plano.observacoes) blocos.push(`- Observações: ${resp.plano.observacoes}`);
      blocos.push(`- Ferramentas: ${resp.ferramentas.join(', ') || 'nenhuma'}`);
      if (resp.revisoes?.length) blocos.push(`- Pipeline: ${resp.revisoes.join(' → ')}`);
      if (resp.cadeiaPensamento?.length) {
        blocos.push(`- Cadeia pensamento (interno): ${resp.cadeiaPensamento.map((c) => c.etapa).join(', ')}`);
      }
      blocos.push(`- Fila: ${resp.fila.slotsOcupados}/${resp.fila.maxSlots} slots, ${resp.fila.aguardando} aguardando`);
      blocos.push('');
      blocos.push('```');
      blocos.push(resp.visivel);
      blocos.push('```');
      blocos.push('');

      if (PAUSA_MS > 0) await sleep(PAUSA_MS);
      continue;
    }

    if (turno.silencio) {
      const ultimaMsg = historico.filter((h) => h.role === 'user').pop()?.content ?? '';
      const ultimaAssistant = [...historico].reverse().find((h) => h.role === 'assistant')?.content;
      const silencio = await mod.avaliarSeDeveResponder(ultimaMsg, ultimaAssistant);

      blocos.push(`### Turno ${turnoIdx} — Silêncio esperado`);
      blocos.push(`Motorista disse: "${ultimaMsg}"`);
      blocos.push(`Resultado: encerrar=${silencio.encerrar} (${silencio.motivo ?? 'n/a'})`);
      blocos.push('');

      if (silencio.encerrar) {
        resumoFluxo.silencioOk++;
        blocos.push('✅ **OK** — IA deve permanecer em silêncio');
      } else {
        fluxoOk = false;
        blocos.push('❌ **FALHA** — deveria silenciar mas código não detectou encerramento');
      }
      blocos.push('');
      continue;
    }

    if (turno.validar) {
      const ultimaGmx = [...historico].reverse().find((h) => h.role === 'assistant');
      const visivel = ultimaGmx?.content ?? '';

      const problemas = validarResposta(visivel, {
        ...turno.validar,
        bruto: ultimaRespostaBruta,
      });

      blocos.push(`### Turno ${turnoIdx} — Validação`);
      if (problemas.length === 0) {
        blocos.push('✅ **OK**');
        resumoFluxo.ok++;
      } else {
        blocos.push(`❌ **FALHA**: ${problemas.join(', ')}`);
        fluxoOk = false;
        resumoFluxo.falha++;
      }
      blocos.push('');
    }
  }

  blocos.push(fluxoOk ? `**Fluxo ${fluxo.id}: OK**` : `**Fluxo ${fluxo.id}: COM FALHAS**`);
  blocos.push('');
  blocos.push('---');
  blocos.push('');

  return { fluxoOk, historico, blocos, resumoFluxo };
}

/** Cadeias: fluxos encadeados vs independentes para execução paralela */
function montarCadeias(fluxos) {
  const cadeias = [];
  let buffer = [];
  for (const fluxo of fluxos) {
    if (fluxo.reset && buffer.length > 0) {
      cadeias.push([...buffer]);
      buffer = [fluxo];
    } else if (fluxo.reset) {
      cadeias.push([fluxo]);
    } else {
      buffer.push(fluxo);
    }
  }
  if (buffer.length > 0) cadeias.push(buffer);
  return cadeias;
}

async function poolParalelo(itens, limite, fn) {
  const resultados = new Array(itens.length);
  let idx = 0;
  async function worker() {
    while (idx < itens.length) {
      const i = idx++;
      resultados[i] = await fn(itens[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, () => worker()));
  return resultados;
}

async function main() {
  const modo = PARALELO ? `paralelo (max ${PARALELO_MAX})` : 'sequencial';
  console.log(`=== Validação fluxos — inferência refinada [${modo}] ===\n`);
  const mod = await carregarModulos();
  const promptBase = carregarPromptBase();

  const relatorio = [];
  const resumo = { ok: 0, falha: 0, silencioOk: 0, turnos: 0 };
  let historicoGlobal = [];

  relatorio.push(`# Validação de fluxos — motorista único`);
  relatorio.push(`Data: ${new Date().toISOString()}`);
  relatorio.push(`Telefone teste: ${TELEFONE}`);
  relatorio.push(`Modo: ${modo}`);
  const fluxosRun = ARGS.fluxos
    ? FLUXOS.filter((f) =>
        ARGS.fluxos.split(',').map((s) => s.trim()).includes(f.id),
      )
    : FLUXOS;

  relatorio.push(`Fluxos: ${fluxosRun.map((f) => f.id).join(', ')}`);
  relatorio.push(`Modelo Claude: ${process.env.MODELO_CHAT_CLAUDE ?? 'claude-sonnet-4-20250514'}`);
  relatorio.push(`Pausa entre turnos: ${PAUSA_MS / 1000}s`);
  relatorio.push('');

  if (PARALELO) {
    const cadeias = montarCadeias(fluxosRun);
    console.log(`Cadeias paralelas: ${cadeias.length}\n`);

    const resultados = await poolParalelo(cadeias, PARALELO_MAX, async (cadeia) => {
      let hist = [];
      const saida = [];
      let cadeiaOk = true;
      for (const fluxo of cadeia) {
        const r = await executarFluxo(fluxo, mod, promptBase, hist);
        hist = r.historico;
        saida.push(...r.blocos);
        resumo.ok += r.resumoFluxo.ok;
        resumo.falha += r.resumoFluxo.falha;
        resumo.silencioOk += r.resumoFluxo.silencioOk;
        resumo.turnos += r.resumoFluxo.turnos;
        if (!r.fluxoOk) cadeiaOk = false;
      }
      return { cadeiaOk, saida };
    });

    for (const r of resultados) relatorio.push(...r.saida);
    console.log(`\nCadeias OK: ${resultados.filter((r) => r.cadeiaOk).length}/${resultados.length}`);
  } else {
    for (const fluxo of fluxosRun) {
      const r = await executarFluxo(fluxo, mod, promptBase, historicoGlobal);
      historicoGlobal = r.historico;
      relatorio.push(...r.blocos);
      resumo.ok += r.resumoFluxo.ok;
      resumo.falha += r.resumoFluxo.falha;
      resumo.silencioOk += r.resumoFluxo.silencioOk;
      resumo.turnos += r.resumoFluxo.turnos;
    }
  }

  relatorio.push('## Resumo');
  relatorio.push(`- Validações OK: ${resumo.ok}`);
  relatorio.push(`- Validações com falha: ${resumo.falha}`);
  relatorio.push(`- Silêncios corretos: ${resumo.silencioOk}`);
  relatorio.push(`- Turnos processados: ${resumo.turnos}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outMd = resolve(OUT_DIR, `validacao-fluxos-${stamp}.md`);
  const outJson = resolve(OUT_DIR, `validacao-fluxos-${stamp}.json`);

  writeFileSync(outMd, relatorio.join('\n'), 'utf-8');
  writeFileSync(
    outJson,
    JSON.stringify({ telefone: TELEFONE, resumo, fluxos: fluxosRun.map((f) => f.id) }, null, 2),
    'utf-8',
  );

  console.log(`\nRelatório: ${outMd}`);
  console.log(`JSON: ${outJson}`);
  console.log(`Validações OK: ${resumo.ok} | Falhas: ${resumo.falha}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
