/**
 * Testes deterministicos para validar o contrato do webhook do WhatsApp.
 * Garante que conexoes validas tenham URL correta, habilitacao ligada
 * e os eventos minimos necessarios para inbound e QR.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarWebhookEvolutionParaTeste } from './evolution-webhook.js';

test('aceita webhook habilitado com url correta e eventos obrigatorios', () => {
  assert.equal(
    avaliarWebhookEvolutionParaTeste({
      url: 'https://iagmx.sanjaworks.com/webhook/evolution',
      enabled: true,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
    }),
    true,
  );
});

test('rejeita webhook ausente ou desabilitado', () => {
  assert.equal(avaliarWebhookEvolutionParaTeste(null), false);
  assert.equal(
    avaliarWebhookEvolutionParaTeste({
      url: 'https://iagmx.sanjaworks.com/webhook/evolution',
      enabled: false,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
    }),
    false,
  );
});

test('rejeita webhook sem todos os eventos obrigatorios', () => {
  assert.equal(
    avaliarWebhookEvolutionParaTeste({
      url: 'https://iagmx.sanjaworks.com/webhook/evolution',
      enabled: true,
      events: ['MESSAGES_UPSERT'],
    }),
    false,
  );
});
