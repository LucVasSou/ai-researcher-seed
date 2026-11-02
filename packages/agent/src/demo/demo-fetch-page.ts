import { FIXTURE_GENERICA, FIXTURES_DEMO } from './fixtures.js';

/**
 * `fetchPage` do modo DEMO=true: devolve o HTML da fixture com essa URL, sem rede.
 * URL desconhecida recebe a página genérica — nunca lança erro.
 */
export async function demoFetchPage(url: string): Promise<string> {
  const pagina = FIXTURES_DEMO.flatMap((f) => f.paginas).find((p) => p.url === url);
  return (pagina ?? FIXTURE_GENERICA.paginas[0]).html;
}
