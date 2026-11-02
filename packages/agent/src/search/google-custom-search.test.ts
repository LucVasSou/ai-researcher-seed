import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeGoogleCustomSearchProvider } from './google-custom-search.js';
import { SEARCH_TIMEOUT_MS, SearchProviderError } from './search-provider.js';

/** Troca o fetch global por um fake que devolve sempre a mesma resposta. */
function stubFetch(corpo: unknown, status = 200) {
  const fetchFake = vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>(async () =>
    Response.json(corpo, { status }),
  );
  vi.stubGlobal('fetch', fetchFake);
  return fetchFake;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('makeGoogleCustomSearchProvider', () => {
  it('faz GET com key, cx e q como query params', async () => {
    const fetchFake = stubFetch({});

    await makeGoogleCustomSearchProvider('chave-teste', 'cx-teste').search('lucro Petrobras 3T25');

    const url = fetchFake.mock.calls[0][0];
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/customsearch/v1');
    expect(url.searchParams.get('key')).toBe('chave-teste');
    expect(url.searchParams.get('cx')).toBe('cx-teste');
    expect(url.searchParams.get('q')).toBe('lucro Petrobras 3T25');
  });

  it('passa ao fetch um AbortSignal de 10 segundos, que é o que aplica o timeout', async () => {
    const fetchFake = stubFetch({});
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await makeGoogleCustomSearchProvider('chave-teste', 'cx-teste').search('qualquer');

    expect(timeout).toHaveBeenCalledWith(SEARCH_TIMEOUT_MS);
    expect(fetchFake.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('mapeia items[] para SearchResult[]', async () => {
    stubFetch({
      items: [
        {
          title: 'Petrobras lucra R$ 32,8 bi',
          link: 'https://exemplo.com/petrobras',
          snippet: 'Resultado do terceiro trimestre...',
          displayLink: 'exemplo.com',
        },
      ],
    });

    const resultados = await makeGoogleCustomSearchProvider('chave-teste', 'cx-teste').search(
      'qualquer',
    );

    expect(resultados).toEqual([
      {
        title: 'Petrobras lucra R$ 32,8 bi',
        snippet: 'Resultado do terceiro trimestre...',
        url: 'https://exemplo.com/petrobras',
      },
    ]);
  });

  it('devolve lista vazia quando a resposta não traz items (busca sem resultado)', async () => {
    stubFetch({ searchInformation: { totalResults: '0' } });

    expect(await makeGoogleCustomSearchProvider('k', 'cx').search('qualquer')).toEqual([]);
  });

  it('lança SearchProviderError em resposta HTTP de erro', async () => {
    stubFetch({ error: { code: 403 } }, 403);

    await expect(makeGoogleCustomSearchProvider('k', 'cx').search('qualquer')).rejects.toThrow(
      SearchProviderError,
    );
  });
});
