import { demoFetchPage } from '../demo/demo-fetch-page.js';
import { fetchPage } from './fetch-page.js';

/**
 * Escolhe como o `webSearch` baixa páginas: com DEMO=true, das fixtures de
 * src/demo; senão, da web de verdade. É o único lugar que lê DEMO para o fetch de
 * página — o `fetchPage` real não sabe que o modo demo existe.
 */
export function criarFetchPage(): (url: string) => Promise<string> {
  if (process.env.DEMO === 'true') {
    return demoFetchPage;
  }
  return fetchPage;
}
