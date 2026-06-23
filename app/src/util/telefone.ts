/**
 * Normalização de telefone WhatsApp / Chatwoot.
 */

/** Apenas dígitos (ex: 5511999999999) */
export function normalizarTelefone(valor: string): string {
  let d = valor.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  return d;
}

/** Contato individual plausível para monitor/disparo */
export function telefoneEhContatoValido(valor: string): boolean {
  const telefone = normalizarTelefone(valor);
  return telefone.length >= 10 && telefone.length <= 15;
}

/** remoteJid a partir de telefone */
export function telefoneParaJid(telefone: string): string {
  const n = normalizarTelefone(telefone);
  return `${n}@s.whatsapp.net`;
}

/** Identifica grupo/lista/broadcast no WhatsApp. */
export function jidEhGrupoOuLista(remoteJid: string | undefined | null): boolean {
  const jid = String(remoteJid ?? '').toLowerCase().trim();
  return jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.includes('@newsletter');
}

/** Telefone a partir de remoteJid */
export function jidParaTelefone(remoteJid: string): string {
  return normalizarTelefone(remoteJid.split('@')[0] ?? remoteJid);
}
