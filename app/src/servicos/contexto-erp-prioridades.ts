/**
 * Regras fixas e pequenas para resumir prioridade operacional do motorista.
 * Destaca documentos minimos, frete ativo e ultima disponibilidade/localizacao.
 * Mantem a cobranca documental objetiva e sempre presente no prompt.
 */
import { resolverEnderecoPorGps, type CoordenadasGps, type EnderecoGpsDetalhado } from '../util/gps-localizacao.js';

export interface DocumentoPrioridade {
  label: string;
  obrigatorio: boolean;
  presente: boolean;
}

export interface EmbarquePrioridade {
  id: number | string;
  status?: string;
  origin?: string;
  destination?: string;
}

export interface DisponibilidadePrioridade {
  disponivel?: boolean | null;
  localizacao_atual?: string | null;
  local_disponibilidade?: string | null;
  local_destino_atual?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gps_timestamp?: string | null;
  data_previsao_disponibilidade?: string | null;
  date_updated?: string | null;
  date_created?: string | null;
}

interface OpcoesBloco {
  documentos: DocumentoPrioridade[];
  embarques: EmbarquePrioridade[];
  disponibilidade: DisponibilidadePrioridade | null;
  formatarData: (iso?: string) => string;
  resolverEnderecoGps?: (coords: CoordenadasGps) => Promise<EnderecoGpsDetalhado | null>;
}

function textoDisponibilidade(valor?: boolean | null): string {
  if (valor === true) return 'sim';
  if (valor === false) return 'nao';
  return 'nao informado';
}

function resumirFreteAtivo(embarques: EmbarquePrioridade[]): string {
  if (embarques.length === 0) return 'nenhum';
  return embarques
    .slice(0, 3)
    .map((item) => `#${item.id}${item.status ? ` ${item.status}` : ''}${item.origin && item.destination ? ` ${item.origin} -> ${item.destination}` : ''}`)
    .join('; ');
}

export async function montarBlocoPrioridadeMotorista(opts: OpcoesBloco): Promise<string[]> {
  const pendentes = opts.documentos.filter((item) => item.obrigatorio && !item.presente);
  const minimos = opts.documentos.filter((item) => item.obrigatorio);
  const disp = opts.disponibilidade;
  const referenciaDisponibilidade =
    disp?.gps_timestamp ?? disp?.date_updated ?? disp?.date_created ?? disp?.data_previsao_disponibilidade ?? undefined;
  const linhas: string[] = [
    'CONTEXTO FIXADO DE PRIORIDADE:',
    `- documentos_minimos_ok: ${pendentes.length === 0 && minimos.length > 0 ? 'sim' : 'nao'}`,
    `- documentos_minimos_pendentes: ${pendentes.length ? pendentes.map((item) => item.label).join(', ') : 'nenhum'}`,
    `- prioridade_ia_agora: ${pendentes.length ? 'cobrar documentos minimos pendentes antes de seguir para oferta' : 'documentacao minima ok, seguir fluxo normal'}`,
    `- frete_ativo_agora: ${opts.embarques.length > 0 ? `sim (${opts.embarques.length})` : 'nao'}`,
    `- resumo_frete_ativo: ${resumirFreteAtivo(opts.embarques)}`,
    `- ultima_disponibilidade_declarada: ${disp ? textoDisponibilidade(disp.disponivel) : 'sem registro'}`,
    `- ultima_disponibilidade_quando: ${disp ? opts.formatarData(referenciaDisponibilidade) : '—'}`,
    `- ultima_disponibilidade_local_texto: ${disp?.localizacao_atual || disp?.local_disponibilidade || 'nao informado'}`,
    `- ultima_disponibilidade_destino: ${disp?.local_destino_atual || 'nao informado'}`,
  ];

  if (disp?.latitude != null && disp?.longitude != null) {
    linhas.push(`- ultima_localizacao_gps: lat ${Number(disp.latitude).toFixed(5)}, lng ${Number(disp.longitude).toFixed(5)}`);
    const resolved = await (opts.resolverEnderecoGps ?? resolverEnderecoPorGps)({
      latitude: Number(disp.latitude),
      longitude: Number(disp.longitude),
    }).catch(() => null);
    if (resolved) {
      const localDetalhado = [resolved.logradouro, resolved.bairro, resolved.cidade && resolved.uf ? `${resolved.cidade}/${resolved.uf}` : resolved.cidade ?? null]
        .filter(Boolean)
        .join(' | ');
      linhas.push(`- ultima_localizacao_reversa: ${localDetalhado || resolved.localizacao}`);
    }
  } else {
    linhas.push('- ultima_localizacao_gps: nao informada');
  }

  if (disp?.data_previsao_disponibilidade) {
    linhas.push(`- previsao_de_ficar_livre: ${opts.formatarData(disp.data_previsao_disponibilidade)}`);
  }

  return linhas;
}
