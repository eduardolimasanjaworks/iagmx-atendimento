/**
 * Testes deterministas para reconciliar estados inconsistentes da Evolution.
 * Garantem que o painel nao force QR quando a instancia ja aparece aberta.
 * Mantem a regra pequena, previsivel e sem dependencia externa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolverStatusEvolution } from './evolution-status.js';

test('mantem open quando connectionState ja confirma conexao', () => {
  const resultado = resolverStatusEvolution({
    connectionState: 'open',
    fetchConnectionStatus: 'connecting',
  });

  assert.deepEqual(resultado, {
    state: 'open',
    conectado: true,
    fonte: 'connectionState',
  });
});

test('promove para open quando fetchInstances mostra sessao aberta com identidade', () => {
  const resultado = resolverStatusEvolution({
    connectionState: 'connecting',
    fetchConnectionStatus: 'open',
    hasOwnerJid: true,
  });

  assert.deepEqual(resultado, {
    state: 'open',
    conectado: true,
    fonte: 'fetchInstances',
  });
});

test('mantem connecting quando fetchInstances nao confirma sessao utilizavel', () => {
  const resultado = resolverStatusEvolution({
    connectionState: 'connecting',
    fetchConnectionStatus: 'open',
    hasOwnerJid: false,
    hasProfileName: false,
  });

  assert.deepEqual(resultado, {
    state: 'connecting',
    conectado: false,
    fonte: 'connectionState',
  });
});
