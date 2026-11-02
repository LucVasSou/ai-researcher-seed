import { criarDb } from './db/client.js';
import { retrieveSimilar } from './db/retrieve-similar.js';
import { saveWebDocuments } from './db/save-web-documents.js';
import { buildGraph, type GraphDeps } from './graph.js';
import { criarChatVertex } from './llm/chat-vertex.js';
import { criarSearchProvider } from './search/index.js';
import { criarEmbeddingsVertex } from './seed/embeddings.js';
import { criarFetchPage } from './web/criar-fetch-page.js';

/**
 * Monta as dependências reais do grafo a partir das variáveis de ambiente:
 * Postgres (DATABASE_URL), Vertex AI (MODEL_EMBEDDING, MODEL_GRADE, MODEL_ANSWER)
 * e busca web (SEARCH_PROVIDER e chaves, ou DEMO=true).
 *
 * Nada aqui chama a rede: o pool do Postgres só conecta na primeira consulta, e os
 * clientes da Vertex só autenticam no primeiro `invoke`. Uma variável faltando,
 * por outro lado, lança erro já aqui.
 */
export function criarDependenciasReais(): GraphDeps {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL não definida.');
  }
  const { db } = criarDb(databaseUrl);

  return {
    embeddings: criarEmbeddingsVertex(),
    gradeLlm: criarChatVertex('MODEL_GRADE'),
    answerLlm: criarChatVertex('MODEL_ANSWER'),
    searchSimilar: (embedding, k) => retrieveSimilar(db, embedding, k),
    searchProvider: criarSearchProvider(),
    fetchPage: criarFetchPage(),
    saveWebDocuments: (docs) => saveWebDocuments(db, docs),
  };
}

export type GrafoReal = ReturnType<typeof buildGraph>;

let grafoReal: GrafoReal | undefined;

/**
 * O grafo real, um por processo. É construído na primeira chamada, não quando o
 * módulo é importado: um servidor que sobe sem DATABASE_URL só falha quando
 * alguém de fato pergunta. As chamadas seguintes reaproveitam o mesmo grafo — e,
 * com ele, o mesmo pool de conexões do Postgres e o mesmo estado do circuit
 * breaker da busca.
 *
 * Se a construção falhar (variável faltando), nada é guardado: a próxima chamada
 * tenta de novo.
 */
export function obterGrafoReal(): GrafoReal {
  grafoReal ??= buildGraph(criarDependenciasReais());
  return grafoReal;
}
