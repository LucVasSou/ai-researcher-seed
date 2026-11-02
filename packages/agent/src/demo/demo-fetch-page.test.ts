import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractText } from '../web/extract-text.js';
import { demoFetchPage } from './demo-fetch-page.js';
import { FIXTURE_GENERICA, FIXTURES_DEMO } from './fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('demoFetchPage', () => {
  it('toda URL que a busca demo devolve tem página cadastrada com texto', async () => {
    const paginas = [...FIXTURES_DEMO, FIXTURE_GENERICA].flatMap((f) => f.paginas);

    for (const { url, html } of paginas) {
      const baixado = await demoFetchPage(url);
      expect(baixado).toBe(html);
      expect(extractText(baixado).length).toBeGreaterThan(0);
    }
  });

  it('URL desconhecida recebe a página genérica, sem lançar erro', async () => {
    expect(await demoFetchPage('https://exemplo.com/qualquer')).toBe(
      FIXTURE_GENERICA.paginas[0].html,
    );
  });

  it('não acessa a rede', async () => {
    const fetchFake = vi.fn();
    vi.stubGlobal('fetch', fetchFake);

    await demoFetchPage('https://demo.invalid/vale/guidance-producao-minerio');

    expect(fetchFake).not.toHaveBeenCalled();
  });
});
