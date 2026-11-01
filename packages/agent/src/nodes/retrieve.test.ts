import { Embeddings } from '@langchain/core/embeddings';
import { describe, expect, it } from 'vitest';
import type { RetrievedDoc } from '../db/retrieve-similar.js';
import { DEFAULT_TOP_K, makeRetrieveNode, type SearchSimilar } from './retrieve.js';

/** Embeddings fake: anota o texto recebido e devolve sempre o mesmo vetor. */
class FakeEmbeddings extends Embeddings {
  receivedQueries: string[] = [];

  constructor(private readonly vector: number[]) {
    super({});
  }

  async embedQuery(text: string): Promise<number[]> {
    this.receivedQueries.push(text);
    return this.vector;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(() => this.vector);
  }
}

const petr3T25: RetrievedDoc = {
  ticker: 'PETR',
  companyName: 'Petróleo Brasileiro S.A. - Petrobras',
  setor: 'Petróleo e Gás',
  period: '3T25',
  periodEnd: '2025-09-30',
  sourceUrl: 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_2025.zip',
  fetchedAt: new Date('2026-08-08T02:19:40.760Z'),
  paragraph: 'No 3T25, a Petrobras reportou receita líquida de R$ 127,9 bilhões.',
  distance: 0.12,
};

/** Busca fake: anota os argumentos recebidos e devolve uma lista fixa. */
function fakeSearch(result: RetrievedDoc[]) {
  const calls: { embedding: number[]; k: number }[] = [];
  const search: SearchSimilar = async (embedding, k) => {
    calls.push({ embedding, k });
    return result;
  };
  return { search, calls };
}

describe('retrieve', () => {
  it('gera o embedding da pergunta e busca com esse vetor', async () => {
    const embeddings = new FakeEmbeddings([0.1, 0.2, 0.3]);
    const { search, calls } = fakeSearch([petr3T25]);
    const retrieve = makeRetrieveNode({ embeddings, searchSimilar: search });

    const result = await retrieve({ question: 'Qual a receita da Petrobras no 3T25?' });

    expect(embeddings.receivedQueries).toEqual(['Qual a receita da Petrobras no 3T25?']);
    expect(calls[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result).toEqual({ documents: [petr3T25] });
  });

  it('usa top-k 5 por padrão', async () => {
    const { search, calls } = fakeSearch([]);
    const retrieve = makeRetrieveNode({
      embeddings: new FakeEmbeddings([0]),
      searchSimilar: search,
    });

    await retrieve({ question: 'qualquer' });

    expect(DEFAULT_TOP_K).toBe(5);
    expect(calls[0].k).toBe(5);
  });

  it('respeita o k passado na factory', async () => {
    const { search, calls } = fakeSearch([]);
    const retrieve = makeRetrieveNode({
      embeddings: new FakeEmbeddings([0]),
      searchSimilar: search,
      k: 3,
    });

    await retrieve({ question: 'qualquer' });

    expect(calls[0].k).toBe(3);
  });
});
