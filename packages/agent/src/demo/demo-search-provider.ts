import type { SearchProvider } from '../search/search-provider.js';
import { FIXTURE_GENERICA, FIXTURES_DEMO, type FixtureDemo } from './fixtures.js';

/**
 * A primeira fixture com algum termo contido na query; sem nenhuma, a genérica.
 * Comparação sem diferenciar maiúscula de minúscula, por substring — "vale3",
 * "VALE3" e "receita da Vale" casam com a mesma fixture.
 */
export function escolherFixture(query: string): FixtureDemo {
  const queryMinuscula = query.toLowerCase();
  const fixture = FIXTURES_DEMO.find((f) =>
    f.termos.some((termo) => queryMinuscula.includes(termo.toLowerCase())),
  );
  return fixture ?? FIXTURE_GENERICA;
}

/** Provedor de busca do modo DEMO=true: responde das fixtures, sem rede. */
export function makeDemoSearchProvider(): SearchProvider {
  return {
    async search(query) {
      return escolherFixture(query).paginas.map(({ title, snippet, url }) => ({
        title,
        snippet,
        url,
      }));
    },
  };
}
