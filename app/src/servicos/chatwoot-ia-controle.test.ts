/**
 * Testes do mapeamento do atributo `ia_controle`.
 * Mantem o sync deterministico entre valores do Chatwoot e pausa local.
 * Evita regressao nos nomes da lista configurada no Chatwoot.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizarValorIaControle } from './chatwoot-ia-controle.js';

test('normaliza valor pausado do atributo ia_controle', () => {
  assert.equal(normalizarValorIaControle('pausado'), 'pausado');
  assert.equal(normalizarValorIaControle('pausar'), 'pausado');
  assert.equal(normalizarValorIaControle('  PAUSADO  '), 'pausado');
});

test('normaliza valor ligado do atributo ia_controle', () => {
  assert.equal(normalizarValorIaControle('ligado'), 'ligado');
  assert.equal(normalizarValorIaControle('ligar'), 'ligado');
  assert.equal(normalizarValorIaControle(' Ligado '), 'ligado');
});

test('retorna null para valor fora do contrato da lista', () => {
  assert.equal(normalizarValorIaControle('desconhecido'), null);
  assert.equal(normalizarValorIaControle(null), null);
  assert.equal(normalizarValorIaControle(1), null);
});
