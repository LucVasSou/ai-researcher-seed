import Fastify from 'fastify';
import { mcpHttpPlugin, type GraphLike as McpGraphLike } from '@hero/mcp-server';
import chatRoute, { type GraphLike as ChatGraphLike } from './routes/chat.js';
import healthRoute from './routes/health.js';
import { checkDatabase as defaultCheckDatabase } from './db.js';
import { errorHandler } from './error-handler.js';

/**
 * O grafo como a API o usa: `stream` para o /chat, `invoke` para o /mcp. O grafo
 * compilado do LangGraph tem os dois.
 */
export type ApiGraph = ChatGraphLike & McpGraphLike;

export interface BuildOptions {
  checkDatabase?: () => Promise<boolean>;
  /**
   * Quem entrega o grafo do agente. É uma função só, passada às duas rotas: /chat
   * e /mcp recebem o mesmo `getGraph`. Em produção é o `obterGrafoReal`, memoizado
   * por processo — um grafo, um SearchProvider, um circuit breaker para a mesma
   * API de busca, não dois.
   *
   * Sem ele, nem /api/chat nem /api/mcp são registrados.
   */
  getGraph?: () => ApiGraph;
}

export function build({ checkDatabase = defaultCheckDatabase, getGraph }: BuildOptions = {}) {
  const app = Fastify({ logger: true });

  // Antes das rotas: o handler vale para todo plugin registrado depois dele.
  app.setErrorHandler(errorHandler);

  app.register(
    async (api) => {
      api.register(healthRoute, { checkDatabase });
      if (getGraph) {
        api.register(chatRoute, { getGraph });
        // Gateway MCP para o Angular: mesma porta, mesmo prefixo /api e mesmo
        // proxy do /chat — nenhuma configuração de CORS nova.
        api.register(mcpHttpPlugin, { getGraph });
      }
    },
    { prefix: '/api' },
  );

  return app;
}
