#!/usr/bin/env node
/**
 * Bateria de capacidades operacionais: localização, cadastro, negociação de frete.
 * Uso: node scripts/teste-capacidades.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'app/dist/servicos');

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

const OPENAI = process.env.openaitoken || process.env.OPENAI_API_KEY;
if (!OPENAI) {
  console.error('Sem openaitoken');
  process.exit(1);
}

function normalizarRespostaWhatsapp(texto) {
  return texto
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ', ')
    .replace(/\.\s+/g, ', ')
    .replace(/\.\s*$/g, '')
    .replace(/\.(,|$)/g, '$1')
    .replace(/,{2,}/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairBlocosFerramenta(texto) {
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
      const parsed = JSON.parse(texto.slice(start, end));
      if (parsed.ferramenta) blocos.push(parsed);
    } catch { /* */ }
    i = end;
  }
  return blocos;
}

function textoVisivel(texto) {
  let t = texto;
  for (const b of extrairBlocosFerramenta(texto)) {
    t = t.replace(JSON.stringify(b), '');
  }
  return normalizarRespostaWhatsapp(t);
}

function avaliarTurno(textoBruto, espera) {
  const problemas = [];
  const visivel = textoVisivel(textoBruto);
  const blocos = extrairBlocosFerramenta(textoBruto);

  if (espera.semPontoFinal && /\.\s*$/.test(visivel)) problemas.push('ponto final');
  if (espera.naoContem) {
    for (const p of espera.naoContem) {
      if (visivel.toLowerCase().includes(p.toLowerCase())) problemas.push(`proibido: ${p}`);
    }
  }
  if (espera.contemAlgum) {
    const ok = espera.contemAlgum.some((s) => visivel.toLowerCase().includes(s.toLowerCase()));
    if (!ok) problemas.push(`faltou: ${espera.contemAlgum.join(' | ')}`);
  }
  if (espera.naoContemFerramenta) {
    const nomes = blocos.map((b) => b.ferramenta);
    for (const f of espera.naoContemFerramenta) {
      if (nomes.includes(f)) problemas.push(`ferramenta indevida: ${f}`);
    }
  }
  if (espera.ferramenta) {
    const { nome, dados = {} } = espera.ferramenta;
    const bloco = blocos.find((b) => b.ferramenta === nome);
    if (!bloco) problemas.push(`faltou ferramenta ${nome}`);
    else {
      for (const [k, v] of Object.entries(dados)) {
        const val = bloco.dados?.[k];
        if (v instanceof RegExp) {
          if (!v.test(String(val ?? ''))) problemas.push(`${nome}.${k} não bate (${val})`);
        } else if (val !== v && String(val).toLowerCase() !== String(v).toLowerCase()) {
          problemas.push(`${nome}.${k} esperado ${v}, veio ${val}`);
        }
      }
    }
  }
  if (/\{[^}]*"ferramenta"/i.test(visivel)) problemas.push('JSON vazou na mensagem');

  return { ok: problemas.length === 0, problemas, visivel, blocos };
}

const TELEFONE_TESTE = '5511999887766';

/** Fluxos multi-turno */
const FLUXOS = [
  {
    nome: 'Localização — vazio + cidade válida',
    turnos: [
      {
        historico: [
          {
            role: 'assistant',
            content:
              '[GMX]: Estamos atualizando nossa base de parceiros para novas ofertas de frete e vi que seu cadastro precisa de uma confirmação rápida',
          },
        ],
        user: 'pode falar',
        espera: { contemAlgum: ['vazio', 'carregado', 'disponível', 'disponivel'], semPontoFinal: true },
      },
      {
        user: 'to vazio',
        espera: {
          contemAlgum: ['local', 'cidade', 'localização', 'localizacao', 'onde'],
          semPontoFinal: true,
          naoContemFerramenta: ['registrar_disponibilidade'],
        },
      },
      {
        user: 'Campinas SP',
        espera: {
          contemAlgum: ['show', 'atualiz', 'boa', 'anot'],
          semPontoFinal: true,
          ferramenta: {
            nome: 'registrar_disponibilidade',
            dados: { localizacao_atual: /campinas/i, disponivel: true },
          },
        },
      },
    ],
  },
  {
    nome: 'Localização — referência vaga',
    turnos: [
      {
        historico: [
          { role: 'assistant', content: '[GMX]: Estamos atualizando nossa base de parceiros...' },
          { role: 'assistant', content: 'Show parceiro, você está vazio ou carregado?' },
          { role: 'user', content: 'vazio' },
          {
            role: 'assistant',
            content: 'Perfeito, manda sua localização atual ou escreve cidade e estado',
          },
        ],
        user: 'to perto do posto na rodovia',
        espera: {
          contemAlgum: ['cidade', 'estado', 'localização', 'localizacao', 'claro', 'dúvida'],
          naoContemFerramenta: ['registrar_disponibilidade'],
          semPontoFinal: true,
        },
      },
    ],
  },
  {
    nome: 'Disponibilidade via menu',
    turnos: [
      {
        historico: [
          {
            role: 'assistant',
            content: 'Oi parceiro, sou da GMX, cadastro documentos disponibilidade ou pagamento, o que você precisa?',
          },
        ],
        user: 'disponibilidade',
        espera: {
          contemAlgum: ['vazio', 'carregado', 'disponível', 'disponivel', 'onde', 'local'],
          semPontoFinal: true,
        },
      },
    ],
  },
  {
    nome: 'Cadastro — inicia coleta CNH',
    turnos: [
      {
        historico: [
          {
            role: 'assistant',
            content: 'Oi parceiro, sou da GMX, cadastro documentos disponibilidade ou pagamento, o que você precisa?',
          },
        ],
        user: 'quero me cadastrar',
        espera: {
          contemAlgum: ['cnh', 'foto', 'documento', 'cadastro'],
          semPontoFinal: true,
        },
      },
    ],
  },
  {
    nome: 'Cadastro — rejeita texto no lugar de foto',
    turnos: [
      {
        historico: [
          { role: 'assistant', content: 'Pra começar o cadastro, manda a foto da sua CNH por favor' },
        ],
        user: 'minha cnh é 12345678901',
        espera: {
          contemAlgum: ['foto', 'imagem', 'arquivo', 'enviar', 'mandar'],
          naoContem: ['obrigado pelo envio', 'recebi seu documento', 'salvando'],
          naoContemFerramenta: ['grava_ocr'],
          semPontoFinal: true,
        },
      },
    ],
  },
  {
    nome: 'Cadastro — recebe imagem CNH',
    turnos: [
      {
        historico: [
          { role: 'assistant', content: 'Manda a foto da CNH pra gente começar o cadastro' },
        ],
        user: '[motorista enviou imagem CNH]',
        contextoExtra: 'ANEXOS NESTE LOTE: midia_id=cnh-test-001 (cnh.jpg) — OBRIGATÓRIO incluir JSON grava_ocr com midia_id cnh-test-001',
        espera: {
          contemAlgum: ['recebi', 'cnh', 'próximo', 'proximo', 'crlv', 'obrigado', 'salv'],
          ferramenta: { nome: 'grava_ocr', dados: { tipo: 'cnh' } },
          semPontoFinal: true,
        },
      },
    ],
  },
  {
    nome: 'Cadastro — fluxo completo 5 docs',
    turnos: [
      {
        historico: [
          {
            role: 'assistant',
            content: 'Oi parceiro, sou da GMX, cadastro documentos disponibilidade ou pagamento, o que você precisa?',
          },
        ],
        user: 'quero me cadastrar',
        espera: {
          contemAlgum: ['cnh', 'foto', 'documento', 'cadastro'],
          semPontoFinal: true,
        },
      },
      {
        historico: [
          { role: 'assistant', content: 'Pra começar o cadastro, manda a foto da sua CNH por favor' },
        ],
        user: '[motorista enviou imagem CNH]',
        contextoExtra:
          'ANEXOS NESTE LOTE: midia_id=cnh-001 (cnh.jpg) — OBRIGATÓRIO incluir JSON grava_ocr tipo cnh com midia_id cnh-001',
        espera: {
          contemAlgum: ['crlv', 'próximo', 'proximo', 'recebi', 'cnh'],
          ferramenta: { nome: 'grava_ocr', dados: { tipo: 'cnh' } },
          semPontoFinal: true,
        },
      },
      {
        historico: [
          { role: 'assistant', content: 'CNH recebida, agora manda o CRLV do veículo' },
        ],
        user: '[motorista enviou imagem CRLV]',
        contextoExtra:
          'ANEXOS NESTE LOTE: midia_id=crlv-001 (crlv.jpg) — OBRIGATÓRIO incluir JSON grava_ocr tipo crlv com midia_id crlv-001',
        espera: {
          contemAlgum: ['antt', 'próximo', 'proximo', 'recebi', 'crlv'],
          ferramenta: { nome: 'grava_ocr', dados: { tipo: 'crlv' } },
          semPontoFinal: true,
        },
      },
      {
        historico: [
          { role: 'assistant', content: 'CRLV ok, manda agora a ANTT' },
        ],
        user: '[motorista enviou PDF ANTT]',
        contextoExtra:
          'ANEXOS NESTE LOTE: midia_id=antt-001 (antt.pdf) — OBRIGATÓRIO incluir JSON grava_ocr tipo antt com midia_id antt-001',
        espera: {
          contemAlgum: ['endereço', 'endereco', 'comprovante', 'próximo', 'proximo', 'antt'],
          ferramenta: { nome: 'grava_ocr', dados: { tipo: 'antt' } },
          semPontoFinal: true,
        },
      },
      {
        historico: [
          { role: 'assistant', content: 'Agora preciso do comprovante de endereço' },
        ],
        user: '[motorista enviou comprovante endereço]',
        contextoExtra:
          'ANEXOS NESTE LOTE: midia_id=end-001 (endereco.jpg) — OBRIGATÓRIO incluir JSON grava_ocr tipo endereco com midia_id end-001',
        espera: {
          contemAlgum: ['foto', 'caminhão', 'caminhao', 'veículo', 'veiculo', 'próximo', 'proximo'],
          ferramenta: { nome: 'grava_ocr', dados: { tipo: 'endereco' } },
          semPontoFinal: true,
        },
      },
      {
        historico: [
          { role: 'assistant', content: 'Por último manda uma foto do caminhão' },
        ],
        user: '[motorista enviou foto caminhão]',
        contextoExtra:
          'ANEXOS NESTE LOTE: midia_id=foto-001 (caminhao.jpg) — OBRIGATÓRIO incluir JSON grava_ocr tipo foto com midia_id foto-001',
        espera: {
          contemAlgum: ['recebi', 'foto', 'análise', 'analise', 'validação', 'validacao', 'envi'],
          ferramenta: { nome: 'grava_ocr', dados: { tipo: 'foto' } },
          semPontoFinal: true,
        },
      },
      {
        historico: [
          {
            role: 'assistant',
            content: 'Foto recebida, vou finalizar seu cadastro pra análise da equipe',
          },
        ],
        user: 'beleza',
        espera: {
          contemAlgum: ['análise', 'analise', 'validação', 'validacao', 'equipe', 'envi', 'aguard'],
          ferramenta: {
            nome: 'atualizar_motorista',
            dados: { status_cadastro: /AGUARDANDO/i },
          },
          semPontoFinal: true,
        },
      },
    ],
  },
  {
    nome: 'Oferta proativa — localização + interesse',
    turnos: [
      {
        historico: [
          {
            role: 'assistant',
            content:
              '[GMX]: Temos uma carga — retirada Guarulhos SP, entrega Curitiba PR, valor R$ 4.500,00 — você está por onde e tem interesse?',
          },
        ],
        user: 'to em Campinas SP',
        espera: {
          contemAlgum: ['interesse', 'topa', 'serve', 'campinas', '4500', '4.500', 'carga'],
          naoContemFerramenta: ['resposta_oferta_carga'],
          semPontoFinal: true,
        },
      },
      {
        user: 'topo sim',
        espera: {
          contemAlgum: ['show', 'anotei', 'equipe', 'fechado', 'combinado'],
          ferramenta: {
            nome: 'resposta_oferta_carga',
            dados: { aceite: true },
          },
          semPontoFinal: true,
        },
      },
    ],
  },
  {
    nome: 'Negociação — aceite direto',
    turnos: [
      {
        historico: [
          {
            role: 'assistant',
            content:
              '[GMX]: Temos uma carga — retirada Guarulhos SP, entrega Curitiba PR, valor R$ 4.500,00 — você está por onde e tem interesse?',
          },
        ],
        user: 'fechou pode mandar',
        espera: {
          contemAlgum: ['show', 'anotei', 'combinado', 'fechado', 'boa'],
          ferramenta: {
            nome: 'resposta_oferta_carga',
            dados: { aceite: true },
          },
          semPontoFinal: true,
        },
      },
    ],
  },
  {
    nome: 'Negociação — contraproposta e fechamento',
    turnos: [
      {
        historico: [
          {
            role: 'assistant',
            content:
              '[GMX]: Temos uma carga — retirada Guarulhos SP, entrega Curitiba PR, valor R$ 4.500,00 — você está por onde e tem interesse?',
          },
        ],
        user: 'só faço por 5000',
        espera: {
          contemAlgum: ['4500', '4.500', 'valor', 'negoci', 'piso', 'máximo', 'maximo', 'equipe'],
          naoContemFerramenta: ['resposta_oferta_carga'],
          semPontoFinal: true,
        },
      },
      {
        user: 'e se for 4350?',
        espera: {
          contemAlgum: ['show', 'fech', 'combinado', 'anotei', '4350', '4.350'],
          ferramenta: {
            nome: 'resposta_oferta_carga',
            dados: { aceite: true, valor_aceito: 4350 },
          },
          semPontoFinal: true,
        },
      },
    ],
  },
  {
    nome: 'Negociação — recusa',
    turnos: [
      {
        historico: [
          {
            role: 'assistant',
            content: '[GMX]: Temos uma carga — retirada Guarulhos SP, entrega Curitiba PR, valor R$ 4.500,00 — você está por onde e tem interesse?',
          },
        ],
        user: 'não rola essa não',
        espera: {
          contemAlgum: ['próxima', 'proxima', 'boa viagem', 'combinado', 'fica'],
          ferramenta: { nome: 'resposta_oferta_carga', dados: { aceite: false } },
          semPontoFinal: true,
        },
      },
    ],
  },
];

async function obterPrompt() {
  try {
    const res = await fetch('http://127.0.0.1:8095/api/prompt');
    const data = await res.json();
    return data.prompt;
  } catch {
    return readFileSync(resolve(ROOT, 'prompt inicial para avaliarmos dificuldade'), 'utf-8');
  }
}

async function gerarResposta(mensagem, historico, contextoExtra = '', promptBase) {
  const { montarPromptSistemaInferencia } = await import(`${DIST}/contexto-inferencia.js`);
  const { CAMADA_HUMANA } = await import(`${DIST}/camada-humana.js`).catch(() => ({
    CAMADA_HUMANA: '',
  }));

  const anexos = contextoExtra.includes('midia_id=')
    ? contextoExtra.replace(/.*?(midia_id=[^\n]+).*/s, '$1')
    : undefined;

  let system = await montarPromptSistemaInferencia({
    telefone: TELEFONE_TESTE,
    mensagemUsuario: mensagem,
    anexosLote: anexos,
    promptBase,
  });
  system += `\n\n${typeof CAMADA_HUMANA === 'string' ? CAMADA_HUMANA : ''}`;
  if (contextoExtra && !anexos) system += `\n\n${contextoExtra}`;
  else if (contextoExtra && anexos && contextoExtra.includes('OBRIGATÓRIO')) {
    system += `\n\n${contextoExtra}`;
  }

  const messages = [
    { role: 'system', content: system },
    ...historico,
    { role: 'user', content: mensagem },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages,
      temperature: 0.2,
      max_tokens: 700,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error?.code === 'rate_limit_exceeded') {
      await new Promise((r) => setTimeout(r, 10000));
      return gerarResposta(mensagem, historico, contextoExtra, promptBase);
    }
    throw new Error(JSON.stringify(data));
  }
  return data.choices[0].message.content.trim();
}

async function rodarFluxo(fluxo, promptBase) {
  const historico = [];
  const turnosResult = [];

  for (let i = 0; i < fluxo.turnos.length; i++) {
    const turno = fluxo.turnos[i];
    if (turno.historico) historico.push(...turno.historico);

    let bruto = await gerarResposta(turno.user, historico, turno.contextoExtra ?? '', promptBase);
    let aval = avaliarTurno(bruto, turno.espera);
    if (!aval.ok && turno.espera.ferramenta) {
      const lembreteFerramenta = turno.espera.ferramenta;
      const lembreteJson = JSON.stringify({
        ferramenta: lembreteFerramenta.nome,
        dados: lembreteFerramenta.dados ?? {},
      });
      await new Promise((r) => setTimeout(r, 2000));
      bruto = await gerarResposta(
        turno.user,
        historico,
        `${turno.contextoExtra ?? ''}\nLEMBRETE: inclua JSON da ferramenta ao final nesta estrutura exata: ${lembreteJson}`,
        promptBase,
      );
      aval = avaliarTurno(bruto, turno.espera);
    }

    turnosResult.push({
      passo: i + 1,
      user: turno.user,
      resposta: aval.visivel,
      ferramentas: aval.blocos.map((b) => b.ferramenta),
      ok: aval.ok,
      problemas: aval.problemas,
    });

    historico.push({ role: 'user', content: turno.user });
    historico.push({ role: 'assistant', content: aval.visivel });

    if (!aval.ok) return { ok: false, turnos: turnosResult };
    await new Promise((r) => setTimeout(r, 1200));
  }

  return { ok: true, turnos: turnosResult };
}

async function main() {
  console.log('=== BATERIA DE CAPACIDADES IA GMX ===\n');
  const prompt = await obterPrompt();
  console.log(`Prompt base: ${prompt.length} chars (inferência usa montarPromptSistemaInferencia + Directus + horário)\n`);

  const resultados = [];
  for (const fluxo of FLUXOS) {
    process.stdout.write(`[${fluxo.nome}] `);
    try {
      const r = await rodarFluxo(fluxo, prompt);
      console.log(r.ok ? '✓' : '✗');
      for (const t of r.turnos) {
        console.log(`  passo ${t.passo}: ${t.ok ? 'ok' : 'FALHOU'} — ${t.resposta.slice(0, 120)}`);
        if (t.ferramentas.length) console.log(`    ferramentas: ${t.ferramentas.join(', ')}`);
        if (t.problemas.length) console.log(`    → ${t.problemas.join('; ')}`);
      }
      resultados.push({ nome: fluxo.nome, ...r });
    } catch (e) {
      console.log('ERRO:', e.message);
      resultados.push({ nome: fluxo.nome, ok: false, erro: e.message });
    }
  }

  const ok = resultados.filter((r) => r.ok).length;
  const total = resultados.length;
  console.log(`\n=== RESUMO: ${ok}/${total} fluxos OK ===`);

  const rel = resolve(ROOT, 'scripts/ultimo-relatorio-capacidades.json');
  writeFileSync(rel, JSON.stringify({ resumo: { ok, total }, resultados }, null, 2));
  console.log(`Relatório: ${rel}`);
  process.exit(ok === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
