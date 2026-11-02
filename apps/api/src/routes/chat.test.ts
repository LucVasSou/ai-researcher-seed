import { describe, expect, it } from 'vitest';
import { build, type ApiGraph } from '../app.js';
import type { GraphChunk } from './chat-event.js';

/**
 * Grafo fake: devolve os chunks dados, na ordem, e anota com o que foi chamado.
 * Com `falhaDepois`, lança erro depois de entregar esse número de chunks.
 * O `invoke` só existe porque o /mcp também é registrado; estes testes não o usam.
 */
function fakeGraph(chunks: GraphChunk[], falhaDepois?: number) {
  const chamadas: { question: string; streamMode: string }[] = [];

  const graph: ApiGraph = {
    invoke: async () => ({ finalAnswer: '' }),
    async stream(input, options) {
      chamadas.push({ question: input.question, streamMode: options.streamMode });
      return (async function* () {
        for (const [i, chunk] of chunks.entries()) {
          if (i === falhaDepois) throw new Error('Vertex fora do ar');
          yield chunk;
        }
      })();
    },
  };

  return { graph, chamadas };
}

/** Lê o corpo SSE e devolve o JSON de cada `data:`. */
function eventos(body: string): unknown[] {
  return body
    .split('\n\n')
    .filter((bloco) => bloco.startsWith('data: '))
    .map((bloco) => JSON.parse(bloco.slice('data: '.length)));
}

const loopCompleto: GraphChunk[] = [
  {
    retrieve: {
      documents: [
        {
          kind: 'cvm',
          ticker: 'PETR',
          period: '3T25',
          sourceUrl: 'https://cvm/zip',
          distance: 0.3,
        },
      ],
    },
  },
  { grade: { sufficient: false, missingAspects: ['motivo da queda'], iterations: 1 } },
  { webSearch: {} },
  {
    retrieve: {
      documents: [
        {
          kind: 'web',
          title: 'Petrobras explica queda',
          sourceUrl: 'https://ex.com',
          distance: 0.1,
        },
      ],
    },
  },
  { grade: { sufficient: true, missingAspects: [], iterations: 1 } },
  { answer: { finalAnswer: 'O lucro caiu por causa do Brent [1].\n\nFontes: ...' } },
];

function post(app: ReturnType<typeof build>, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/chat', payload });
}

describe('POST /api/chat', () => {
  it('responde como SSE, com os headers que evitam buffering no Cloud Run', async () => {
    const app = build({ getGraph: () => fakeGraph([]).graph });

    const response = await post(app, { question: 'Qual a receita da PETR?' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache, no-transform');
    expect(response.headers['connection']).toBe('keep-alive');
  });

  it('chama o grafo com a pergunta validada, em streamMode updates', async () => {
    const { graph, chamadas } = fakeGraph([]);
    const app = build({ getGraph: () => graph });

    await post(app, { question: '  Qual a receita da PETR?  ' });

    expect(chamadas).toEqual([{ question: 'Qual a receita da PETR?', streamMode: 'updates' }]);
  });

  it('emite um evento por nó concluído, traduzido para o formato do cliente', async () => {
    const app = build({ getGraph: () => fakeGraph(loopCompleto).graph });

    const response = await post(app, { question: 'Por que o lucro da PETR caiu?' });

    expect(eventos(response.body)).toEqual([
      {
        type: 'retrieve',
        documents: [
          {
            kind: 'cvm',
            ticker: 'PETR',
            period: '3T25',
            sourceUrl: 'https://cvm/zip',
            distance: 0.3,
          },
        ],
      },
      { type: 'grade', sufficient: false, missingAspects: ['motivo da queda'], iterations: 1 },
      { type: 'webSearch' },
      {
        type: 'retrieve',
        documents: [
          {
            kind: 'web',
            title: 'Petrobras explica queda',
            sourceUrl: 'https://ex.com',
            distance: 0.1,
          },
        ],
      },
      // O update do grade traz o incremento (1); o evento traz o total.
      { type: 'grade', sufficient: true, missingAspects: [], iterations: 2 },
      { type: 'answer', answer: 'O lucro caiu por causa do Brent [1].\n\nFontes: ...' },
    ]);
  });

  it('não manda o texto dos documentos no evento do retrieve, só o resumo', async () => {
    const comTexto = {
      retrieve: {
        documents: [
          {
            kind: 'cvm' as const,
            ticker: 'PETR',
            period: '3T25',
            sourceUrl: 'https://cvm/zip',
            distance: 0.3,
            paragraph: 'parágrafo longo...',
          },
        ],
      },
    };
    const app = build({ getGraph: () => fakeGraph([comTexto]).graph });

    const response = await post(app, { question: 'q' });

    expect(response.body).not.toContain('parágrafo longo');
  });

  it('escreve um evento de erro e encerra quando o grafo falha no meio do stream', async () => {
    const app = build({ getGraph: () => fakeGraph(loopCompleto, 2).graph });

    const response = await post(app, { question: 'Por que o lucro da PETR caiu?' });

    const recebidos = eventos(response.body);
    expect(recebidos.map((evento) => (evento as { type: string }).type)).toEqual([
      'retrieve',
      'grade',
      'error',
    ]);
    expect(recebidos.at(-1)).toEqual({
      type: 'error',
      message: 'Não foi possível concluir a pesquisa.',
    });
    // O detalhe interno do erro fica no log, não vai para o cliente.
    expect(response.body).not.toContain('Vertex fora do ar');
  });

  it('escreve um evento de erro quando nem a construção do grafo dá certo', async () => {
    const app = build({
      getGraph: () => {
        throw new Error('DATABASE_URL não definida.');
      },
    });

    const response = await post(app, { question: 'Lucro da Vale?' });

    expect(eventos(response.body)).toEqual([
      { type: 'error', message: 'Não foi possível concluir a pesquisa.' },
    ]);
    expect(response.body).not.toContain('DATABASE_URL');
  });

  it('continua atendendo depois de um grafo que falhou — o processo não cai', async () => {
    const app = build({
      getGraph: () => fakeGraph(loopCompleto, 0).graph,
      checkDatabase: async () => true,
    });

    await post(app, { question: 'q' });
    const health = await app.inject({ method: 'GET', url: '/api/health' });

    expect(health.statusCode).toBe(200);
  });

  it('responde 400 em problem+json quando a pergunta é inválida, sem chamar o grafo', async () => {
    const { graph, chamadas } = fakeGraph([]);
    const app = build({ getGraph: () => graph });

    const response = await post(app, { question: '' });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ title: 'Bad Request', status: 400 });
    expect(chamadas).toEqual([]);
  });

  it('responde 400 em problem+json quando o corpo nem é JSON válido', async () => {
    const { graph, chamadas } = fakeGraph([]);
    const app = build({ getGraph: () => graph });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'content-type': 'application/json' },
      payload: '{"question": ',
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(chamadas).toEqual([]);
  });

  it('não registra a rota quando o build não recebe grafo', async () => {
    const app = build({ checkDatabase: async () => true });

    const response = await post(app, { question: 'q' });

    expect(response.statusCode).toBe(404);
  });
});
