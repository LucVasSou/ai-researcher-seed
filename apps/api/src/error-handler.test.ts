import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CircuitoAbertoError } from '@hero/agent/search';
import { problemDetailsSchema } from '@hero/contracts';
import { build } from './app.js';

/**
 * Monta a API de verdade (com o error handler registrado no `build`) e acrescenta
 * uma rota de teste que só lança o erro dado — o que interessa é a resposta.
 */
async function respostaPara(erro: () => never) {
  const app = build({ checkDatabase: async () => true });
  app.get('/teste/erro', async () => erro());

  const response = await app.inject({ method: 'GET', url: '/teste/erro' });
  return { response, corpo: problemDetailsSchema.parse(response.json()) };
}

describe('error handler', () => {
  it('ZodError vira 400, com as mensagens do zod no detail', async () => {
    const { response, corpo } = await respostaPara(() => {
      z.object({ question: z.string().min(1, 'A pergunta não pode ser vazia.') }).parse({
        question: '',
      });
      throw new Error('inalcançável');
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(corpo).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'A pergunta não pode ser vazia.',
    });
  });

  it('CircuitoAbertoError vira 503', async () => {
    const { response, corpo } = await respostaPara(() => {
      throw new CircuitoAbertoError(30_000);
    });

    expect(response.statusCode).toBe(503);
    expect(corpo).toMatchObject({ title: 'Service Unavailable', status: 503 });
  });

  it('qualquer outro erro vira 500 genérico, sem vazar mensagem nem stack', async () => {
    const { response, corpo } = await respostaPara(() => {
      throw new Error('falha em postgres://usuario:senha@10.0.0.5/hero');
    });

    expect(response.statusCode).toBe(500);
    expect(corpo).toMatchObject({ title: 'Internal Server Error', status: 500 });
    expect(response.body).not.toContain('postgres://');
    expect(response.body).not.toContain('senha');
    expect(response.body).not.toContain('error-handler.test.ts');
    // só os quatro campos da RFC, nada a mais (nem `stack`, nem `message`)
    expect(Object.keys(response.json()).sort()).toEqual(['detail', 'status', 'title', 'type']);
  });
});
