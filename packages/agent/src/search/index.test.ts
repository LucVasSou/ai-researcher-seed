import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarSearchProvider, SearchConfigError } from './index.js';

/** A fábrica não chama a rede, mas o provedor criado sim — o fetch fake confirma qual foi. */
function stubFetch() {
  const fetchFake = vi.fn<(url: string | URL) => Promise<Response>>(async () => Response.json({}));
  vi.stubGlobal('fetch', fetchFake);
  return fetchFake;
}

/** Zera todas as variáveis que a fábrica lê, para o ambiente da máquina não vazar no teste. */
function limparAmbiente() {
  vi.stubEnv('SEARCH_PROVIDER', '');
  vi.stubEnv('SERPER_API_KEY', '');
  vi.stubEnv('GOOGLE_CUSTOM_SEARCH_API_KEY', '');
  vi.stubEnv('GOOGLE_CUSTOM_SEARCH_CX', '');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('criarSearchProvider', () => {
  it('usa Serper quando SEARCH_PROVIDER não está definida', async () => {
    limparAmbiente();
    vi.stubEnv('SERPER_API_KEY', 'chave-serper');
    const fetchFake = stubFetch();

    await criarSearchProvider().search('qualquer');

    expect(fetchFake.mock.calls[0][0]).toBe('https://google.serper.dev/search');
  });

  it('usa Google Custom Search quando SEARCH_PROVIDER=google', async () => {
    limparAmbiente();
    vi.stubEnv('SEARCH_PROVIDER', 'google');
    vi.stubEnv('GOOGLE_CUSTOM_SEARCH_API_KEY', 'chave-google');
    vi.stubEnv('GOOGLE_CUSTOM_SEARCH_CX', 'cx-google');
    const fetchFake = stubFetch();

    await criarSearchProvider().search('qualquer');

    expect(String(fetchFake.mock.calls[0][0])).toContain('googleapis.com/customsearch/v1');
  });

  it('lança SearchConfigError citando SERPER_API_KEY quando ela falta', () => {
    limparAmbiente();

    expect(() => criarSearchProvider()).toThrow(SearchConfigError);
    expect(() => criarSearchProvider()).toThrow(/SERPER_API_KEY/);
  });

  it('lança SearchConfigError citando GOOGLE_CUSTOM_SEARCH_CX quando só ela falta', () => {
    limparAmbiente();
    vi.stubEnv('SEARCH_PROVIDER', 'google');
    vi.stubEnv('GOOGLE_CUSTOM_SEARCH_API_KEY', 'chave-google');

    expect(() => criarSearchProvider()).toThrow(/GOOGLE_CUSTOM_SEARCH_CX/);
  });

  it('lança SearchConfigError para provedor desconhecido', () => {
    limparAmbiente();
    vi.stubEnv('SEARCH_PROVIDER', 'bing');

    expect(() => criarSearchProvider()).toThrow(SearchConfigError);
    expect(() => criarSearchProvider()).toThrow(/bing/);
  });
});
