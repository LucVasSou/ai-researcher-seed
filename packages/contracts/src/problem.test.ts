import { describe, expect, it } from 'vitest';
import { problemDetailsSchema } from './problem.js';

describe('problemDetailsSchema', () => {
  it('aceita um problema com type, title, status e detail', () => {
    expect(() =>
      problemDetailsSchema.parse({
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'A pergunta não pode ser vazia.',
      }),
    ).not.toThrow();
  });

  it('rejeita status fora da faixa de erro HTTP', () => {
    expect(() =>
      problemDetailsSchema.parse({ type: 'about:blank', title: 'OK', status: 200, detail: '' }),
    ).toThrow();
  });

  it('rejeita problema sem detail', () => {
    expect(() =>
      problemDetailsSchema.parse({ type: 'about:blank', title: 'Bad Request', status: 400 }),
    ).toThrow();
  });
});
