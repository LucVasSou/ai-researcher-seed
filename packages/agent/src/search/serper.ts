import { z } from 'zod';
import { SEARCH_TIMEOUT_MS, SearchProviderError, type SearchProvider } from './search-provider.js';

const SERPER_URL = 'https://google.serper.dev/search';

/**
 * Só os campos que usamos. `organic` some quando não há resultado, e alguns
 * resultados vêm sem `snippet` — os dois casos viram valor vazio, não erro.
 */
const SerperResponse = z.object({
  organic: z
    .array(
      z.object({
        title: z.string(),
        link: z.string(),
        snippet: z.string().default(''),
      }),
    )
    .default([]),
});

export function makeSerperProvider(apiKey: string): SearchProvider {
  return {
    async search(query) {
      const resposta = await fetch(SERPER_URL, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      if (!resposta.ok) {
        throw new SearchProviderError('Serper', `HTTP ${resposta.status}`);
      }

      const corpo = SerperResponse.safeParse(await resposta.json());
      if (!corpo.success) {
        throw new SearchProviderError('Serper', z.prettifyError(corpo.error));
      }

      return corpo.data.organic.map((item) => ({
        title: item.title,
        snippet: item.snippet,
        url: item.link,
      }));
    },
  };
}
