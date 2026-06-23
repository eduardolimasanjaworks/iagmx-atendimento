/**
 * Atalhos admin para treinamento sem depender do WhatsApp do professor.
 * Cria proposta pendente ou aplica regra diretamente no bloco de treino.
 * Reaproveita as mesmas tabelas do modo treinador/professor.
 */
import pg from 'pg';
import { config } from '../config.js';
import { chatCompletionRaw } from './chat-providers.js';
import { registrarHistoricoConfiguracao } from './historico-configuracao.js';
import { obterBlocoTreinamentoWhatsapp } from './treinamento-whatsapp.js';
import { normalizarTelefone } from '../util/telefone.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });

export interface TreinamentoDiretoEntrada {
  telefoneAutor?: string;
  nomeAutor?: string;
  texto: string;
  autorAcao: string;
}

async function resumirInstrucaoTreinamento(
  texto: string,
): Promise<{ instrucao: string; resumo: string }> {
  const resposta = await chatCompletionRaw(
    [
      {
        role: 'system',
        content:
          'Voce transforma pedidos de treinamento em regras operacionais curtas para uma IA de atendimento da GMX. Responda SOMENTE JSON com {"instrucao":"...","resumo":"..."}',
      },
      {
        role: 'user',
        content: `Converta o texto abaixo em uma regra clara, objetiva e acionavel, sem perder intencao:\n\n${texto}`,
      },
    ],
    { temperature: 0.2, max_tokens: 220 },
  );

  const match = resposta.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { instrucao?: string; resumo?: string };
      const instrucao = parsed.instrucao?.trim();
      const resumo = parsed.resumo?.trim();
      if (instrucao) return { instrucao, resumo: resumo || instrucao };
    } catch {
      /* cai no fallback */
    }
  }

  const sane = texto.replace(/\s+/g, ' ').trim();
  return { instrucao: sane, resumo: sane.slice(0, 180) };
}

function telefoneSeguro(telefone?: string): string {
  return normalizarTelefone(telefone || '') || 'dashboard';
}

export async function criarPropostaTreinamentoDireto(opts: TreinamentoDiretoEntrada) {
  const texto = String(opts.texto || '').trim();
  if (texto.length < 10) throw new Error('Instrucao precisa ter pelo menos 10 caracteres');

  const { instrucao, resumo } = await resumirInstrucaoTreinamento(texto);
  const res = await pool.query(
    `INSERT INTO whatsapp_aprendizados_pendentes (
      telefone_autor, nome_autor, instrucao_sugerida, resumo_sugerido, origem_texto, status, confirmado_por, atualizado_em
    ) VALUES ($1, $2, $3, $4, $5, 'pendente', $6, NOW())
    RETURNING id, telefone_autor, nome_autor, instrucao_sugerida, resumo_sugerido, origem_texto, status, criado_em, atualizado_em`,
    [
      telefoneSeguro(opts.telefoneAutor),
      opts.nomeAutor?.trim() || 'Dashboard',
      instrucao,
      resumo,
      texto,
      opts.autorAcao,
    ],
  );
  return res.rows[0];
}

export async function aplicarInstrucaoTreinamentoDireto(opts: TreinamentoDiretoEntrada) {
  const texto = String(opts.texto || '').trim();
  if (texto.length < 10) throw new Error('Instrucao precisa ter pelo menos 10 caracteres');

  const { instrucao, resumo } = await resumirInstrucaoTreinamento(texto);
  const antes = await obterBlocoTreinamentoWhatsapp();
  const insert = await pool.query(
    `INSERT INTO whatsapp_aprendizados (
      telefone_autor, nome_autor, instrucao, resumo, origem_texto, ativo, atualizado_em
    ) VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
    RETURNING id, telefone_autor, nome_autor, instrucao, resumo, origem_texto, ativo, criado_em, atualizado_em`,
    [
      telefoneSeguro(opts.telefoneAutor),
      opts.nomeAutor?.trim() || 'Dashboard',
      instrucao,
      resumo,
      texto,
    ],
  );
  const depois = await obterBlocoTreinamentoWhatsapp();
  await registrarHistoricoConfiguracao({
    chave: 'whatsapp_aprendizados',
    origem: `dashboard_direto:${opts.autorAcao}`,
    antes,
    depois,
  });
  return insert.rows[0];
}
