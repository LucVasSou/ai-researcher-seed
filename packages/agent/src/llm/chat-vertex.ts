import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatVertexAI } from '@langchain/google-vertexai';

/**
 * Cria o cliente de chat da Vertex AI para um papel do grafo. O nome do modelo vem
 * da variável de ambiente do papel — nunca é escrito no código:
 *
 * - MODEL_GRADE: o nó `grade` (ex.: gemini-3.5-flash-lite)
 * - MODEL_ANSWER: o nó `answer` (ex.: gemini-3.6-flash)
 *
 * Autenticação: Application Default Credentials, como em `criarEmbeddingsVertex`.
 * Criar o cliente não chama a rede; a primeira chamada acontece no `invoke`.
 */
export function criarChatVertex(variavel: 'MODEL_GRADE' | 'MODEL_ANSWER'): BaseChatModel {
  const model = process.env[variavel];
  if (!model) {
    throw new Error(`${variavel} não definida.`);
  }

  return new ChatVertexAI({ model });
}
