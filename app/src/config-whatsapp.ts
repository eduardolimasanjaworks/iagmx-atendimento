/**
 * Resolve os dois alvos WhatsApp da IA: auxiliar de teste e oficial GMX.
 * Reaproveita env atual e arquivo local legado do Evolution oficial da GMX.
 * Mantem a configuracao centralizada para backend e interfaces consumirem igual.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface WhatsappTargetConfig {
  habilitado: boolean;
  url: string;
  apiKey: string;
  instancia: string;
  origem: string;
  titulo: string;
  descricao: string;
  permiteReconectar: boolean;
  permiteQr: boolean;
}

const FALLBACK_OFICIAL_URL = 'https://evolution.117.sanjaworks.com';
const FALLBACK_OFICIAL_API_KEY = '4813f30ee3d04216a0f7fc9c901a3646';
const FALLBACK_OFICIAL_INSTANCE = 'gmx-chatwoot';

function bool(chave: string, padrao = false): boolean {
  const valor = process.env[chave]?.trim().toLowerCase();
  if (!valor) return padrao;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(valor);
}

function lerArquivoChaveValor(...caminhos: string[]): Record<string, string> {
  for (const caminho of caminhos) {
    if (!existsSync(caminho)) continue;
    const linhas = readFileSync(caminho, 'utf8').split('\n');
    const dados: Record<string, string> = {};
    for (const linha of linhas) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('#') || limpa.startsWith('//')) continue;
      const idx = limpa.indexOf('=');
      if (idx === -1) continue;
      dados[limpa.slice(0, idx).trim()] = limpa.slice(idx + 1).trim();
    }
    return dados;
  }
  return {};
}

function comHttps(url: string): string {
  const limpa = url.trim();
  if (!limpa) return '';
  if (/^https?:\/\//i.test(limpa)) return limpa.replace(/\/$/, '');
  return `https://${limpa.replace(/\/$/, '')}`;
}

export function resolverConfigWhatsappTargets() {
  const legadoOficial = lerArquivoChaveValor(
    resolve(process.cwd(), '../.chatwootgmxtokenevolution.env'),
    resolve(process.cwd(), '.chatwootgmxtokenevolution.env'),
    '/app/.chatwootgmxtokenevolution.env',
  );

  const auxiliar: WhatsappTargetConfig = {
    habilitado: true,
    url: (process.env.WHATSAPP_AUXILIAR_URL ?? process.env.WHATSAPP_IA_URL ?? process.env.EVOLUTION_URL ?? 'http://evolution-api:8080').replace(/\/$/, ''),
    apiKey: process.env.WHATSAPP_AUXILIAR_API_KEY ?? process.env.WHATSAPP_IA_API_KEY ?? process.env.EVOLUTION_API_KEY ?? 'iagmx-evolution-key-2026',
    instancia: process.env.WHATSAPP_AUXILIAR_INSTANCE ?? process.env.WHATSAPP_IA_INSTANCE ?? process.env.EVOLUTION_INSTANCE ?? 'gmx-atendimento-v2',
    origem: process.env.WHATSAPP_AUXILIAR_ORIGEM ?? process.env.WHATSAPP_IA_ORIGEM ?? 'local_auxiliar',
    titulo: 'QR auxiliar IA de teste',
    descricao: 'Use este QR apenas no numero auxiliar de testes da IA, separado do numero oficial da GMX.',
    permiteReconectar: bool('WHATSAPP_AUXILIAR_PERMITE_RECONECTAR', false),
    permiteQr: true,
  };

  const oficialUrl = comHttps(
    process.env.WHATSAPP_OFICIAL_URL
      ?? process.env.WHATSAPP_CHATWOOT_FUTURO_URL
      ?? legadoOficial['url-evolution']
      ?? FALLBACK_OFICIAL_URL,
  );
  const oficialApiKey =
    process.env.WHATSAPP_OFICIAL_API_KEY
    ?? process.env.WHATSAPP_CHATWOOT_FUTURO_API_KEY
    ?? legadoOficial['token-da-evolution-do-chatwoot-da-gmx']
    ?? FALLBACK_OFICIAL_API_KEY;
  const oficialInstance =
    process.env.WHATSAPP_OFICIAL_INSTANCE
    ?? process.env.WHATSAPP_CHATWOOT_FUTURO_INSTANCE
    ?? legadoOficial['instancia-evo-chatwoot']
    ?? FALLBACK_OFICIAL_INSTANCE;
  const oficialHabilitado = bool(
    'WHATSAPP_OFICIAL_HABILITADO',
    Boolean(oficialUrl && oficialApiKey && oficialInstance),
  );

  const oficial: WhatsappTargetConfig = {
    habilitado: oficialHabilitado,
    url: oficialUrl,
    apiKey: oficialApiKey,
    instancia: oficialInstance,
    origem: process.env.WHATSAPP_OFICIAL_ORIGEM ?? 'chatwoot_oficial',
    titulo: 'QR oficial GMX / Chatwoot',
    descricao: 'Use este QR no numero oficial da GMX ligado ao Chatwoot. Esta e a unica conexao que pode ser reconectada pelo painel.',
    permiteReconectar: bool('WHATSAPP_OFICIAL_PERMITE_RECONECTAR', true),
    permiteQr: true,
  };

  return { auxiliar, oficial };
}
