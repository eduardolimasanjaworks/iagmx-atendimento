/**
 * Parse de pin GPS do WhatsApp e reverse geocoding (Nominatim).
 */
import type { ItemDebounce } from '../tipos/evolution.js';

export interface CoordenadasGps {
  latitude: number;
  longitude: number;
}

export interface EnderecoGpsDetalhado {
  localizacao: string;
  latitude: number;
  longitude: number;
  logradouro?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  uf?: string | null;
}

const CACHE_REVERSE = new Map<string, EnderecoGpsDetalhado>();

const RE_GPS =
  /\[Localiza[cç][aã]o GPS:\s*lat\s*([-\d.]+),\s*lng\s*([-\d.]+)/i;

export function extrairCoordenadasGps(texto: string): CoordenadasGps | null {
  const m = texto.match(RE_GPS);
  if (!m) return null;
  const latitude = parseFloat(m[1]);
  const longitude = parseFloat(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function extrairGpsDosItens(
  mensagem: string,
  itens: ItemDebounce[],
): CoordenadasGps | null {
  const direto = extrairCoordenadasGps(mensagem);
  if (direto) return direto;

  for (const item of [...itens].reverse()) {
    if (item.tipo !== 'localizacao') continue;
    const coords = extrairCoordenadasGps(item.conteudo);
    if (coords) return coords;
  }
  return null;
}

function montarCidadeUf(
  city?: string,
  town?: string,
  village?: string,
  state?: string,
): string | null {
  const local = city ?? town ?? village;
  if (!local) return null;
  const uf = state?.replace(/^Estado de\s+/i, '').trim();
  if (uf && uf.length <= 3) {
    return `${local} ${uf.toUpperCase()}`;
  }
  return local;
}

/** Reverse geocoding gratuito (OpenStreetMap). */
export async function resolverEnderecoPorGps(
  coords: CoordenadasGps,
): Promise<EnderecoGpsDetalhado | null> {
  const { latitude, longitude } = coords;
  const chave = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const cached = CACHE_REVERSE.get(chave);
  if (cached) return cached;
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('format', 'json');
  url.searchParams.set('accept-language', 'pt-BR');
  url.searchParams.set('zoom', '18');

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'iagmx-atendimento/1.0 (GMX logística)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      address?: {
        road?: string;
        pedestrian?: string;
        suburb?: string;
        neighbourhood?: string;
        city?: string;
        town?: string;
        village?: string;
        state?: string;
        state_code?: string;
        municipality?: string;
      };
    };
    const addr = body.address ?? {};
    const cidade =
      addr.city ?? addr.municipality ?? addr.town ?? addr.village ?? null;
    const estado = addr.state ?? null;
    const uf = addr.state_code?.trim().toUpperCase() ?? null;
    const localizacao =
      montarCidadeUf(
        addr.city ?? addr.municipality,
        addr.town,
        addr.village,
        addr.state_code ?? addr.state,
      ) ?? `lat ${latitude.toFixed(4)}, lng ${longitude.toFixed(4)}`;
    const detalhado: EnderecoGpsDetalhado = {
      localizacao,
      latitude,
      longitude,
      logradouro: addr.road ?? addr.pedestrian ?? null,
      bairro: addr.suburb ?? addr.neighbourhood ?? null,
      cidade,
      estado,
      uf,
    };
    CACHE_REVERSE.set(chave, detalhado);
    return detalhado;
  } catch {
    return null;
  }
}

/** Compatibilidade: mantém retorno reduzido para chamadas antigas. */
export async function resolverCidadePorGps(
  coords: CoordenadasGps,
): Promise<{ localizacao: string; latitude: number; longitude: number } | null> {
  const resolved = await resolverEnderecoPorGps(coords);
  if (!resolved) return null;
  return {
    localizacao: resolved.localizacao,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
  };
}
