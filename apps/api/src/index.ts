import { obterGrafoReal } from '@hero/agent/grafo-real';
import { build } from './app.js';

// O mesmo obterGrafoReal para /api/chat e /api/mcp: memoizado por processo, ele
// constrói o grafo (Postgres + Vertex AI + busca web) na primeira pergunta e o
// reaproveita nas seguintes, venha ela de qualquer uma das duas rotas. A API sobe
// mesmo sem as variáveis do grafo; nesse caso as perguntas recebem erro.
const app = build({ getGraph: obterGrafoReal });

app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
