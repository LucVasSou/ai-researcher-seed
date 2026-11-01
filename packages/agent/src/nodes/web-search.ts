import type { Embeddings } from '@langchain/core/embeddings';
import type { NewWebDocument } from '../db/save-web-documents.js';
import type { SearchProvider, SearchResult } from '../search/index.js';
import { chunkText } from '../web/chunk-text.js';
import { extractText } from '../web/extract-text.js';

/** Quantos resultados de cada busca viram páginas baixadas. */
export const RESULTS_PER_QUERY = 3;

/** Por quantos dias uma página gravada continua valendo para o retrieve. */
export const DEFAULT_TTL_DAYS = 7;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

type WebSearchDeps = {
  searchProvider: SearchProvider;
  /** Em produção é o `fetchPage` de web/fetch-page.ts; no teste, um fake. */
  fetchPage: (url: string) => Promise<string>;
  embeddings: Embeddings;
  /** Em produção é o `saveWebDocuments` com o `db` já amarrado. */
  saveWebDocuments: (docs: NewWebDocument[]) => Promise<void>;
  ttlDays?: number;
  /** Relógio injetável, para o teste conferir o `expiresAt` com data fixa. */
  now?: () => Date;
};

type WebSearchState = {
  question: string;
  missingAspects: string[];
};

/** Uma busca por aspecto faltante. Sem aspectos, busca a pergunta como veio. */
export function buildQueries(question: string, missingAspects: string[]): string[] {
  if (missingAspects.length === 0) {
    return [question];
  }
  return missingAspects.map((aspecto) => `${question} ${aspecto}`);
}

/**
 * Cria o nó `webSearch`: busca na web o que o `grade` disse que falta, baixa as
 * páginas, quebra em chunks e grava cada chunk com seu embedding em documentos_web.
 *
 * O nó não devolve documentos para o estado. Quem os traz de volta é o `retrieve`
 * na próxima volta do loop — o mesmo caminho de qualquer documento, ordenado pela
 * mesma distância.
 */
export function makeWebSearchNode({
  searchProvider,
  fetchPage,
  embeddings,
  saveWebDocuments,
  ttlDays = DEFAULT_TTL_DAYS,
  now = () => new Date(),
}: WebSearchDeps) {
  return async (state: WebSearchState): Promise<Record<string, never>> => {
    const fetchedAt = now();
    const expiresAt = new Date(fetchedAt.getTime() + ttlDays * MS_POR_DIA);

    // Duas queries diferentes podem trazer a mesma URL; ela só é baixada uma vez.
    const urlsVistas = new Set<string>();

    for (const query of buildQueries(state.question, state.missingAspects)) {
      const resultados = (await searchProvider.search(query))
        .slice(0, RESULTS_PER_QUERY)
        .filter((resultado) => !urlsVistas.has(resultado.url));
      resultados.forEach((resultado) => urlsVistas.add(resultado.url));

      // allSettled, e não all: uma página fora do ar ou em timeout não pode
      // derrubar as outras. As rejeitadas são simplesmente descartadas.
      const paginas = await Promise.allSettled(resultados.map((r) => fetchPage(r.url)));

      const chunks: { resultado: SearchResult; content: string }[] = [];
      paginas.forEach((pagina, i) => {
        if (pagina.status === 'rejected') {
          return;
        }
        for (const content of chunkText(extractText(pagina.value))) {
          chunks.push({ resultado: resultados[i], content });
        }
      });

      if (chunks.length === 0) {
        continue;
      }

      const vetores = await embeddings.embedDocuments(chunks.map((chunk) => chunk.content));

      await saveWebDocuments(
        chunks.map((chunk, i) => ({
          query,
          title: chunk.resultado.title,
          content: chunk.content,
          sourceUrl: chunk.resultado.url,
          fetchedAt,
          expiresAt,
          embedding: vetores[i],
        })),
      );
    }

    return {};
  };
}
