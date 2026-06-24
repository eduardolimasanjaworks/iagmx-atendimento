/**
 * Regras pequenas para reconciliar estados incoerentes da Evolution API.
 * Mantem a decisao isolada para teste deterministico sem depender de HTTP.
 * Evita falso "aguardando QR" quando a instancia ja consta como aberta.
 */
export interface EvolutionStatusInput {
  connectionState?: string | null;
  fetchConnectionStatus?: string | null;
  hasOwnerJid?: boolean;
  hasProfileName?: boolean;
}

export interface EvolutionStatusOutput {
  state: string;
  conectado: boolean;
  fonte: 'connectionState' | 'fetchInstances' | 'fallback';
}

const OPEN_STATES = new Set(['open', 'connected']);

function normalizarEstado(valor?: string | null): string {
  return String(valor ?? '')
    .trim()
    .toLowerCase();
}

export function resolverStatusEvolution(input: EvolutionStatusInput): EvolutionStatusOutput {
  const state = normalizarEstado(input.connectionState);
  const fetchState = normalizarEstado(input.fetchConnectionStatus);
  const hasIdentity = Boolean(input.hasOwnerJid || input.hasProfileName);

  if (OPEN_STATES.has(state)) {
    return { state: 'open', conectado: true, fonte: 'connectionState' };
  }

  if (OPEN_STATES.has(fetchState) && hasIdentity) {
    return { state: 'open', conectado: true, fonte: 'fetchInstances' };
  }

  if (state) {
    return { state, conectado: false, fonte: 'connectionState' };
  }

  if (fetchState) {
    return { state: fetchState, conectado: OPEN_STATES.has(fetchState), fonte: 'fetchInstances' };
  }

  return { state: 'desconhecido', conectado: false, fonte: 'fallback' };
}
