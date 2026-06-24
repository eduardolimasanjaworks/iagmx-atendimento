/**
 * Testes deterministicos para o resumo documental no prompt da IA.
 * Garante que anexo pendente nao passe como documento completo.
 * Valida a diferenca entre pendente total, parcial e ok.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarDocumentoParaTeste } from './contexto-erp-documentos.js';

const fmt = (valor?: string) => valor || '—';

test('marca CNH sem anexo como cadastro parcial e presente falso', () => {
  const doc = avaliarDocumentoParaTeste(
    {
      colecao: 'cnh',
      label: 'CNH',
      obrigatorio: true,
      anexos: ['link'],
      criticos: ['cpf', 'nome', 'validade', 'categoria'],
      campos: [
        { campo: 'cpf', rotulo: 'CPF' },
        { campo: 'nome', rotulo: 'Nome' },
        { campo: 'validade', rotulo: 'Validade' },
        { campo: 'categoria', rotulo: 'Categoria' },
      ],
    },
    {
      cpf: '49807949807',
      nome: 'Motorista Teste',
      validade: '2321-12-31',
      categoria: 'E',
      link: '',
    },
    fmt,
  );
  assert.equal(doc.presente, false);
  assert.ok(doc.pendencias.includes('anexo'));
  assert.match(doc.detalhe, /cadastro parcial/i);
});

test('marca documento ausente como pendente total', () => {
  const doc = avaliarDocumentoParaTeste(
    {
      colecao: 'crlv',
      label: 'CRLV cavalo',
      obrigatorio: true,
      anexos: ['link'],
      criticos: ['placa_cavalo', 'renavam'],
      campos: [{ campo: 'placa_cavalo', rotulo: 'Placa' }],
    },
    null,
    fmt,
  );
  assert.equal(doc.presente, false);
  assert.deepEqual(doc.pendencias, ['sem registro']);
  assert.match(doc.detalhe, /pendente total/i);
});

test('marca antt com anexo e campos criticos como ok', () => {
  const doc = avaliarDocumentoParaTeste(
    {
      colecao: 'antt',
      label: 'ANTT cavalo',
      obrigatorio: true,
      anexos: ['link'],
      criticos: ['numero_antt'],
      campos: [{ campo: 'numero_antt', rotulo: 'Numero ANTT' }],
    },
    {
      numero_antt: '123456',
      link: 'https://arquivo.local/antt.pdf',
    },
    fmt,
  );
  assert.equal(doc.presente, true);
  assert.deepEqual(doc.pendencias, []);
  assert.match(doc.detalhe, /\bok\b/i);
});
