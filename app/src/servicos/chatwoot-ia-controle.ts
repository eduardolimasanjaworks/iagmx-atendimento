/**
 * Leitura e sincronizacao do atributo `ia_controle` no Chatwoot.
 * Busca contato por telefone via API oficial e normaliza o valor da lista.
 * Sincroniza esse valor com a pausa local sem expor tokens ao browser.
 */
import { configChatwoot } from '../config-chatwoot.js';
import { despausarContato, pausarContato } from './pausa.js';
import { normalizarTelefone } from '../util/telefone.js';

export type IaControleValor = 'pausado' | 'ligado' | null;

interface ChatwootContact {
  id: number;
  name?: string | null;
  phone_number?: string | null;
  custom_attributes?: Record<string, unknown> | null;
}

interface ChatwootSearchResponse {
  payload?: ChatwootContact[];
}

interface ChatwootDefinition {
  attribute_key?: string;
  attribute_display_name?: string;
  attribute_values?: string | string[];
  attribute_model?: string;
}

interface ChatwootConversation {
  id: number;
  status?: string | null;
  custom_attributes?: Record<string, unknown> | null;
  updated_at?: number | string | null;
  created_at?: number | string | null;
}

interface ChatwootConversationResponse {
  payload?: ChatwootConversation[];
}

export interface ChatwootIaControleStatus {
  telefone: string;
  contatoEncontrado: boolean;
  contatoId: number | null;
  nome: string | null;
  phoneNumber: string | null;
  atributoExiste: boolean;
  atributoModelo: 'contact_attribute' | 'conversation_attribute' | null;
  atributoBruto: unknown;
  valorNormalizado: IaControleValor;
  conversaId: number | null;
  conversaStatus: string | null;
  origemToken: 'api_token' | 'secret_key_base' | 'ausente';
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'api-access-token': configChatwoot.adminApiToken,
  };
}

function tokenDisponivel(): 'api_token' | 'secret_key_base' | 'ausente' {
  if (configChatwoot.adminApiToken) return 'api_token';
  if (configChatwoot.secretKeyBase) return 'secret_key_base';
  return 'ausente';
}

function garantirApiToken(): void {
  if (configChatwoot.adminApiToken) return;
  if (configChatwoot.secretKeyBase) {
    throw new Error(
      'CHATWOOT_SECRET_KEY_BASE foi encontrado, mas ele nao autentica a API do Chatwoot. Configure um CHATWOOT_ADMIN_API_TOKEN valido.',
    );
  }
  throw new Error('CHATWOOT_ADMIN_API_TOKEN nao configurado para consultar contatos no Chatwoot.');
}

async function requestJson(path: string): Promise<unknown> {
  garantirApiToken();
  const res = await fetch(`${configChatwoot.baseUrl}${path}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detalhe = typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data);
    throw new Error(`Chatwoot respondeu ${res.status} em ${path}: ${detalhe}`);
  }
  return data;
}

function asArray<T>(valor: unknown): T[] {
  return Array.isArray(valor) ? (valor as T[]) : [];
}

function variacoesBuscaTelefone(telefone: string): string[] {
  const normalizado = normalizarTelefone(telefone);
  const set = new Set<string>([normalizado]);
  if (normalizado) set.add(`+${normalizado}`);
  if (normalizado.startsWith('55') && normalizado.length > 11) {
    set.add(normalizado.slice(2));
    set.add(`+${normalizado.slice(2)}`);
  }
  return [...set];
}

function escolherContatoPorTelefone(telefone: string, contatos: ChatwootContact[]): ChatwootContact | null {
  const alvo = normalizarTelefone(telefone);
  return (
    contatos.find((contato) => normalizarTelefone(contato.phone_number || '') === alvo) ?? contatos[0] ?? null
  );
}

export function normalizarValorIaControle(valor: unknown): IaControleValor {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim().toLowerCase();
  if (limpo === 'pausado' || limpo === 'pausar') return 'pausado';
  if (limpo === 'ligado' || limpo === 'ligar') return 'ligado';
  return null;
}

async function obterDefinicaoIaControlePorModelo(attributeModel: 0 | 1) {
  const data = await requestJson(
    `/api/v1/accounts/${configChatwoot.accountId}/custom_attribute_definitions?attribute_model=${attributeModel}`,
  );
  const defs = asArray<ChatwootDefinition>(data);
  return defs.find((item) => item.attribute_key === 'ia_controle') ?? null;
}

export async function obterDefinicaoIaControle() {
  const conversa = await obterDefinicaoIaControlePorModelo(0);
  if (conversa) return conversa;
  return obterDefinicaoIaControlePorModelo(1);
}

function timestampConversa(conversa: ChatwootConversation): number {
  const candidatos = [conversa.updated_at, conversa.created_at];
  for (const valor of candidatos) {
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    if (typeof valor === 'string') {
      const epoch = Date.parse(valor);
      if (Number.isFinite(epoch)) return epoch;
    }
  }
  return 0;
}

async function obterConversasContato(contactId: number): Promise<ChatwootConversation[]> {
  const data = (await requestJson(
    `/api/v1/accounts/${configChatwoot.accountId}/contacts/${contactId}/conversations`,
  )) as ChatwootConversationResponse;
  return asArray<ChatwootConversation>(data.payload).sort((a, b) => timestampConversa(b) - timestampConversa(a));
}

export async function obterStatusIaControleContato(telefone: string): Promise<ChatwootIaControleStatus> {
  const telefoneNormalizado = normalizarTelefone(telefone);
  const origemToken = tokenDisponivel();
  let definicaoExiste = false;
  let atributoModelo: ChatwootIaControleStatus['atributoModelo'] = null;
  try {
    const definicao = await obterDefinicaoIaControle();
    definicaoExiste = Boolean(definicao);
    atributoModelo =
      definicao?.attribute_model === 'conversation_attribute'
        ? 'conversation_attribute'
        : definicao?.attribute_model === 'contact_attribute'
          ? 'contact_attribute'
          : null;
  } catch {
    definicaoExiste = false;
  }

  let contatos: ChatwootContact[] = [];
  for (const q of variacoesBuscaTelefone(telefoneNormalizado)) {
    const params = new URLSearchParams({ q });
    const data = (await requestJson(
      `/api/v1/accounts/${configChatwoot.accountId}/contacts/search?${params.toString()}`,
    )) as ChatwootSearchResponse;
    contatos = asArray<ChatwootContact>(data.payload);
    if (contatos.length > 0) break;
  }

  const contato = escolherContatoPorTelefone(telefoneNormalizado, contatos);
  let atributoBruto = contato?.custom_attributes?.ia_controle;
  let conversaId: number | null = null;
  let conversaStatus: string | null = null;

  if (contato && atributoModelo === 'conversation_attribute') {
    const conversas = await obterConversasContato(contato.id);
    const conversa = conversas.find((item) => item.custom_attributes && 'ia_controle' in item.custom_attributes)
      ?? conversas[0]
      ?? null;
    if (conversa) {
      conversaId = conversa.id ?? null;
      conversaStatus = conversa.status ?? null;
      atributoBruto = conversa.custom_attributes?.ia_controle ?? null;
    }
  }

  return {
    telefone: telefoneNormalizado,
    contatoEncontrado: Boolean(contato),
    contatoId: contato?.id ?? null,
    nome: contato?.name ?? null,
    phoneNumber: contato?.phone_number ?? null,
    atributoExiste: definicaoExiste,
    atributoModelo,
    atributoBruto: atributoBruto ?? null,
    valorNormalizado: normalizarValorIaControle(atributoBruto),
    conversaId,
    conversaStatus,
    origemToken,
  };
}

export async function sincronizarPausaContatoViaChatwoot(telefone: string) {
  const status = await obterStatusIaControleContato(telefone);
  if (!status.contatoEncontrado) {
    return { ...status, sincronizado: false, acaoLocal: 'nenhum_contato_encontrado' as const };
  }
  if (!status.atributoExiste) {
    return { ...status, sincronizado: false, acaoLocal: 'atributo_ia_controle_ausente' as const };
  }
  if (status.valorNormalizado === 'pausado') {
    await pausarContato(status.telefone, 'chatwoot_ia_controle_pausado');
    return { ...status, sincronizado: true, acaoLocal: 'pausado_localmente' as const };
  }
  if (status.valorNormalizado === 'ligado') {
    await despausarContato(status.telefone);
    return { ...status, sincronizado: true, acaoLocal: 'liberado_localmente' as const };
  }
  return { ...status, sincronizado: false, acaoLocal: 'valor_ia_controle_nao_mapeado' as const };
}
