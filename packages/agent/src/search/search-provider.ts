/**
 * Uma busca que demora mais que isso é tratada como falha. Sem esse limite, uma API
 * travada deixaria o fetch esperando para sempre — e o grafo junto.
 */
export const SEARCH_TIMEOUT_MS = 10_000;

/** Um resultado de busca web, no formato comum a todos os provedores. */
export type SearchResult = {
  title: string;
  snippet: string;
  url: string;
};

/**
 * O contrato que o nó `webSearch` conhece. Serper e Google Custom Search são duas
 * implementações dele — trocar de uma para a outra é só mudar SEARCH_PROVIDER.
 */
export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}

/** O provedor respondeu com erro HTTP ou com um corpo fora do formato esperado. */
export class SearchProviderError extends Error {
  constructor(provider: string, detalhe: string) {
    super(`Falha na busca via ${provider}: ${detalhe}`);
    this.name = 'SearchProviderError';
  }
}

/** Variável de ambiente faltando ou SEARCH_PROVIDER com valor desconhecido. */
export class SearchConfigError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'SearchConfigError';
  }
}
