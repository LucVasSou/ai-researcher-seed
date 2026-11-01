import { describe, expect, it } from 'vitest';
import { chatRequestSchema } from './chat.js';

describe('chatRequestSchema', () => {
  it('aceita uma pergunta e remove espaços das pontas', () => {
    expect(chatRequestSchema.parse({ question: '  Qual a receita da PETR?  ' })).toEqual({
      question: 'Qual a receita da PETR?',
    });
  });

  it('rejeita pergunta vazia ou só com espaços', () => {
    expect(() => chatRequestSchema.parse({ question: '   ' })).toThrow();
  });

  it('rejeita pergunta acima de 1000 caracteres', () => {
    expect(() => chatRequestSchema.parse({ question: 'x'.repeat(1001) })).toThrow();
  });

  it('rejeita corpo sem question', () => {
    expect(() => chatRequestSchema.parse({})).toThrow();
  });
});
