import { describe, expect, it, vi } from 'vitest';

// Se algum arquivo importado a partir do index carregar um ponto de entrada, o
// mock anota — e o teste falha. Os mocks não fazem nada além de anotar.
const carregados = vi.hoisted(() => [] as string[]);

vi.mock('./stdio.js', () => {
  carregados.push('stdio');
  return {};
});
vi.mock('./http.js', () => {
  carregados.push('http');
  return {};
});

describe('index (a superfície pública do pacote)', () => {
  it('importar como biblioteca não carrega o bootstrap do stdio nem o listen do HTTP', async () => {
    const pacote = await import('./index.js');

    expect(carregados).toEqual([]);
    expect(Object.keys(pacote).sort()).toEqual([
      'DESCRICAO_PERGUNTAR',
      'MENSAGEM_FALHA',
      'criarServidor',
      'mcpHttpPlugin',
    ]);
  });
});
