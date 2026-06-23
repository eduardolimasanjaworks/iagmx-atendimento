/**
 * Reconciliação periódica: analisa históricos WhatsApp e garante espelho no ERP (coleção disponivel).
 */
import { config } from '../config.js';
import { ContadorCustoSessao } from '../util/custo-llm.js';
import {
  listarJidsHistoricoRecente,
  obterHistoricoBruto,
  type MensagemHistorico,
} from './historico.js';
import { jidParaTelefone } from '../util/telefone.js';
import {
  buscarUltimaDisponibilidade,
  buscarMotoristaPorTelefone,
  registrarDisponibilidade,
  verificarDisponibilidadeNoErp,
} from './motorista-gmx.js';
import { directusConfigurado } from './directus.js';
import { resolverDisponibilidadeComRedundancia } from './consenso-disponibilidade.js';

const PALAVRAS_DISPONIBILIDADE =
  /\b(dispon[ií]vel|vazio|livre|carregad|em viagem|localiza[cç][aã]o|to em|estou em|t[oô] em|por aqui|cidade|libero|libera)\b/i;

const TIMEOUT_IA_MS = Math.min(
  90_000,
  Math.max(20_000, parseInt(process.env.RECONCILIACAO_TIMEOUT_IA_MS ?? '45000', 10)),
);

export interface ExtracaoDisponibilidadeIa {
  refletiu_disponibilidade: boolean;
  disponivel: boolean;
  status: 'disponivel' | 'carregado' | 'indisponivel';
  localizacao_atual: string | null;
  local_disponibilidade: string | null;
  data_previsao_disponibilidade: string | null;
  confianca: number;
  evidencia: string;
}

function historicoRecente(
  msgs: MensagemHistorico[],
  janelaHoras: number,
): MensagemHistorico[] {
  const limite = Date.now() - janelaHoras * 60 * 60 * 1000;
  return msgs.filter((m) => m.timestamp >= limite);
}

function formatarTranscricao(msgs: MensagemHistorico[]): string {
  return msgs
    .map((m) => {
      const quem =
        m.papel === 'user'
          ? 'Motorista'
          : m.papel === 'assistant'
            ? 'IA GMX'
            : m.papel === 'empresa'
              ? 'Equipe GMX'
              : 'Sistema';
      return `${quem}: ${m.conteudo}`;
    })
    .join('\n');
}

async function extrairDisponibilidadeComIa(
  transcricao: string,
  telefone: string,
  contador: ContadorCustoSessao,
): Promise<ExtracaoDisponibilidadeIa | null> {
  const historico = transcricao
    .split('\n')
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => ({
      role: linha.startsWith('IA GMX:') || linha.startsWith('Equipe GMX:') ? 'assistant' : 'user',
      content: linha.replace(/^[^:]+:\s*/, ''),
    }));
  const mensagemAtual = historico.pop()?.content ?? '';
  const consensoPromise = resolverDisponibilidadeComRedundancia({
    historico,
    mensagemAtual,
  });
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), TIMEOUT_IA_MS);
  });
  const consenso = await Promise.race([consensoPromise, timeout]);
  if (!consenso) return null;
  for (const uso of consenso.usos) {
    contador.registrar({
      contexto: `reconciliacao_disponibilidade:${telefone}`,
      provedor: uso.provedor,
      modelo: uso.modelo,
      uso: uso.uso,
    });
  }
  return {
    refletiu_disponibilidade: consenso.assuntoDisponibilidade && consenso.status !== 'indefinido',
    disponivel: consenso.disponivel === true,
    status: consenso.status === 'indefinido' ? 'indisponivel' : consenso.status,
    localizacao_atual: consenso.localizacaoAtual,
    local_disponibilidade: consenso.localDisponibilidade,
    data_previsao_disponibilidade: consenso.dataPrevisaoDisponibilidade,
    confianca: consenso.confianca,
    evidencia: consenso.evidencia,
  };
}

function erpCondizComExtracao(
  erp: Record<string, unknown> | null,
  ext: ExtracaoDisponibilidadeIa,
): boolean {
  if (!erp) return false;
  const locErp = String(erp.localizacao_atual ?? erp.local_disponibilidade ?? '')
    .trim()
    .toLowerCase();
  const locExt = (ext.localizacao_atual ?? '').trim().toLowerCase();
  const locDispErp = String(erp.local_disponibilidade ?? '').trim().toLowerCase();
  const locDispExt = (ext.local_disponibilidade ?? '').trim().toLowerCase();
  const dispErp = erp.disponivel === true;
  if (locExt && locErp) {
    if (!locErp.includes(locExt.split(' ')[0]) && !locExt.includes(locErp.split(' ')[0])) {
      return false;
    }
  } else if (locExt && !locErp) {
    return false;
  }
  if (locDispExt && locDispErp && !locDispErp.includes(locDispExt.split(' ')[0])) {
    return false;
  }
  if (ext.disponivel !== dispErp && ext.status === 'disponivel') return false;
  return true;
}

export interface ResultadoReconciliacaoLote {
  analisados: number;
  candidatos: number;
  sincronizados: number;
  jaOk: number;
  ignorados: number;
  erros: number;
  interrompidoPorTimeout: boolean;
}

/**
 * Varre históricos Redis e reconcilia com ERP.
 */
export async function executarReconciliacaoDisponibilidade(): Promise<ResultadoReconciliacaoLote> {
  const inicioCiclo = Date.now();
  const deadline = inicioCiclo + config.reconciliacaoTimeoutMs;
  const tempoEsgotado = () => Date.now() >= deadline;

  const rotulo = `reconciliação disponibilidade ${new Date().toISOString()}`;
  const contador = new ContadorCustoSessao(rotulo);
  const resultado: ResultadoReconciliacaoLote = {
    analisados: 0,
    candidatos: 0,
    sincronizados: 0,
    jaOk: 0,
    ignorados: 0,
    erros: 0,
    interrompidoPorTimeout: false,
  };

  if (!directusConfigurado()) {
    console.warn('[reconciliacao-disponibilidade] Directus não configurado — ciclo ignorado');
    contador.imprimirResumo();
    return resultado;
  }

  const scanTimeout = Math.min(config.reconciliacaoTimeoutMs, 90_000);
  console.log(
    `[reconciliacao-disponibilidade] Scan Redis (max ${config.reconciliacaoMaxChavesScan} chaves, prefetch ${config.reconciliacaoPrefetchMensagens})…`,
  );

  const jids = await listarJidsHistoricoRecente({
    janelaHoras: config.reconciliacaoJanelaHoras,
    maxChaves: config.reconciliacaoMaxChavesScan,
    prefetchMensagens: config.reconciliacaoPrefetchMensagens,
    filtroConteudo: PALAVRAS_DISPONIBILIDADE,
    minMensagensNaJanela: 2,
    timeoutMs: scanTimeout,
  });

  console.log(
    `[reconciliacao-disponibilidade] Início — ${jids.length} candidato(s) após scan, janela ${config.reconciliacaoJanelaHoras}h, timeout ciclo ${config.reconciliacaoTimeoutMs}ms, max IA ${config.reconciliacaoMaxIaPorCiclo}`,
  );

  let chamadasIa = 0;

  for (const jid of jids) {
    if (tempoEsgotado()) {
      resultado.interrompidoPorTimeout = true;
      console.warn('[reconciliacao-disponibilidade] Ciclo interrompido por timeout global');
      break;
    }

    resultado.analisados += 1;
    resultado.candidatos += 1;
    const telefone = jidParaTelefone(jid);

    if (chamadasIa >= config.reconciliacaoMaxIaPorCiclo) {
      resultado.ignorados += 1;
      continue;
    }

    const bruto = await obterHistoricoBruto(jid);
    const recente = historicoRecente(bruto, config.reconciliacaoJanelaHoras);
    const transcricao = formatarTranscricao(recente.slice(-config.reconciliacaoMaxMensagens));

    try {
      chamadasIa += 1;
      console.log(
        `[reconciliacao-disponibilidade] IA ${chamadasIa}/${config.reconciliacaoMaxIaPorCiclo} → ${telefone}`,
      );

      const ext = await extrairDisponibilidadeComIa(transcricao, telefone, contador);
      if (!ext?.refletiu_disponibilidade || ext.confianca < 0.65) {
        resultado.ignorados += 1;
        continue;
      }

      const motorista = await buscarMotoristaPorTelefone(telefone);
      if (!motorista) {
        resultado.ignorados += 1;
        continue;
      }

      const erpAtual = await buscarUltimaDisponibilidade(motorista.id);
      if (erpCondizComExtracao(erpAtual, ext)) {
        resultado.jaOk += 1;
        console.log(
          `[reconciliacao-disponibilidade] OK ${telefone} — ERP já reflete (${ext.localizacao_atual ?? ext.status})`,
        );
        continue;
      }

      await registrarDisponibilidade({
        telefone,
        disponivel: ext.disponivel,
        status: ext.status,
        localizacao_atual: ext.localizacao_atual ?? undefined,
        local_disponibilidade: ext.local_disponibilidade ?? undefined,
        data_previsao_disponibilidade: ext.data_previsao_disponibilidade ?? undefined,
      });

      const verificacao = await verificarDisponibilidadeNoErp(telefone, {
        disponivel: ext.disponivel,
        localizacao_atual: ext.localizacao_atual ?? undefined,
        local_disponibilidade: ext.local_disponibilidade ?? undefined,
        status: ext.status,
      });

      if (verificacao.ok) {
        resultado.sincronizados += 1;
        console.log(
          `[reconciliacao-disponibilidade] SYNC ${telefone} → ${ext.localizacao_atual ?? ext.status} (conf=${ext.confianca.toFixed(2)})`,
        );
      } else {
        resultado.erros += 1;
        console.error(
          `[reconciliacao-disponibilidade] FALHA verificação ${telefone}: ${verificacao.motivo}`,
        );
      }
    } catch (err) {
      resultado.erros += 1;
      console.error(
        `[reconciliacao-disponibilidade] Erro ${telefone}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const duracaoS = ((Date.now() - inicioCiclo) / 1000).toFixed(1);
  console.log(
    `[reconciliacao-disponibilidade] Fim em ${duracaoS}s — candidatos=${resultado.candidatos} sync=${resultado.sincronizados} ja_ok=${resultado.jaOk} ignorados=${resultado.ignorados} erros=${resultado.erros}${resultado.interrompidoPorTimeout ? ' (timeout)' : ''}`,
  );
  contador.imprimirResumo();
  return resultado;
}
