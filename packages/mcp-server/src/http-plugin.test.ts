import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { mcpHttpPlugin } from './http-plugin.js';
import type { GetGraph, GraphLike } from './server.js';

/** O Streamable HTTP exige que o cliente aceite os dois formatos de resposta. */
const HEADERS_MCP = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

function appCom(getGraph: GetGraph) {
  const app = Fastify();
  app.register(mcpHttpPlugin, { getGraph });
  return app;
}

function fakeGraph(finalAnswer: string) {
  const perguntas: string[] = [];
  const graph: GraphLike = {
    async invoke(input) {
      perguntas.push(input.question);
      return { finalAnswer };
    },
  };
  return { graph, perguntas };
}

function chamarPerguntar(app: ReturnType<typeof appCom>, pergunta: string, id = 1) {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: HEADERS_MCP,
    payload: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'perguntar', arguments: { pergunta } },
    },
  });
}

describe('mcpHttpPlugin', () => {
  it('responde ao initialize com os dados do servidor', async () => {
    const app = appCom(() => fakeGraph('').graph);

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: HEADERS_MCP,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'teste', version: '0' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.serverInfo.name).toBe('ai-researcher');
  });

  it('roda a tool perguntar e devolve o resultado em JSON, não em SSE', async () => {
    const { graph, perguntas } = fakeGraph('A Vale teve receita de R$ 56,7 bi no 3T25 [1].');
    const app = appCom(() => graph);

    const response = await chamarPerguntar(app, 'Receita da Vale no 3T25?');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({
      id: 1,
      result: {
        content: [{ type: 'text', text: 'A Vale teve receita de R$ 56,7 bi no 3T25 [1].' }],
      },
    });
    expect(perguntas).toEqual(['Receita da Vale no 3T25?']);
  });

  it('é stateless: não devolve id de sessão, e chamadas seguidas funcionam sem initialize', async () => {
    const getGraph = vi.fn(() => fakeGraph('resposta').graph);
    const app = appCom(getGraph);

    const primeira = await chamarPerguntar(app, 'Lucro da Klabin?', 1);
    const segunda = await chamarPerguntar(app, 'Lucro da Suzano?', 2);

    expect(primeira.headers['mcp-session-id']).toBeUndefined();
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().id).toBe(2);
    expect(getGraph).toHaveBeenCalledTimes(2);
  });

  it.each(['GET', 'DELETE'] as const)('responde 405 a %s, com Allow: POST', async (method) => {
    const app = appCom(() => fakeGraph('').graph);

    const response = await app.inject({ method, url: '/mcp' });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('POST');
    expect(response.json().error.code).toBe(-32000);
  });

  it('não sobe o grafo para responder ao tools/list', async () => {
    const getGraph = vi.fn(() => fakeGraph('').graph);
    const app = appCom(getGraph);

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: HEADERS_MCP,
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });

    expect(response.json().result.tools.map((t: { name: string }) => t.name)).toEqual([
      'perguntar',
    ]);
    expect(getGraph).not.toHaveBeenCalled();
  });
});
