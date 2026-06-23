/**
 * Estimativa de custo LLM em USD — apenas logs de terminal (sem UI).
 */
export interface UsoTokens {
  input_tokens: number;
  output_tokens: number;
}

export interface RegistroCusto {
  contexto: string;
  provedor: string;
  modelo: string;
  input_tokens: number;
  output_tokens: number;
  custo_usd: number;
  quando: string;
}

/** USD por 1M tokens (estimativa — ajuste via env se necessário) */
const PRECOS_POR_1M: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  'whisper-1': { input: 0, output: 0 },
};

const FALLBACK_PROVEDOR: Record<string, { input: number; output: number }> = {
  openrouter: { input: 3, output: 15 },
  claude: { input: 3, output: 15 },
  openai: { input: 2.5, output: 10 },
  groq: { input: 0.59, output: 0.79 },
};

export function estimarCustoUsd(
  modelo: string,
  uso: UsoTokens,
  provedor?: string,
): number {
  const tarifa =
    PRECOS_POR_1M[modelo] ??
    (provedor ? FALLBACK_PROVEDOR[provedor] : undefined) ??
    { input: 3, output: 15 };

  const inCost = (uso.input_tokens / 1_000_000) * tarifa.input;
  const outCost = (uso.output_tokens / 1_000_000) * tarifa.output;
  return inCost + outCost;
}

export class ContadorCustoSessao {
  private registros: RegistroCusto[] = [];
  readonly rotulo: string;

  constructor(rotulo: string) {
    this.rotulo = rotulo;
  }

  registrar(opts: {
    contexto: string;
    provedor: string;
    modelo: string;
    uso: UsoTokens;
  }): RegistroCusto {
    const custo = estimarCustoUsd(opts.modelo, opts.uso, opts.provedor);
    const reg: RegistroCusto = {
      contexto: opts.contexto,
      provedor: opts.provedor,
      modelo: opts.modelo,
      input_tokens: opts.uso.input_tokens,
      output_tokens: opts.uso.output_tokens,
      custo_usd: custo,
      quando: new Date().toISOString(),
    };
    this.registros.push(reg);
    console.log(
      `[custo-llm] ${reg.contexto} | ${reg.provedor}/${reg.modelo} | in=${reg.input_tokens} out=${reg.output_tokens} | USD $${reg.custo_usd.toFixed(6)}`,
    );
    return reg;
  }

  totalUsd(): number {
    return this.registros.reduce((s, r) => s + r.custo_usd, 0);
  }

  quantidade(): number {
    return this.registros.length;
  }

  imprimirResumo(): void {
    const total = this.totalUsd();
    console.log(
      `[custo-llm] ══ ${this.rotulo} ══ ${this.quantidade()} requisição(ões) | total USD $${total.toFixed(4)}`,
    );
    if (this.registros.length > 1) {
      for (const r of this.registros) {
        console.log(
          `[custo-llm]   · ${r.contexto}: $${r.custo_usd.toFixed(6)} (${r.input_tokens}+${r.output_tokens} tok)`,
        );
      }
    }
  }
}
