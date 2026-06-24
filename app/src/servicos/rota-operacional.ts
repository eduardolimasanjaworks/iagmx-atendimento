/**
 * Normalizacao deterministica de rotas operacionais.
 * Evita match frouxo por includes entre origem, destino e operacao.
 * Mantem a mesma chave canônica no backend inteiro.
 */
export function normalizarTrechoRota(valor?: string | null): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parteOpcional(valor?: string | null): string {
  const normalizado = normalizarTrechoRota(valor);
  return normalizado || '__vazio__';
}

export function chaveRotaOperacional(opts: {
  origem?: string | null;
  destino?: string | null;
  operacao?: string | null;
  capacidade?: string | null;
}): string {
  return [
    normalizarTrechoRota(opts.origem),
    normalizarTrechoRota(opts.destino),
    parteOpcional(opts.operacao),
    parteOpcional(opts.capacidade),
  ].join('::');
}

export function mesmaRotaOperacional(
  a: { origem?: string | null; destino?: string | null; operacao?: string | null; capacidade?: string | null },
  b: { origem?: string | null; destino?: string | null; operacao?: string | null; capacidade?: string | null },
): boolean {
  const origemA = normalizarTrechoRota(a.origem);
  const destinoA = normalizarTrechoRota(a.destino);
  const origemB = normalizarTrechoRota(b.origem);
  const destinoB = normalizarTrechoRota(b.destino);

  if (!origemA || !destinoA || !origemB || !destinoB) return false;
  return chaveRotaOperacional(a) === chaveRotaOperacional(b);
}
