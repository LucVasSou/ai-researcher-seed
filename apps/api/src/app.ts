import Fastify from 'fastify';
import chatRoute, { type GraphLike } from './routes/chat.js';
import healthRoute from './routes/health.js';
import { checkDatabase as defaultCheckDatabase } from './db.js';
import { errorHandler } from './error-handler.js';

export interface BuildOptions {
  checkDatabase?: () => Promise<boolean>;
  /**
   * O grafo do agente. Sem ele, o /api/chat não é registrado: a montagem do
   * grafo com Vertex, Postgres e busca web ainda não existe em produção.
   */
  graph?: GraphLike;
}

export function build({ checkDatabase = defaultCheckDatabase, graph }: BuildOptions = {}) {
  const app = Fastify({ logger: true });

  // Antes das rotas: o handler vale para todo plugin registrado depois dele.
  app.setErrorHandler(errorHandler);

  app.register(
    async (api) => {
      api.register(healthRoute, { checkDatabase });
      if (graph) {
        api.register(chatRoute, { graph });
      }
    },
    { prefix: '/api' },
  );

  return app;
}
