import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import {
  combineByDistance,
  corpusQuery,
  webQuery,
  type CorpusDoc,
  type WebDoc,
} from './retrieve-similar.js';
import * as schema from './schema.js';

/**
 * Um Drizzle sem conexão: monta o SQL mas não consegue executar. O tipo difere do
 * Db real só no `$client`, que estes testes nunca tocam — daí o cast.
 */
const dbSemConexao = drizzle.mock({ schema }) as unknown as Db;

function corpusDoc(ticker: string, distance: number): CorpusDoc {
  return {
    kind: 'cvm',
    ticker,
    companyName: ticker,
    setor: 'qualquer',
    period: '3T25',
    periodEnd: '2025-09-30',
    sourceUrl: 'https://dados.cvm.gov.br',
    fetchedAt: new Date('2026-08-08T00:00:00Z'),
    paragraph: '...',
    distance,
  };
}

function webDoc(title: string, distance: number): WebDoc {
  return {
    kind: 'web',
    title,
    content: '...',
    sourceUrl: 'https://exemplo.com',
    fetchedAt: new Date('2026-10-30T00:00:00Z'),
    distance,
  };
}

describe('combineByDistance', () => {
  it('intercala corpus e web pela distância, do mais próximo ao mais distante', () => {
    const combinados = combineByDistance(
      [corpusDoc('PETR', 0.1), corpusDoc('VALE', 0.4)],
      [webDoc('notícia', 0.2)],
      5,
    );

    expect(combinados.map((doc) => doc.distance)).toEqual([0.1, 0.2, 0.4]);
    expect(combinados.map((doc) => doc.kind)).toEqual(['cvm', 'web', 'cvm']);
  });

  it('corta o total em k', () => {
    const combinados = combineByDistance(
      [corpusDoc('PETR', 0.3), corpusDoc('VALE', 0.4)],
      [webDoc('a', 0.1), webDoc('b', 0.2)],
      3,
    );

    expect(combinados.map((doc) => doc.distance)).toEqual([0.1, 0.2, 0.3]);
  });
});

describe('consultas', () => {
  it('ordena o corpus pela distância de cosseno (<=>) e limita em k', () => {
    const { sql, params } = corpusQuery(dbSemConexao, [0.1, 0.2], 5).toSQL();

    expect(sql).toContain('from "documentos"');
    expect(sql).toMatch(/order by .*<=>/);
    expect(params).toContain(5);
  });

  it('busca em documentos_web filtrando os expirados pelo relógio do banco', () => {
    const { sql } = webQuery(dbSemConexao, [0.1, 0.2], 5).toSQL();

    expect(sql).toContain('from "documentos_web"');
    expect(sql).toContain('"documentos_web"."expires_at" > now()');
    expect(sql).toMatch(/order by .*<=>/);
  });
});
