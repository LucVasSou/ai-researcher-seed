import type { ServerResponse } from 'node:http';
import type { FastifyPluginAsync } from 'fastify';
import { chatRequestSchema } from '@hero/contracts';
import { toChatEvents, type ChatEvent, type GraphChunk } from './chat-event.js';

/**
 * Tempo máximo de uma pergunta, do retrieve ao answer. Passado isso o grafo é
 * cancelado e o cliente recebe um evento de erro.
 */
const GRAPH_TIMEOUT_MS = 60_000;

/**
 * O mínimo do grafo que a rota usa: o `stream`. O grafo compilado do LangGraph
 * satisfaz esta interface; no teste, um fake de poucas linhas também.
 */
export interface GraphLike {
  stream(
    input: { question: string },
    options: { streamMode: 'updates'; signal: AbortSignal },
  ): Promise<AsyncIterable<GraphChunk>>;
}

export interface ChatRouteOptions {
  graph: GraphLike;
}

function writeEvent(raw: ServerResponse, event: ChatEvent): void {
  raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

const chatRoute: FastifyPluginAsync<ChatRouteOptions> = async (app, { graph }) => {
  app.post('/chat', async (request, reply) => {
    // Pergunta inválida lança ZodError, e o error handler central responde 400.
    const { question } = chatRequestSchema.parse(request.body);

    // Daqui em diante a rota escreve direto no socket: o hijack avisa o Fastify
    // para não tentar enviar uma resposta própria depois.
    reply.hijack();
    const raw = reply.raw;

    // Headers escritos à mão. `no-transform` é o que impede o Cloud Run de
    // bufferizar a resposta inteira em vez de entregar evento a evento.
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    // Se o cliente fecha a conexão antes do fim, o grafo para — senão as
    // chamadas de LLM seguiriam gastando para ninguém.
    const clienteDesconectou = new AbortController();
    raw.on('close', () => {
      if (!raw.writableEnded) clienteDesconectou.abort();
    });
    const signal = AbortSignal.any([
      clienteDesconectou.signal,
      AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    ]);

    let iterations = 0;
    try {
      const stream = await graph.stream({ question }, { streamMode: 'updates', signal });

      for await (const chunk of stream) {
        for (const event of toChatEvents(chunk, iterations)) {
          if (event.type === 'grade') iterations = event.iterations;
          writeEvent(raw, event);
        }
      }
    } catch (error) {
      // Este é o único catch de rota que fica, e não por escolha: depois do
      // hijack o status 200 e os headers do SSE já foram enviados, e o error
      // handler central não tem mais como responder. O erro vira evento para o
      // cliente e log para nós. O detalhe interno não vai para o cliente, e nada
      // é relançado: um grafo que falha não derruba o processo.
      request.log.error(error, 'falha ao executar o grafo');
      if (!raw.destroyed) {
        writeEvent(raw, { type: 'error', message: 'Não foi possível concluir a pesquisa.' });
      }
    } finally {
      raw.end();
    }
  });
};

export default chatRoute;
