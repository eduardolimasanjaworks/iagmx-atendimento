/**
 * Envio humanizado: fragmentos, delay aleatório e "digitando..." (Evolution).
 */
import { dividirResposta } from './mensagem.js';
import { enviarTexto, enviarDigitando } from './evolution.js';
import {
  aguardar,
  aleatorioEntre,
  obterConfigHumanizacao,
  type ConfigHumanizacao,
} from './config-humanizacao.js';
import {
  limparEstadoMonitorTelefone,
  salvarEstadoMonitorTelefone,
} from './monitor-telefone.js';

/**
 * Envia fragmentos com pausas e typing via Evolution API.
 * Cada trecho entre vírgulas vira uma mensagem separada, sem ponto final.
 */
export async function enviarFragmentosHumanizado(
  instance: string,
  numero: string,
  textoCompleto: string,
  opts?: { fragmentar?: boolean; ignorarAtrasoInicial?: boolean; ignorarDigitando?: boolean },
): Promise<number> {
  const fragmentos =
    opts?.fragmentar === false ? [textoCompleto.trim() || 'Ok'] : dividirResposta(textoCompleto);
  const cfg = await obterConfigHumanizacao();
  const atrasoInicial = opts?.ignorarAtrasoInicial
    ? 0
    : aleatorioEntre(cfg.atrasoInicialMinMs, cfg.atrasoInicialMaxMs);

  if (atrasoInicial > 0) {
    console.log(`[envio] Atraso inicial ${atrasoInicial}ms antes de responder para ${numero}`);
    await salvarEstadoMonitorTelefone(numero, {
      fase: 'aguardando_atraso_inicial',
      mensagem: 'Aguardando atraso inicial antes da resposta',
      desdeMs: Date.now(),
      ateMs: Date.now() + atrasoInicial,
      sorteadoMs: atrasoInicial,
      totalFragmentos: fragmentos.length,
      detalhe: `${fragmentos.length} fragmento(s) programado(s)`,
    });
  }

  try {
    if (atrasoInicial > 0) await aguardar(atrasoInicial);

    for (let i = 0; i < fragmentos.length; i++) {
      if (i > 0) {
        const pausa = aleatorioEntre(cfg.delayMinMs, cfg.delayMaxMs);
        console.log(`[envio] Pausa ${pausa}ms antes do fragmento ${i + 1}/${fragmentos.length}`);
        await salvarEstadoMonitorTelefone(numero, {
          fase: 'pausa_fragmento',
          mensagem: 'Segurando antes do proximo fragmento',
          desdeMs: Date.now(),
          ateMs: Date.now() + pausa,
          sorteadoMs: pausa,
          fragmentoAtual: i + 1,
          totalFragmentos: fragmentos.length,
        });
        await aguardar(pausa);
      }

      await simularDigitacao(instance, numero, fragmentos[i], i, fragmentos.length, cfg, opts?.ignorarDigitando);
      await salvarEstadoMonitorTelefone(numero, {
        fase: 'enviando',
        mensagem: 'Enviando resposta ao WhatsApp',
        desdeMs: Date.now(),
        fragmentoAtual: i + 1,
        totalFragmentos: fragmentos.length,
        detalhe: fragmentos[i].slice(0, 120),
      });
      await enviarTexto(instance, numero, fragmentos[i]);
      console.log(
        `[envio] Fragmento ${i + 1}/${fragmentos.length} enviado (${fragmentos[i].length} chars)`,
      );
    }
  } catch (err) {
    await salvarEstadoMonitorTelefone(numero, {
      fase: 'erro',
      mensagem: 'Falha ao enviar resposta',
      desdeMs: Date.now(),
      detalhe: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  await salvarEstadoMonitorTelefone(numero, {
    fase: 'concluido',
    mensagem: 'Resposta enviada',
    desdeMs: Date.now(),
    totalFragmentos: fragmentos.length,
  });
  setTimeout(() => {
    void limparEstadoMonitorTelefone(numero);
  }, 120000).unref?.();

  return fragmentos.length;
}

async function simularDigitacao(
  instance: string,
  numero: string,
  texto: string,
  indiceFragmento: number,
  totalFragmentos: number,
  cfg: ConfigHumanizacao,
  ignorarDigitando?: boolean,
): Promise<void> {
  if (ignorarDigitando) return;
  if (!cfg.digitandoAtivo) return;
  const chanceBase = indiceFragmento === 0 ? 55 : 18;
  const bonusTamanho =
    texto.length >= 140 ? 20 : texto.length >= 80 ? 12 : texto.length >= 40 ? 6 : 0;
  const redutorMultiplosFragmentos = totalFragmentos >= 3 && indiceFragmento > 0 ? 8 : 0;
  const chanceFinal = Math.max(8, Math.min(85, chanceBase + bonusTamanho - redutorMultiplosFragmentos));
  const sorteio = aleatorioEntre(1, 100);

  if (sorteio > chanceFinal) {
    console.log(
      `[envio] Digitando pulado para ${numero} no fragmento ${indiceFragmento + 1}/${totalFragmentos} (sorteio ${sorteio} > chance ${chanceFinal})`,
    );
    return;
  }

  const ms = aleatorioEntre(cfg.digitandoMinMs, cfg.digitandoMaxMs);
  console.log(
    `[envio] Digitando ${ms}ms para ${numero} no fragmento ${indiceFragmento + 1}/${totalFragmentos} (chance ${chanceFinal}%, sorteio ${sorteio})`,
  );
  await salvarEstadoMonitorTelefone(numero, {
    fase: 'digitando',
    mensagem: 'Simulando digitacao',
    desdeMs: Date.now(),
    ateMs: Date.now() + ms,
    sorteadoMs: ms,
    fragmentoAtual: indiceFragmento + 1,
    totalFragmentos,
  });
  await enviarDigitando(instance, numero, ms);
  await aguardar(ms);
}
