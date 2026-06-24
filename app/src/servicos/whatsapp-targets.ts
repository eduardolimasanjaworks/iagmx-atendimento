/**
 * Catalogo unico dos alvos WhatsApp usados pela IA nas interfaces.
 * Define metadados, permissoes e conexao de cada numero sem duplicacao.
 * Mantem oficial e auxiliar com contratos claros para QR e reconexao.
 */
import { config } from '../config.js';

export type AlvoWhatsappNome = 'auxiliar_teste' | 'oficial_gmx';

export interface AlvoWhatsapp {
  nomeLogico: AlvoWhatsappNome;
  url: string;
  apiKey: string;
  instancia: string;
  origem: string;
  titulo: string;
  descricao: string;
  permiteReconectar: boolean;
  permiteQr: boolean;
}

function buildAuxiliar(): AlvoWhatsapp {
  return {
    nomeLogico: 'auxiliar_teste',
    url: config.whatsappAuxiliar.url,
    apiKey: config.whatsappAuxiliar.apiKey,
    instancia: config.whatsappAuxiliar.instancia,
    origem: config.whatsappAuxiliar.origem,
    titulo: config.whatsappAuxiliar.titulo,
    descricao: config.whatsappAuxiliar.descricao,
    permiteReconectar: config.whatsappAuxiliar.permiteReconectar,
    permiteQr: config.whatsappAuxiliar.permiteQr,
  };
}

function buildOficial(): AlvoWhatsapp | null {
  if (!config.whatsappOficial.habilitado) return null;
  if (!config.whatsappOficial.url || !config.whatsappOficial.apiKey || !config.whatsappOficial.instancia) {
    return null;
  }
  return {
    nomeLogico: 'oficial_gmx',
    url: config.whatsappOficial.url,
    apiKey: config.whatsappOficial.apiKey,
    instancia: config.whatsappOficial.instancia,
    origem: config.whatsappOficial.origem,
    titulo: config.whatsappOficial.titulo,
    descricao: config.whatsappOficial.descricao,
    permiteReconectar: config.whatsappOficial.permiteReconectar,
    permiteQr: config.whatsappOficial.permiteQr,
  };
}

export function listarAlvosWhatsapp(): AlvoWhatsapp[] {
  const alvos: AlvoWhatsapp[] = [buildAuxiliar()];
  const oficial = buildOficial();
  if (oficial) alvos.push(oficial);
  return alvos;
}

export function obterAlvoWhatsapp(nome: string | undefined | null): AlvoWhatsapp | null {
  if (!nome) return null;
  return listarAlvosWhatsapp().find((item) => item.nomeLogico === nome) ?? null;
}

export function obterAlvoWhatsappPadrao(): AlvoWhatsapp {
  return obterAlvoWhatsapp('oficial_gmx') ?? buildAuxiliar();
}
