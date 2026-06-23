/**
 * Calcula a antecedencia do processamento antes do envio final.
 * Mantem uma janela curta para a IA gerar perto do disparo real.
 * O objetivo e iniciar o processamento em 10% do atraso configurado.
 */
export function calcularLeadProcessamentoMs(atrasoMs: number): number {
  if (!Number.isFinite(atrasoMs) || atrasoMs <= 0) return 0;
  return Math.min(10_000, Math.max(1_000, Math.floor(atrasoMs * 0.1)));
}
