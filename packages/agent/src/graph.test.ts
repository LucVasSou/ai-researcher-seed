import { FakeEmbeddings, FakeListChatModel } from '@langchain/core/utils/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CorpusDoc } from './db/retrieve-similar.js';
import type { NewWebDocument } from './db/save-web-documents.js';
import { buildGraph, MAX_ITERATIONS, type GraphDeps } from './graph.js';
import { CircuitoAbertoError } from './search/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const SUFICIENTE = JSON.stringify({ sufficient: true, missingAspects: [] });
const INSUFICIENTE = JSON.stringify({ sufficient: false, missingAspects: ['motivo'] });

/**
 * Monta o grafo só com fakes. O LLM do grade devolve as respostas na ordem dada
 * e, ao acabar a lista, recomeça do início.
 */
function grafoComFakes(respostasDoGrade: string[]) {
  const gravados: NewWebDocument[] = [];

  const deps: GraphDeps = {
    embeddings: new FakeEmbeddings(),
    gradeLlm: new FakeListChatModel({ responses: respostasDoGrade }),
    answerLlm: new FakeListChatModel({ responses: ['A receita foi de R$ 127,9 bilhões [1].'] }),
    searchSimilar: async () => [],
    searchProvider: {
      search: async () => [{ title: 'Notícia', snippet: '', url: 'https://exemplo.com/1' }],
    },
    fetchPage: async () => '<p>texto da notícia</p>',
    saveWebDocuments: async (docs) => {
      gravados.push(...docs);
    },
  };

  return { app: buildGraph(deps), gravados };
}

/** Roda o grafo e devolve o nome de cada nó, na ordem em que foi visitado. */
async function nosVisitados(app: ReturnType<typeof buildGraph>, question: string) {
  const visitados: string[] = [];
  // Em streamMode 'updates', cada chunk é { nomeDoNó: atualizaçãoDoEstado }.
  for await (const chunk of await app.stream({ question }, { streamMode: 'updates' })) {
    visitados.push(...Object.keys(chunk));
  }
  return visitados;
}

describe('grafo', () => {
  it('vai direto ao answer quando o contexto é suficiente na primeira rodada', async () => {
    const { app, gravados } = grafoComFakes([SUFICIENTE]);

    expect(await nosVisitados(app, 'Qual a receita da Petrobras no 3T25?')).toEqual([
      'retrieve',
      'grade',
      'answer',
    ]);
    expect(gravados).toEqual([]);
  });

  it('faz o loop completo quando a primeira rodada é insuficiente', async () => {
    const { app, gravados } = grafoComFakes([INSUFICIENTE, SUFICIENTE]);

    expect(await nosVisitados(app, 'Por que o lucro da Petrobras caiu?')).toEqual([
      'retrieve',
      'grade',
      'webSearch',
      'retrieve',
      'grade',
      'answer',
    ]);
    expect(gravados.length).toBeGreaterThan(0);
  });

  it(`para em ${MAX_ITERATIONS} rodadas de grade mesmo com o LLM sempre insuficiente`, async () => {
    const { app } = grafoComFakes([INSUFICIENTE]);

    const visitados = await nosVisitados(app, 'Qual o preço-alvo da Petrobras?');

    expect(visitados.filter((no) => no === 'grade')).toHaveLength(MAX_ITERATIONS);
    // Estourar o limite não é erro: o grafo responde mesmo assim.
    expect(visitados.at(-1)).toBe('answer');
  });

  it('acumula iterations no estado via reducer', async () => {
    const { app } = grafoComFakes([INSUFICIENTE]);

    const final = await app.invoke({ question: 'Qual o preço-alvo da Petrobras?' });

    expect(final.iterations).toBe(MAX_ITERATIONS);
    expect(final.sufficient).toBe(false);
  });

  it('com a busca web sempre falhando, ainda termina em answer respondendo com o corpus', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const documentoCvm: CorpusDoc = {
      kind: 'cvm',
      ticker: 'KLBN11',
      companyName: 'Klabin S.A.',
      setor: 'Papel e Celulose',
      period: '1T26',
      periodEnd: '2026-03-31',
      sourceUrl: 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_2026.zip',
      fetchedAt: new Date('2026-05-20T00:00:00Z'),
      paragraph: 'A Klabin registrou prejuízo líquido de R$ 0,5 bilhão no 1T26.',
      distance: 0.1,
    };
    const buscasTentadas: string[] = [];
    const gravados: NewWebDocument[] = [];
    const answerLlm = new FakeListChatModel({
      responses: ['O contexto é incompleto. A Klabin teve prejuízo de R$ 0,5 bilhão no 1T26 [1].'],
    });
    const promptDoAnswer = vi.spyOn(answerLlm, 'invoke');

    const app = buildGraph({
      embeddings: new FakeEmbeddings(),
      gradeLlm: new FakeListChatModel({ responses: [INSUFICIENTE] }),
      answerLlm,
      searchSimilar: async () => [documentoCvm],
      searchProvider: {
        // Serper fora do ar, ou o circuito do comResiliencia aberto: toda busca lança.
        search: async (query) => {
          buscasTentadas.push(query);
          throw new CircuitoAbertoError(30_000);
        },
      },
      fetchPage: async () => '<p>nunca chamado</p>',
      saveWebDocuments: async (docs) => {
        gravados.push(...docs);
      },
    });

    const visitados: string[] = [];
    let finalAnswer = '';
    for await (const chunk of await app.stream(
      { question: 'O que motivou o prejuízo da Klabin no 1T26?' },
      { streamMode: 'updates' },
    )) {
      visitados.push(...Object.keys(chunk));
      if (chunk.answer) finalAnswer = chunk.answer.finalAnswer;
    }

    // O webSearch rodou, as buscas falharam, e o grafo seguiu: o guard cortou o loop.
    expect(visitados).toEqual(['retrieve', 'grade', 'webSearch', 'retrieve', 'grade', 'answer']);
    expect(buscasTentadas.length).toBeGreaterThan(0);
    expect(gravados).toEqual([]);

    // O answer foi avisado de que o contexto é incompleto, e respondeu com o corpus.
    expect(JSON.stringify(promptDoAnswer.mock.calls[0][0])).toContain('incompleto');
    expect(finalAnswer).toContain('prejuízo de R$ 0,5 bilhão no 1T26 [1]');
    expect(finalAnswer).toContain('Fontes:');
    expect(finalAnswer).toContain('dados.cvm.gov.br');
  });

  it('devolve a resposta do answer, com o bloco de fontes, no estado final', async () => {
    const { app } = grafoComFakes([SUFICIENTE]);

    const final = await app.invoke({ question: 'Qual a receita da Petrobras no 3T25?' });

    expect(final.finalAnswer).toContain('A receita foi de R$ 127,9 bilhões [1].');
    expect(final.finalAnswer).toContain('Fontes:');
  });
});
