import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchProviderError } from './search-provider.js';
import { makeSerperProvider } from './serper.js';

/** Troca o fetch global por um fake que devolve sempre a mesma resposta. */
function stubFetch(corpo: unknown, status = 200) {
  const fetchFake = vi.fn(async () => Response.json(corpo, { status }));
  vi.stubGlobal('fetch', fetchFake);
  return fetchFake;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('makeSerperProvider', () => {
  it('faz POST com a chave no header e a query no corpo', async () => {
    const fetchFake = stubFetch({ organic: [] });

    await makeSerperProvider('chave-teste').search('lucro Petrobras 3T25');

    expect(fetchFake).toHaveBeenCalledWith('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': 'chave-teste', 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'lucro Petrobras 3T25' }),
    });
  });

  it('mapeia organic[] para SearchResult[]', async () => {
    stubFetch({
      organic: [
        {
          title: 'Petrobras lucra R$ 32,8 bi',
          link: 'https://exemplo.com/petrobras',
          snippet: 'Resultado do terceiro trimestre...',
          position: 1,
        },
      ],
    });

    const resultados = await makeSerperProvider('chave-teste').search('qualquer');

    expect(resultados).toEqual([
      {
        title: 'Petrobras lucra R$ 32,8 bi',
        snippet: 'Resultado do terceiro trimestre...',
        url: 'https://exemplo.com/petrobras',
      },
    ]);
  });

  it('devolve lista vazia quando a resposta não traz organic', async () => {
    stubFetch({ searchParameters: { q: 'qualquer' } });

    expect(await makeSerperProvider('chave-teste').search('qualquer')).toEqual([]);
  });

  it('lança SearchProviderError em resposta HTTP de erro', async () => {
    stubFetch({ message: 'Unauthorized' }, 401);

    await expect(makeSerperProvider('chave-errada').search('qualquer')).rejects.toThrow(
      SearchProviderError,
    );
  });
});
