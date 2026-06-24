/**
 * Configuracao do Chatwoot para leitura de atributos personalizados.
 * Aceita envs atuais e tambem o arquivo legado do projeto.
 * Mantem separado o secret interno do token real da API.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface EnvMap {
  [key: string]: string | undefined;
}

function lerArquivoLegado(): EnvMap {
  const caminhos = [
    resolve(process.cwd(), '../.chatwootgmxtokenevolution.env'),
    resolve(process.cwd(), '.chatwootgmxtokenevolution.env'),
    '/app/.chatwootgmxtokenevolution.env',
  ];

  for (const caminho of caminhos) {
    if (!existsSync(caminho)) continue;
    const conteudo = readFileSync(caminho, 'utf-8');
    const valores: EnvMap = {};
    for (const linha of conteudo.split('\n')) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('#') || limpa.startsWith('//')) continue;
      const idx = limpa.indexOf('=');
      if (idx === -1) continue;
      valores[limpa.slice(0, idx).trim()] = limpa.slice(idx + 1).trim();
    }
    return valores;
  }

  return {};
}

function escolher(...valores: Array<string | undefined>): string {
  for (const valor of valores) {
    const limpo = valor?.trim();
    if (limpo) return limpo;
  }
  return '';
}

function normalizarBaseUrl(url: string): string {
  const limpa = url.trim();
  if (!limpa) return '';
  if (limpa.startsWith('http://') || limpa.startsWith('https://')) {
    return limpa.replace(/\/$/, '');
  }
  return `https://${limpa.replace(/\/$/, '')}`;
}

const legado = lerArquivoLegado();

export const configChatwoot = {
  baseUrl: normalizarBaseUrl(
    escolher(
      process.env.CHATWOOT_BASE_URL,
      process.env.CHATWOOT_URL,
      legado.CHATWOOT_BASE_URL,
      legado.CHATWOOT_URL,
      legado.CHATWOOTURL,
    ),
  ),
  accountId: Number(
    escolher(
      process.env.CHATWOOT_ACCOUNT_ID,
      legado.CHATWOOT_ACCOUNT_ID,
      '3',
    ),
  ),
  adminApiToken: escolher(
    process.env.CHATWOOT_ADMIN_API_TOKEN,
    process.env.CHATWOOT_API_ACCESS_TOKEN,
    process.env.CHATWOOT_API_TOKEN,
    process.env.CHATWOOT_ACCESS_TOKEN,
    legado.CHATWOOT_ADMIN_API_TOKEN,
    legado.CHATWOOT_API_ACCESS_TOKEN,
    legado.CHATWOOT_API_TOKEN,
  ),
  secretKeyBase: escolher(
    process.env.CHATWOOT_SECRET_KEY_BASE,
    legado.CHATWOOT_SECRET_KEY_BASE,
  ),
};
