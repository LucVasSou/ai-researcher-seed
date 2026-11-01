import { FakeEmbeddings } from '@langchain/core/utils/testing';
import { describe, expect, it } from 'vitest';
import type { NewWebDocument } from '../db/save-web-documents.js';
import type { SearchProvider, SearchResult } from '../search/index.js';
import { buildQueries, makeWebSearchNode } from './web-search.js';

function resultado(n: number): SearchResult {
  return { title: `Página ${n}`, snippet: '', url: `https://exemplo.com/${n}` };
}

/** Busca fake: anota as queries recebidas e devolve sempre a mesma lista. */
function fakeSearchProvider(resultados: SearchResult[]) {
  const queries: string[] = [];
  const provider: SearchProvider = {
    async search(query) {
      queries.push(query);
      return resultados;
    },
  };
  return { provider, queries };
}

/**
 * fetchPage fake: cada URL do mapa devolve o HTML dado; URL fora do mapa rejeita,
 * como uma página fora do ar.
 */
function fakeFetchPage(paginas: Record<string, string>) {
  const urlsBaixadas: string[] = [];
  const fetchPage = async (url: string) => {
    urlsBaixadas.push(url);
    const pagina = paginas[url];
    if (pagina === undefined) {
      throw new Error(`fora do ar: ${url}`);
    }
    return pagina;
  };
  return { fetchPage, urlsBaixadas };
}

/** saveWebDocuments fake: guarda em memória o que seria inserido no banco. */
function fakeSave() {
  const gravados: NewWebDocument[] = [];
  const saveWebDocuments = async (docs: NewWebDocument[]) => {
    gravados.push(...docs);
  };
  return { saveWebDocuments, gravados };
}

const AGORA = new Date('2026-11-01T12:00:00Z');

describe('buildQueries', () => {
  it('monta uma query por aspecto faltante, prefixada pela pergunta', () => {
    expect(buildQueries('Petrobras 3T25', ['motivo da queda', 'guidance'])).toEqual([
      'Petrobras 3T25 motivo da queda',
      'Petrobras 3T25 guidance',
    ]);
  });

  it('usa só a pergunta quando não há aspecto faltante', () => {
    expect(buildQueries('Petrobras 3T25', [])).toEqual(['Petrobras 3T25']);
  });
});

describe('webSearch', () => {
  it('busca uma vez por aspecto faltante', async () => {
    const { provider, queries } = fakeSearchProvider([]);
    const webSearch = makeWebSearchNode({
      searchProvider: provider,
      ...fakeFetchPage({}),
      embeddings: new FakeEmbeddings(),
      ...fakeSave(),
    });

    await webSearch({ question: 'Por que o lucro caiu?', missingAspects: ['Petrobras', 'Vale'] });

    expect(queries).toEqual(['Por que o lucro caiu? Petrobras', 'Por que o lucro caiu? Vale']);
  });

  it('baixa só os 3 primeiros resultados de cada busca', async () => {
    const { fetchPage, urlsBaixadas } = fakeFetchPage({});
    const webSearch = makeWebSearchNode({
      searchProvider: fakeSearchProvider([1, 2, 3, 4, 5].map(resultado)).provider,
      fetchPage,
      embeddings: new FakeEmbeddings(),
      ...fakeSave(),
    });

    await webSearch({ question: 'qualquer', missingAspects: [] });

    expect(urlsBaixadas).toEqual([
      'https://exemplo.com/1',
      'https://exemplo.com/2',
      'https://exemplo.com/3',
    ]);
  });

  it('não baixa de novo uma URL que outra query já trouxe', async () => {
    const { fetchPage, urlsBaixadas } = fakeFetchPage({});
    const webSearch = makeWebSearchNode({
      searchProvider: fakeSearchProvider([resultado(1)]).provider,
      fetchPage,
      embeddings: new FakeEmbeddings(),
      ...fakeSave(),
    });

    await webSearch({ question: 'qualquer', missingAspects: ['a', 'b'] });

    expect(urlsBaixadas).toEqual(['https://exemplo.com/1']);
  });

  it('ignora a página que falhou e grava as outras', async () => {
    const { saveWebDocuments, gravados } = fakeSave();
    const webSearch = makeWebSearchNode({
      searchProvider: fakeSearchProvider([1, 2, 3].map(resultado)).provider,
      // A página 2 não está no mapa: o fake rejeita, como um timeout.
      ...fakeFetchPage({
        'https://exemplo.com/1': '<p>primeira</p>',
        'https://exemplo.com/3': '<p>terceira</p>',
      }),
      embeddings: new FakeEmbeddings(),
      saveWebDocuments,
    });

    await webSearch({ question: 'qualquer', missingAspects: [] });

    expect(gravados.map((doc) => doc.sourceUrl)).toEqual([
      'https://exemplo.com/1',
      'https://exemplo.com/3',
    ]);
  });

  it('grava um documento por chunk, com texto extraído do HTML, embedding e validade', async () => {
    const { saveWebDocuments, gravados } = fakeSave();
    const webSearch = makeWebSearchNode({
      searchProvider: fakeSearchProvider([resultado(1)]).provider,
      ...fakeFetchPage({ 'https://exemplo.com/1': `<p>${'a'.repeat(1500)}</p>` }),
      embeddings: new FakeEmbeddings(),
      saveWebDocuments,
      now: () => AGORA,
    });

    await webSearch({ question: 'Petrobras', missingAspects: ['motivo'] });

    // 1500 caracteres → chunks de 0 a 1000 e de 900 a 1500.
    expect(gravados).toHaveLength(2);
    expect(gravados[0]).toEqual({
      query: 'Petrobras motivo',
      title: 'Página 1',
      content: 'a'.repeat(1000),
      sourceUrl: 'https://exemplo.com/1',
      fetchedAt: AGORA,
      expiresAt: new Date('2026-11-08T12:00:00Z'),
      embedding: expect.any(Array),
    });
    expect(gravados[1].content).toBe('a'.repeat(600));
  });

  it('calcula a validade a partir do TTL passado na factory', async () => {
    const { saveWebDocuments, gravados } = fakeSave();
    const webSearch = makeWebSearchNode({
      searchProvider: fakeSearchProvider([resultado(1)]).provider,
      ...fakeFetchPage({ 'https://exemplo.com/1': '<p>texto</p>' }),
      embeddings: new FakeEmbeddings(),
      saveWebDocuments,
      ttlDays: 1,
      now: () => AGORA,
    });

    await webSearch({ question: 'qualquer', missingAspects: [] });

    expect(gravados[0].expiresAt).toEqual(new Date('2026-11-02T12:00:00Z'));
  });

  it('não grava nada quando todas as páginas falham', async () => {
    const { saveWebDocuments, gravados } = fakeSave();
    const webSearch = makeWebSearchNode({
      searchProvider: fakeSearchProvider([1, 2].map(resultado)).provider,
      ...fakeFetchPage({}),
      embeddings: new FakeEmbeddings(),
      saveWebDocuments,
    });

    const resultadoDoNo = await webSearch({ question: 'qualquer', missingAspects: [] });

    expect(gravados).toEqual([]);
    expect(resultadoDoNo).toEqual({});
  });
});
