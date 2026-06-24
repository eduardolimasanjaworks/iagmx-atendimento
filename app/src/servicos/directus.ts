/**
 * Cliente Directus GMX — motoristas, documentos, arquivos.
 */
import { config } from '../config.js';

let baseUrlAtiva: string | null = null;

const headersJson = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.directusToken}`,
});

export function directusConfigurado(): boolean {
  return Boolean(config.directusUrl && config.directusToken);
}

function url(baseUrl: string, caminho: string): string {
  return `${baseUrl}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;
}

function urlsCandidatas(): string[] {
  const primaria = String(config.directusUrl || '').trim().replace(/\/+$/, '');
  if (!primaria) return [];
  const candidatas = [primaria];

  try {
    const parsed = new URL(primaria);
    if (parsed.hostname === 'gmx_app') {
      candidatas.push(`${parsed.protocol}//127.0.0.1:8057`);
      candidatas.push(`${parsed.protocol}//localhost:8057`);
    }
  } catch {
    return [primaria];
  }

  return [...new Set(candidatas)];
}

async function fetchDirectus(caminho: string, init: RequestInit): Promise<Response> {
  if (!directusConfigurado()) throw new Error('Directus não configurado');
  const bases = baseUrlAtiva ? [baseUrlAtiva, ...urlsCandidatas().filter((item) => item !== baseUrlAtiva)] : urlsCandidatas();
  let ultimoErro: unknown;

  for (const base of bases) {
    try {
      const res = await fetch(url(base, caminho), init);
      baseUrlAtiva = base;
      return res;
    } catch (err) {
      ultimoErro = err;
    }
  }

  throw ultimoErro instanceof Error ? ultimoErro : new Error('Falha ao conectar no Directus');
}

async function obterBaseUrlAtiva(): Promise<string> {
  if (baseUrlAtiva) return baseUrlAtiva;
  const bases = urlsCandidatas();
  if (!bases.length) throw new Error('Directus não configurado');
  for (const base of bases) {
    try {
      const res = await fetch(url(base, '/server/ping'), { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        baseUrlAtiva = base;
        return base;
      }
    } catch {
      // tenta próxima
    }
  }
  return bases[0];
}

/** GET genérico na API Directus */
export async function directusGet<T = unknown>(caminho: string): Promise<T> {
  if (!directusConfigurado()) throw new Error('Directus não configurado');
  const res = await fetchDirectus(caminho, {
    headers: headersJson(),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Directus GET falhou (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Lista itens de uma coleção */
export async function directusListar<T = Record<string, unknown>>(
  colecao: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await directusGet<{ data: T[] }>(`/items/${colecao}${qs ? `?${qs}` : ''}`);
  return res.data ?? [];
}

/** POST em coleção */
export async function directusPost<T = unknown>(
  colecao: string,
  dados: Record<string, unknown>,
): Promise<T> {
  if (!directusConfigurado()) throw new Error('Directus não configurado');
  const res = await fetchDirectus(`/items/${colecao}`, {
    method: 'POST',
    headers: headersJson(),
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Directus POST ${colecao} falhou (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { data: T };
  return json.data;
}

/** PATCH em item */
export async function directusPatch<T = unknown>(
  colecao: string,
  id: number | string,
  dados: Record<string, unknown>,
): Promise<T> {
  if (!directusConfigurado()) throw new Error('Directus não configurado');
  const res = await fetchDirectus(`/items/${colecao}/${id}`, {
    method: 'PATCH',
    headers: headersJson(),
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Directus PATCH ${colecao}/${id} falhou (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { data: T };
  return json.data;
}

/** Upload de arquivo → retorna UUID do arquivo no Directus */
export async function directusUploadArquivo(
  buffer: Buffer,
  fileName: string,
  mimetype: string,
): Promise<string> {
  if (!directusConfigurado()) throw new Error('Directus não configurado');
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mimetype });
  form.append('file', blob, fileName);

  const res = await fetchDirectus('/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.directusToken}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Directus upload falhou (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { data: { id: string } };
  return json.data.id;
}

/** URL pública do asset no Directus */
export function directusAssetUrl(fileId: string): string {
  const base = baseUrlAtiva || String(config.directusUrl || '').trim().replace(/\/+$/, '');
  return `${base}/assets/${fileId}`;
}

export async function verificarDirectus(): Promise<boolean> {
  if (!directusConfigurado()) return false;
  try {
    const base = await obterBaseUrlAtiva();
    const res = await fetch(url(base, '/server/ping'), { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Valida token com uma leitura mínima */
export async function validarDirectusToken(): Promise<boolean> {
  if (!directusConfigurado()) return false;
  try {
    await directusListar('cadastro_motorista', { limit: '1', fields: 'id' });
    return true;
  } catch {
    return false;
  }
}
