import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPage, PageFetchError } from './fetch-page.js';

/** Troca o fetch global por um fake que devolve sempre a mesma resposta. */
function stubFetch(resposta: Response) {
  const fetchFake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => resposta,
  );
  vi.stubGlobal('fetch', fetchFake);
  return fetchFake;
}

function html(corpo: string, status = 200) {
  return new Response(corpo, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPage', () => {
  it('devolve o HTML da página', async () => {
    stubFetch(html('<p>notícia</p>'));

    expect(await fetchPage('https://exemplo.com')).toBe('<p>notícia</p>');
  });

  it('passa um AbortSignal para o fetch, que é o que aplica o timeout', async () => {
    const fetchFake = stubFetch(html('<p>ok</p>'));

    await fetchPage('https://exemplo.com');

    expect(fetchFake.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('lança PageFetchError em resposta HTTP de erro', async () => {
    stubFetch(html('fora do ar', 503));

    await expect(fetchPage('https://exemplo.com')).rejects.toThrow(PageFetchError);
  });

  it('lança PageFetchError quando o conteúdo não é HTML', async () => {
    stubFetch(new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }));

    await expect(fetchPage('https://exemplo.com/release.pdf')).rejects.toThrow(/não é HTML/);
  });
});
