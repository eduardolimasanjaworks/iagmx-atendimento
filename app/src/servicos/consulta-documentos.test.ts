/**
 * Testes deterministicos da consulta objetiva de documentos.
 * Garante que perguntas diretas nao caiam no LLM nem virem resposta vaga.
 * Valida o resumo textual entregue ao motorista.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ehConsultaDocumentosParaTeste,
  montarRespostaConsultaDocumentosParaTeste,
} from './consulta-documentos.js';
import type { DocumentoMotoristaContexto } from './contexto-erp-documentos.js';

function doc(
  label: string,
  obrigatorio: boolean,
  pendencias: string[],
  atualizadoEm = '24/06',
): DocumentoMotoristaContexto {
  return {
    label,
    obrigatorio,
    presente: pendencias.length === 0,
    pendencias,
    atualizadoEm,
    detalhe: `- ${label}`,
  };
}

test('detecta pergunta objetiva sobre documentos faltantes', () => {
  assert.equal(ehConsultaDocumentosParaTeste('quais documentos estao faltando?'), true);
  assert.equal(ehConsultaDocumentosParaTeste('o que falta no meu cadastro ai?'), true);
  assert.equal(ehConsultaDocumentosParaTeste('bom dia parceiro'), false);
});

test('resume obrigatorios pendentes sem escalar para humano', () => {
  const resposta = montarRespostaConsultaDocumentosParaTeste(
    [
      doc('CNH', true, ['sem registro']),
      doc('CRLV cavalo', true, ['anexo']),
      doc('ANTT cavalo', true, []),
    ],
    true,
  );

  assert.match(resposta, /documentos obrigatorios/i);
  assert.match(resposta, /CNH \(sem registro/i);
  assert.match(resposta, /CRLV cavalo \(anexo/i);
  assert.doesNotMatch(resposta, /confirmar.*interna|ajuda humana/i);
});

test('informa cadastro ausente de forma objetiva', () => {
  const resposta = montarRespostaConsultaDocumentosParaTeste([], false);
  assert.match(resposta, /nao achei seu telefone vinculado/i);
  assert.match(resposta, /CNH, CRLV do cavalo, ANTT do cavalo/i);
});
