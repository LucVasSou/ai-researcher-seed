import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk-text.js';

describe('chunkText', () => {
  it('devolve o texto inteiro quando ele cabe num chunk só', () => {
    expect(chunkText('curto', 10, 3)).toEqual(['curto']);
  });

  it('devolve lista vazia para texto vazio', () => {
    expect(chunkText('', 10, 3)).toEqual([]);
  });

  it('repete os últimos `overlap` caracteres no início do chunk seguinte', () => {
    const texto = 'abcdefghijklmnopqrst'; // 20 caracteres

    expect(chunkText(texto, 10, 3)).toEqual(['abcdefghij', 'hijklmnopq', 'opqrst']);
  });

  it('não cria um chunk final que já estava inteiro dentro do anterior', () => {
    const texto = 'abcdefghijklmnopq'; // 17: o segundo chunk (7 a 17) já chega no fim

    expect(chunkText(texto, 10, 3)).toEqual(['abcdefghij', 'hijklmnopq']);
  });

  it('usa 1000 caracteres com sobreposição de 100 por padrão', () => {
    const chunks = chunkText('x'.repeat(2500));

    expect(chunks.map((chunk) => chunk.length)).toEqual([1000, 1000, 700]);
  });
});
