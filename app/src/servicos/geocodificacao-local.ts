/**
 * Geocodificacao simples e auditavel para locais textuais.
 * Prioriza mapa deterministico conhecido e depois consulta Nominatim com timeout.
 * O resultado informa fonte e momento da resolucao para persistencia no ERP.
 */
type Coordenadas = {
  latitude: number;
  longitude: number;
  fonte: 'gps' | 'mapa_estatico' | 'nominatim';
  geocodedAt: string;
};

const CACHE = new Map<string, Coordenadas>();
const CITY_COORDS: Record<string, { latitude: number; longitude: number }> = {
  'guarulhos sp': { latitude: -23.4543, longitude: -46.5337 },
  'campinas sp': { latitude: -22.9099, longitude: -47.0626 },
  'sao paulo sp': { latitude: -23.5505, longitude: -46.6333 },
  'rio de janeiro rj': { latitude: -22.9068, longitude: -43.1729 },
  'belo horizonte mg': { latitude: -19.9167, longitude: -43.9345 },
  'curitiba pr': { latitude: -25.4284, longitude: -49.2733 },
  'porto alegre rs': { latitude: -30.0346, longitude: -51.2177 },
  'goiania go': { latitude: -16.6869, longitude: -49.2648 },
  'brasilia df': { latitude: -15.7939, longitude: -47.8828 },
  'salvador ba': { latitude: -12.9777, longitude: -38.5016 },
  'recife pe': { latitude: -8.0578, longitude: -34.8829 },
  'fortaleza ce': { latitude: -3.7319, longitude: -38.5267 },
};

function normalizarLocal(local?: string | null): string {
  return String(local ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[,/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function coordenadaEstatica(local: string): Coordenadas | null {
  const base = CITY_COORDS[local];
  if (!base) return null;
  return {
    latitude: base.latitude,
    longitude: base.longitude,
    fonte: 'mapa_estatico',
    geocodedAt: new Date().toISOString(),
  };
}

async function coordenadaNominatim(local: string): Promise<Coordenadas | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${local}, Brasil`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'br');

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'gmx-iagmx/1.0',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);

  if (!res?.ok) return null;
  const body = (await res.json().catch(() => [])) as Array<{ lat?: string; lon?: string }>;
  const item = body[0];
  const latitude = Number(item?.lat);
  const longitude = Number(item?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    fonte: 'nominatim',
    geocodedAt: new Date().toISOString(),
  };
}

export async function geocodificarLocalTexto(
  local?: string | null,
): Promise<Coordenadas | null> {
  const chave = normalizarLocal(local);
  if (!chave) return null;

  const cache = CACHE.get(chave);
  if (cache) return cache;

  const estatico = coordenadaEstatica(chave);
  if (estatico) {
    CACHE.set(chave, estatico);
    return estatico;
  }

  const remoto = await coordenadaNominatim(chave);
  if (remoto) {
    CACHE.set(chave, remoto);
    return remoto;
  }
  return null;
}

export function coordenadasGps(
  latitude?: number | null,
  longitude?: number | null,
): Coordenadas | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
    fonte: 'gps',
    geocodedAt: new Date().toISOString(),
  };
}
