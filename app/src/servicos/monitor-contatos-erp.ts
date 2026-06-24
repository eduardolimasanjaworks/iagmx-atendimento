/**
 * Lista contatos operacionais a partir do cadastro de motoristas do ERP.
 * Serve o topo do /phone sem depender de digitação manual nem fonte paralela.
 * Mantem só telefones válidos e já traz nome/local para a UI ficar mais lúdica.
 */
import { directusConfigurado, directusListar } from './directus.js';
import { normalizarTelefone, telefoneEhContatoValido } from '../util/telefone.js';

interface ContatoErpRaw {
  nome?: string;
  sobrenome?: string;
  telefone?: string;
  cidade?: string;
  estado?: string;
  ia_pausada?: boolean | null;
  precisa_atendimento?: boolean | null;
  status_cadastro?: string;
}

export interface ContatoMonitorErp {
  telefone: string;
  nome: string;
  cidade?: string;
  estado?: string;
  local?: string;
  statusCadastro?: string;
  iaPausada: boolean;
  precisaAtendimento: boolean;
  label: string;
}

function nomeCompleto(item: ContatoErpRaw): string {
  const nome = [item.nome, item.sobrenome].map((parte) => String(parte || '').trim()).filter(Boolean).join(' ');
  return nome || 'Motorista sem nome';
}

function localFormatado(item: ContatoErpRaw): string {
  return [item.cidade, item.estado].map((parte) => String(parte || '').trim()).filter(Boolean).join(' ');
}

function montarLabel(item: ContatoMonitorErp): string {
  const partes = [item.nome];
  if (item.local) partes.push(item.local);
  if (item.precisaAtendimento) partes.push('precisa ajuda');
  else if (item.iaPausada) partes.push('IA pausada');
  return partes.join(' · ');
}

export async function listarContatosMonitorErp(limite = 150): Promise<ContatoMonitorErp[]> {
  if (!directusConfigurado()) return [];

  const lista = await directusListar<ContatoErpRaw>('cadastro_motorista', {
    limit: String(Math.min(Math.max(limite, 1), 200)),
    sort: '-date_updated,-date_created',
    fields: 'nome,sobrenome,telefone,cidade,estado,ia_pausada,precisa_atendimento,status_cadastro',
  }).catch(() => []);

  const vistos = new Set<string>();
  const contatos: ContatoMonitorErp[] = [];

  for (const item of lista) {
    const telefone = normalizarTelefone(item.telefone ?? '');
    if (!telefoneEhContatoValido(telefone) || vistos.has(telefone)) continue;
    vistos.add(telefone);
    const local = localFormatado(item);
    const contato: ContatoMonitorErp = {
      telefone,
      nome: nomeCompleto(item),
      cidade: item.cidade ? String(item.cidade).trim() : undefined,
      estado: item.estado ? String(item.estado).trim() : undefined,
      local: local || undefined,
      statusCadastro: item.status_cadastro ? String(item.status_cadastro).trim() : undefined,
      iaPausada: Boolean(item.ia_pausada),
      precisaAtendimento: Boolean(item.precisa_atendimento),
      label: '',
    };
    contato.label = montarLabel(contato);
    contatos.push(contato);
  }

  return contatos;
}
