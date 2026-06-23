import { config } from '../config.js';
import { gerarLoteContatoProativo } from './contato-proativo.js';

let emExecucao = false;

export function iniciarWorkerContatoProativo(): void {
  const intervalo = config.contatoProativoIntervaloMs;
  console.log(
    `[worker-contato-proativo] Ativo — sugestão de lote a cada ${Math.round(intervalo / 3600000)}h`,
  );

  const rodar = async () => {
    if (emExecucao) {
      console.warn('[worker-contato-proativo] Ciclo anterior ainda em execução — pulando');
      return;
    }
    emExecucao = true;
    try {
      await gerarLoteContatoProativo();
    } catch (err) {
      console.error('[worker-contato-proativo] Falha no ciclo:', err);
    } finally {
      emExecucao = false;
    }
  };

  setTimeout(() => {
    void rodar();
  }, 120_000);

  setInterval(() => {
    void rodar();
  }, intervalo);
}
