import { limparDebounceContato } from './debounce.js';
import { limparEstadoFluxo } from './estado-fluxo-redis.js';
import { limparFilaPorTelefone } from './fila-respostas.js';
import { limparHistorico } from './historico.js';
import { limparEstadoMonitorTelefone } from './monitor-telefone.js';
import { limparTracesContato } from './trace-pipeline.js';
import { normalizarTelefone, telefoneParaJid } from '../util/telefone.js';

export interface ResultadoResetContatoTeste {
  telefone: string;
  remoteJid: string;
  historicoLimpo: boolean;
  mensagensDebounceRemovidas: number;
  respostasPendentesRemovidas: number;
  tracesRemovidos: number;
  estadoFluxoLimpo: boolean;
}

export async function resetarContatoTeste(telefoneInformado: string): Promise<ResultadoResetContatoTeste> {
  const telefone = normalizarTelefone(telefoneInformado);
  if (!telefone || telefone.length < 10) {
    throw new Error('Informe um telefone valido com DDD');
  }

  const remoteJid = telefoneParaJid(telefone);
  const [mensagensDebounceRemovidas, respostasPendentesRemovidas, tracesRemovidos] =
    await Promise.all([
      limparDebounceContato(remoteJid),
      limparFilaPorTelefone(telefone),
      limparTracesContato(remoteJid),
    ]);

  await Promise.all([
    limparHistorico(remoteJid),
    limparEstadoFluxo(telefone),
    limparEstadoMonitorTelefone(telefone),
  ]);

  return {
    telefone,
    remoteJid,
    historicoLimpo: true,
    mensagensDebounceRemovidas,
    respostasPendentesRemovidas,
    tracesRemovidos,
    estadoFluxoLimpo: true,
  };
}
