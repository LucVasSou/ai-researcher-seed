import { z } from 'zod';
import { SearchProviderError, type SearchProvider } from './search-provider.js';

const GOOGLE_CUSTOM_SEARCH_URL = 'https://www.googleapis.com/customsearch/v1';

/**
 * Só os campos que usamos. Sem resultado, a resposta não traz `items` — vira lista
 * vazia. `snippet` também pode faltar em alguns itens.
 */
const GoogleCustomSearchResponse = z.object({
  items: z
    .array(
      z.object({
        title: z.string(),
        link: z.string(),
        snippet: z.string().default(''),
      }),
    )
    .default([]),
});

/** `cx` é o ID do mecanismo de busca programável criado no console do Google. */
export function makeGoogleCustomSearchProvider(apiKey: string, cx: string): SearchProvider {
  return {
    async search(query) {
      const url = new URL(GOOGLE_CUSTOM_SEARCH_URL);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('cx', cx);
      url.searchParams.set('q', query);

      const resposta = await fetch(url);
      if (!resposta.ok) {
        throw new SearchProviderError('Google Custom Search', `HTTP ${resposta.status}`);
      }

      const corpo = GoogleCustomSearchResponse.safeParse(await resposta.json());
      if (!corpo.success) {
        throw new SearchProviderError('Google Custom Search', z.prettifyError(corpo.error));
      }

      return corpo.data.items.map((item) => ({
        title: item.title,
        snippet: item.snippet,
        url: item.link,
      }));
    },
  };
}
