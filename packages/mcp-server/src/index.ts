/**
 * A superfície pública do pacote — o que o apps/api (ou qualquer outro) importa.
 *
 * Nada aqui tem efeito colateral ao ser importado. Os dois pontos de entrada que
 * têm — src/stdio.ts (conecta no stdin/stdout) e src/http.ts (app.listen) — não
 * são importados por este arquivo e não estão em `exports` do package.json:
 * rodam só como processo, com `node dist/stdio.js` ou `node dist/http.js`.
 */
export { mcpHttpPlugin, type McpHttpPluginOptions } from './http-plugin.js';
export {
  criarServidor,
  DESCRICAO_PERGUNTAR,
  MENSAGEM_FALHA,
  type GetGraph,
  type GraphLike,
} from './server.js';
