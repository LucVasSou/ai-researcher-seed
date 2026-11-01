import { FakeEmbeddings, FakeListChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it } from 'vitest';
import type { NewWebDocument } from './db/save-web-documents.js';
import { buildGraph, MAX_ITERATIONS, type GraphDeps } from './graph.js';

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

  it('devolve a resposta do answer, com o bloco de fontes, no estado final', async () => {
    const { app } = grafoComFakes([SUFICIENTE]);

    const final = await app.invoke({ question: 'Qual a receita da Petrobras no 3T25?' });

    expect(final.finalAnswer).toContain('A receita foi de R$ 127,9 bilhões [1].');
    expect(final.finalAnswer).toContain('Fontes:');
  });
});
