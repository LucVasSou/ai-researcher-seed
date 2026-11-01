import type { Embeddings } from '@langchain/core/embeddings';
import { VertexAIEmbeddings } from '@langchain/google-vertexai';
import { EMBEDDING_DIMENSIONS } from '../db/schema.js';

/**
 * Cria o cliente de embeddings que chama a Vertex AI de verdade.
 *
 * Fica separado do seed de propósito: o seed recebe um `Embeddings` (a classe base
 * do LangChain) e não sabe de onde ele vem. O modo DEMO troca esta função por um
 * fake que devolve vetores sem tocar na rede.
 *
 * Autenticação: Application Default Credentials (`gcloud auth application-default login`
 * local, service account do Cloud Run em produção). Nenhuma chave em arquivo.
 */
export function criarEmbeddingsVertex(): Embeddings {
  const model = process.env.MODEL_EMBEDDING;
  if (!model) {
    throw new Error('MODEL_EMBEDDING não definida (ex.: gemini-embedding-001).');
  }

  return new VertexAIEmbeddings({
    model,
    dimensions: EMBEDDING_DIMENSIONS,
  });
}
