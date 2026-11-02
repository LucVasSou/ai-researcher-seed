import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { criarServidor, type GetGraph } from './server.js';

export interface McpHttpPluginOptions {
  getGraph: GetGraph;
}

/** Erro no formato JSON-RPC, que é o que um cliente MCP sabe ler. */
function erroJsonRpc(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

/**
 * Sem sessão, não há stream de notificações para abrir (GET) nem sessão para
 * encerrar (DELETE). A especificação manda responder 405 nos dois.
 */
async function metodoNaoPermitido(_request: unknown, reply: FastifyReply) {
  return reply
    .code(405)
    .header('Allow', 'POST')
    .send(erroJsonRpc(-32000, 'Método não permitido: este servidor MCP é stateless.'));
}

/**
 * A tool `perguntar` exposta via Streamable HTTP, em `POST /mcp` (relativo ao
 * prefixo de quem registra o plugin). É o mesmo plugin no servidor standalone
 * (porta própria, src/http.ts) e no apps/api (gateway em /api/mcp).
 *
 * **Stateless:** nenhuma sessão fica em memória entre chamadas. Cada requisição
 * ganha um McpServer e um transporte novos, que morrem quando a resposta fecha —
 * é o que o SDK recomenda para o modo sem sessão, para dois clientes nunca
 * dividirem o mesmo estado de protocolo. O que dura entre requisições é o grafo,
 * que vem do `getGraph`.
 *
 * **Resposta em JSON, não SSE:** a tool devolve um resultado só, no fim. Com
 * `enableJsonResponse`, cada POST recebe um corpo JSON comum — que passa sem
 * surpresa pelo proxy do Angular, pelo nginx e pelo Firebase Hosting.
 */
export const mcpHttpPlugin: FastifyPluginAsync<McpHttpPluginOptions> = async (
  app,
  { getGraph },
) => {
  app.post('/mcp', async (request, reply) => {
    const server = criarServidor(getGraph);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    // O transporte do SDK escreve direto na resposta do Node; o hijack avisa o
    // Fastify para não tentar enviar uma resposta própria depois.
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      // O Fastify já leu e parseou o corpo; o transporte recebe o JSON pronto.
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (erro) {
      request.log.error(erro, 'falha no transporte MCP');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify(erroJsonRpc(-32603, 'Erro interno do servidor MCP.')));
      }
    }
  });

  app.get('/mcp', metodoNaoPermitido);
  app.delete('/mcp', metodoNaoPermitido);
};
