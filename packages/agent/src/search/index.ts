import { makeGoogleCustomSearchProvider } from './google-custom-search.js';
import { SearchConfigError, type SearchProvider } from './search-provider.js';
import { makeSerperProvider } from './serper.js';

export {
  SearchConfigError,
  SearchProviderError,
  type SearchProvider,
  type SearchResult,
} from './search-provider.js';

function exigirVariavel(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new SearchConfigError(`${nome} não definida.`);
  }
  return valor;
}

/**
 * Escolhe o provedor de busca pela variável SEARCH_PROVIDER (padrão: serper)
 * e confere, antes de qualquer busca, que as chaves dele estão definidas.
 *
 * - serper: SERPER_API_KEY
 * - google: GOOGLE_CUSTOM_SEARCH_API_KEY e GOOGLE_CUSTOM_SEARCH_CX
 */
export function criarSearchProvider(): SearchProvider {
  const provider = process.env.SEARCH_PROVIDER || 'serper';

  if (provider === 'serper') {
    return makeSerperProvider(exigirVariavel('SERPER_API_KEY'));
  }

  if (provider === 'google') {
    return makeGoogleCustomSearchProvider(
      exigirVariavel('GOOGLE_CUSTOM_SEARCH_API_KEY'),
      exigirVariavel('GOOGLE_CUSTOM_SEARCH_CX'),
    );
  }

  throw new SearchConfigError(
    `SEARCH_PROVIDER desconhecido: "${provider}". Valores aceitos: serper, google.`,
  );
}
