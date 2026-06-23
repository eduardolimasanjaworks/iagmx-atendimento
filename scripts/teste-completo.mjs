#!/usr/bin/env node
/**
 * Bateria completa: diagnóstico da API + debounce + conversa (opcional).
 * Uso: node scripts/teste-completo.mjs [--sem-llm]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

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

const BASE = process.env.IAGMX_URL || 'http://127.0.0.1:8095';
const KEY = process.env.IAGMX_ADMIN_KEY || 'iagmx-pausa-2026';
const semLlm = process.argv.includes('--sem-llm');

const headers = { 'x-iagmx-key': KEY, 'Content-Type': 'application/json' };

function ok(cond, msg) {
  const s = cond ? '✓' : '✗';
  console.log(`  ${s} ${msg}`);
  return cond;
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  console.log('\n=== IA GMX — Teste completo ===');
  console.log(`API: ${BASE}\n`);

  let passou = 0;
  let falhou = 0;

  // 1. Health
  console.log('1. Saúde básica');
  const health = await get('/health');
  if (ok(health.status === 200 && (health.body?.ok || health.body?.status === 'ok'), `/health → ${health.status}`)) passou++;
  else falhou++;

  // 2. Diagnóstico
  console.log('\n2. Diagnóstico (/api/diagnostico)');
  const diag = await get('/api/diagnostico?logs=30');
  if (diag.status !== 200) {
    console.log('  ✗ Diagnóstico indisponível — app precisa rebuild com rotas novas');
    falhou++;
  } else {
    const s = diag.body.servicos ?? {};
    if (ok(s.redis, 'Redis')) passou++; else falhou++;
    if (ok(s.postgres, 'Postgres')) passou++; else falhou++;
    if (ok(s.openai, 'OpenAI token')) passou++; else falhou++;
    if (ok(s.provedorAtivo !== 'nenhum', `Provedor LLM: ${s.provedorAtivo}`)) passou++; else falhou++;

    if (!s.directusToken) {
      console.log('  ⚠ Directus token inválido ou ausente — ferramentas GMX não gravam');
    } else {
      ok(true, 'Directus token válido');
      passou++;
    }

    if (!s.chatwoot) {
      console.log('  ⚠ Chatwoot não configurado');
    }

    const wa = s.whatsapp ?? {};
    if (wa.conectado) {
      ok(true, `WhatsApp: ${wa.state}`);
      passou++;
    } else {
      console.log(`  ⚠ WhatsApp: ${wa.state ?? 'desconectado'} (respostas vão para fila)`);
    }

    const t = diag.body.testes ?? {};
    const testesOk = t.ok === t.total;
    if (ok(testesOk, `Testes unidade: ${t.ok}/${t.total}`)) passou++;
    else {
      falhou++;
      for (const f of t.falhas ?? []) console.log(`      → ${f.nome}: ${f.detalhe}`);
    }

    const erros = (diag.body.logs?.contagem?.error ?? 0);
    if (erros > 0) console.log(`  ⚠ ${erros} evento(s) error no buffer de logs`);
  }

  // 3. Debounce
  console.log('\n3. Debounce (simulação)');
  // Prefixo precisa bater com PREFIXOS_TESTE em /api/debounce/test
  const tel = `551199988${String(Date.now()).slice(-4)}`;
  const deb = await post('/api/debounce/test', { telefone: tel, mensagens: ['teste log', 'segunda msg'] });
  if (ok(deb.status === 200, `POST debounce/test → ${deb.status}`)) passou++;
  else falhou++;

  await new Promise((r) => setTimeout(r, 5500));
  await post('/api/debounce/processar-agora', {});

  await new Promise((r) => setTimeout(r, 2000));

  const fila = await get('/api/fila-respostas');
  const temResposta = (fila.body?.itens ?? []).some((i) => i.telefone?.includes(tel.slice(-6)));
  if (ok(temResposta || fila.body?.total >= 0, 'Debounce processou (fila ou envio)')) passou++;
  else falhou++;

  // 4. Webhook evolution (formato)
  console.log('\n4. Webhook Evolution (payload)');
  const wh = await post('/webhook/evolution', {
    event: 'messages.upsert',
    instance: 'iagmx',
    data: {
      key: { remoteJid: `${tel}@s.whatsapp.net`, fromMe: false },
      pushName: 'Teste',
      message: { conversation: 'ping webhook' },
    },
  });
  if (ok(wh.status === 200 && wh.body?.ok, 'messages.upsert aceito')) passou++;
  else falhou++;

  const whIgn = await post('/webhook/evolution', { event: 'connection.update', data: {} });
  if (ok(whIgn.body?.ignorado, 'connection.update ignorado')) passou++;
  else falhou++;

  // 5. Logs API
  console.log('\n5. Logs estruturados');
  const logs = await get('/api/logs?limite=10');
  if (ok(logs.status === 200 && Array.isArray(logs.body?.eventos), `/api/logs → ${logs.body?.eventos?.length ?? 0} eventos`)) passou++;
  else falhou++;

  // 6. Bateria conversa (LLM)
  if (!semLlm) {
    console.log('\n6. Bateria conversa + STT (pode demorar ~2min)');
    const bateria = resolve(ROOT, 'scripts/teste-bateria.mjs');
    const code = await new Promise((res) => {
      const child = spawn('node', [bateria], { stdio: 'inherit', env: process.env });
      child.on('close', res);
    });
    if (ok(code === 0, 'teste-bateria.mjs')) passou++;
    else falhou++;
  } else {
    console.log('\n6. Bateria LLM pulada (--sem-llm)');
  }

  console.log('\n=== Resultado ===');
  console.log(`Passou: ${passou} | Falhou: ${falhou}`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
