/**
 * Testa o bloco fixado de prioridade do motorista de forma deterministica.
 * Garante foco em documentos minimos antes de qualquer oferta operacional.
 * Evita regressao no resumo fixo que entra em toda inferencia.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarBlocoPrioridadeMotorista } from './contexto-erp-prioridades.js';

test('destaca documentos minimos pendentes como prioridade da ia', async () => {
  const linhas = await montarBlocoPrioridadeMotorista({
    documentos: [
      { label: 'CNH', obrigatorio: true, presente: false },
      { label: 'CRLV', obrigatorio: true, presente: true },
      { label: 'ANTT', obrigatorio: true, presente: false },
      { label: 'Fotos caminhão', obrigatorio: false, presente: false },
    ],
    embarques: [],
    disponibilidade: null,
    formatarData: (iso) => iso ?? '—',
    resolverEnderecoGps: async () => null,
  });

  assert.ok(linhas.some((linha) => linha.includes('documentos_minimos_pendentes: CNH, ANTT')));
  assert.ok(linhas.some((linha) => linha.includes('prioridade_ia_agora: cobrar documentos minimos pendentes')));
  assert.ok(linhas.some((linha) => linha.includes('frete_ativo_agora: nao')));
});

test('fixa disponibilidade e localizacao reversa quando ha gps', async () => {
  const linhas = await montarBlocoPrioridadeMotorista({
    documentos: [{ label: 'CNH', obrigatorio: true, presente: true }],
    embarques: [{ id: 77, status: 'in_transit', origin: 'Guarulhos SP', destination: 'Curitiba PR' }],
    disponibilidade: {
      disponivel: false,
      localizacao_atual: 'Registro bruto',
      latitude: -23.45,
      longitude: -46.53,
      gps_timestamp: '2026-06-24T12:00:00.000Z',
    },
    formatarData: (iso) => iso ?? '—',
    resolverEnderecoGps: async () => ({
      localizacao: 'Guarulhos/SP',
      latitude: -23.45,
      longitude: -46.53,
      logradouro: 'Avenida Santos Dumont',
      bairro: 'Centro',
      cidade: 'Guarulhos',
      uf: 'SP',
      estado: 'Sao Paulo',
    }),
  });

  assert.ok(linhas.some((linha) => linha.includes('frete_ativo_agora: sim (1)')));
  assert.ok(linhas.some((linha) => linha.includes('ultima_disponibilidade_declarada: nao')));
  assert.ok(linhas.some((linha) => linha.includes('Avenida Santos Dumont | Centro | Guarulhos/SP')));
});
