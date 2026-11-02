import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildQueries } from '../nodes/web-search.js';
import { escolherFixture, makeDemoSearchProvider } from './demo-search-provider.js';
import { FIXTURE_GENERICA } from './fixtures.js';

const DATASET = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../evals/dataset.json',
);

/** As perguntas reais do dataset de avaliação — se o texto mudar lá, o teste acompanha. */
function pergunta(id: string): string {
  const dataset = JSON.parse(readFileSync(DATASET, 'utf8')) as { id: string; pergunta: string }[];
  const item = dataset.find((p) => p.id === id);
  if (!item) throw new Error(`Pergunta ${id} não encontrada em evals/dataset.json`);
  return item.pergunta;
}

describe('escolherFixture', () => {
  it.each([
    ['B01', 'https://demo.invalid/vale/'],
    ['B02', 'https://demo.invalid/vale/'],
    ['B03', 'https://demo.invalid/petrobras/'],
    ['B05', 'https://demo.invalid/klabin/'],
  ])('a pergunta %s do dataset cai na fixture da empresa', (id, prefixoUrl) => {
    const fixture = escolherFixture(pergunta(id));
    expect(fixture.paginas[0].url.startsWith(prefixoUrl)).toBe(true);
  });

  it('casa também nas queries que o webSearch monta com os aspectos do grade', () => {
    const [query] = buildQueries(pergunta('B05'), ['variação cambial dívida 1T26']);
    expect(escolherFixture(query).paginas[0].url).toContain('/klabin/');
  });

  it('casa pelo ticker, sem diferenciar maiúscula de minúscula', () => {
    expect(escolherFixture('resultado petr4').paginas[0].url).toContain('/petrobras/');
    expect(escolherFixture('KLABIN prejuízo').paginas[0].url).toContain('/klabin/');
  });

  it('pergunta sem fixture cadastrada cai na genérica', () => {
    // B04 (Totvs) fica de fora de propósito: é o exemplo de pergunta fora do roteiro.
    expect(escolherFixture(pergunta('B04'))).toBe(FIXTURE_GENERICA);
    expect(escolherFixture('')).toBe(FIXTURE_GENERICA);
  });
});

describe('makeDemoSearchProvider', () => {
  it('devolve as páginas da fixture no formato SearchResult', async () => {
    const resultados = await makeDemoSearchProvider().search(pergunta('B03'));

    expect(resultados).toEqual([
      {
        title: '[DEMO] Petrobras: onde acompanhar os fatos relevantes',
        snippet: expect.any(String),
        url: 'https://demo.invalid/petrobras/fatos-relevantes',
      },
    ]);
  });

  it('nunca lança erro para pergunta desconhecida', async () => {
    const resultados = await makeDemoSearchProvider().search('qual a cotação do bitcoin?');
    expect(resultados.map((r) => r.url)).toEqual(['https://demo.invalid/sem-fixture']);
  });
});
