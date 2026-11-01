import type { Embeddings } from '@langchain/core/embeddings';
import type { RetrievedDoc } from '../db/retrieve-similar.js';

/** Quantos documentos o retrieve devolve quando ninguém diz o contrário. */
export const DEFAULT_TOP_K = 5;

/**
 * A função de busca que o nó recebe. Em produção é o `retrieveSimilar` com o `db`
 * já amarrado; no teste é um fake que devolve uma lista fixa.
 */
export type SearchSimilar = (embedding: number[], k: number) => Promise<RetrievedDoc[]>;

type RetrieveDeps = {
  embeddings: Embeddings;
  searchSimilar: SearchSimilar;
  k?: number;
};

/**
 * Cria o nó `retrieve`: transforma a pergunta em vetor e busca os documentos
 * mais próximos.
 *
 * O nó não importa cliente nenhum — embeddings e busca chegam por parâmetro.
 * É isso que deixa testar o nó sem rede e sem banco.
 */
export function makeRetrieveNode({ embeddings, searchSimilar, k = DEFAULT_TOP_K }: RetrieveDeps) {
  return async (state: { question: string }): Promise<{ documents: RetrievedDoc[] }> => {
    // embedQuery, e não embedDocuments: alguns modelos geram vetores diferentes
    // para "texto de busca" e "texto indexado".
    const questionEmbedding = await embeddings.embedQuery(state.question);

    const documents = await searchSimilar(questionEmbedding, k);

    return { documents };
  };
}
