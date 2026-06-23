import { config } from '../config.js';
import { gerarAutoavaliacaoConversas } from './autoavaliacao-conversas.js';

let emExecucao = false;

export function iniciarWorkerAutoavaliacaoConversas(): void {
  const intervalo = config.autoavaliacaoIntervaloMs;
  console.log(
    `[worker-autoavaliacao] Ativo — revisando traces a cada ${Math.round(intervalo / 60000)} min`,
  );

  const rodar = async () => {
    if (emExecucao) {
      console.warn('[worker-autoavaliacao] Ciclo anterior ainda em execução — pulando');
      return;
    }
    emExecucao = true;
    try {
      const relatorio = await gerarAutoavaliacaoConversas();
      console.log(
        `[worker-autoavaliacao] ${relatorio.totalTraces} traces revisados, ${relatorio.sinais.length} alerta(s)`,
      );
    } catch (err) {
      console.error('[worker-autoavaliacao] Falha no ciclo:', err);
    } finally {
      emExecucao = false;
    }
  };

  setTimeout(() => {
    void rodar();
  }, 90_000);

  setInterval(() => {
    void rodar();
  }, intervalo);
}
