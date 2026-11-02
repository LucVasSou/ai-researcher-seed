import { describe, expect, it, vi } from 'vitest';
import { build, type ApiGraph } from '../app.js';

/** Um grafo fake que anota quem o usou: o /chat chama `stream`, o /mcp chama `invoke`. */
function fakeGraph() {
  const usos: string[] = [];
  const graph: ApiGraph = {
    async invoke(input) {
      usos.push(`invoke: ${input.question}`);
      return { finalAnswer: 'A Klabin teve prejuízo de R$ 0,5 bi no 1T26 [1].' };
    },
    async stream(input) {
      usos.push(`stream: ${input.question}`);
      return (async function* () {
        yield { answer: { finalAnswer: 'resposta' } };
      })();
    },
  };
  return { graph, usos };
}

function chamarMcp(app: ReturnType<typeof build>, pergunta: string) {
  return app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    payload: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'perguntar', arguments: { pergunta } },
    },
  });
}

describe('POST /api/mcp (gateway MCP no apps/api)', () => {
  it('responde a tool perguntar na mesma porta e prefixo do /api/chat', async () => {
    const { graph } = fakeGraph();
    const app = build({ getGraph: () => graph });

    const response = await chamarMcp(app, 'O que motivou o prejuízo da Klabin no 1T26?');

    expect(response.statusCode).toBe(200);
    expect(response.json().result.content[0].text).toBe(
      'A Klabin teve prejuízo de R$ 0,5 bi no 1T26 [1].',
    );
  });

  it('/chat e /mcp usam a mesma instância do grafo', async () => {
    const { graph, usos } = fakeGraph();
    const getGraph = vi.fn(() => graph);
    const app = build({ getGraph });

    await app.inject({ method: 'POST', url: '/api/chat', payload: { question: 'pelo chat' } });
    await chamarMcp(app, 'pelo mcp');

    // As duas rotas chamaram o mesmo getGraph e receberam o mesmo objeto…
    expect(getGraph).toHaveBeenCalledTimes(2);
    expect(getGraph.mock.results.map((r) => r.value)).toEqual([graph, graph]);
    // …e as duas perguntas passaram por ele.
    expect(usos).toEqual(['stream: pelo chat', 'invoke: pelo mcp']);
  });

  it('responde 405 a GET, com o mesmo prefixo /api', async () => {
    const app = build({ getGraph: () => fakeGraph().graph });

    const response = await app.inject({ method: 'GET', url: '/api/mcp' });

    expect(response.statusCode).toBe(405);
  });

  it('não registra o gateway quando o build não recebe getGraph', async () => {
    const app = build({ checkDatabase: async () => true });

    const response = await chamarMcp(app, 'qualquer');

    expect(response.statusCode).toBe(404);
  });
});
