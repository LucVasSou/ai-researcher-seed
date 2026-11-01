import Fastify from 'fastify';
import chatRoute, { type GraphLike } from './routes/chat.js';
import healthRoute from './routes/health.js';
import { checkDatabase as defaultCheckDatabase } from './db.js';

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
