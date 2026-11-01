/** Uma página que demora mais que isso é tratada como fora do ar. */
export const PAGE_TIMEOUT_MS = 10_000;

/** A página não pôde ser usada: erro HTTP, timeout ou conteúdo que não é HTML. */
export class PageFetchError extends Error {
  constructor(url: string, detalhe: string) {
    super(`Não foi possível ler ${url}: ${detalhe}`);
    this.name = 'PageFetchError';
  }
}

/**
 * Baixa o HTML de uma URL. PDF, imagem e afins são rejeitados: o extrator de
 * texto só sabe lidar com HTML.
 *
 * O timeout chega como `AbortSignal.timeout`: passado o prazo, o fetch é
 * cancelado e rejeita com `TimeoutError`.
 */
export async function fetchPage(url: string): Promise<string> {
  const resposta = await fetch(url, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  if (!resposta.ok) {
    throw new PageFetchError(url, `HTTP ${resposta.status}`);
  }

  const contentType = resposta.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) {
    throw new PageFetchError(url, `conteúdo não é HTML (${contentType || 'sem content-type'})`);
  }

  return resposta.text();
}
