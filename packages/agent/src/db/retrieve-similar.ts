import { cosineDistance } from 'drizzle-orm';
import type { Db } from './client.js';
import { documentos } from './schema.js';

/**
 * Um documento devolvido pela busca: o parágrafo que vai para o LLM, os metadados
 * que a resposta precisa citar (fonte e data-base) e a distância até a pergunta.
 *
 * Os indicadores numéricos ficam de fora de propósito — eles já estão escritos
 * dentro do parágrafo, que é o único texto que o LLM lê.
 */
export type RetrievedDoc = {
  ticker: string;
  companyName: string;
  setor: string;
  period: string;
  periodEnd: string;
  sourceUrl: string;
  fetchedAt: Date;
  paragraph: string;
  /** Distância de cosseno: 0 é idêntico, 2 é oposto. Menor é mais parecido. */
  distance: number;
};

/**
 * Busca os `k` documentos cujo embedding está mais perto do vetor da pergunta.
 *
 * `cosineDistance` vira o operador `<=>` do pgvector. Ordenar por ele, do menor
 * para o maior, é o que faz o Postgres usar o índice HNSW criado com
 * `vector_cosine_ops` em schema.ts — operador e índice precisam ser da mesma família.
 */
export async function retrieveSimilar(
  db: Db,
  embedding: number[],
  k: number,
): Promise<RetrievedDoc[]> {
  // O pg devolve o resultado do `<=>` (double precision) como number; o mapWith
  // só informa isso ao TypeScript, que de outra forma veria `unknown`.
  const distance = cosineDistance(documentos.embedding, embedding).mapWith(Number);

  return db
    .select({
      ticker: documentos.ticker,
      companyName: documentos.companyName,
      setor: documentos.setor,
      period: documentos.period,
      periodEnd: documentos.periodEnd,
      sourceUrl: documentos.sourceUrl,
      fetchedAt: documentos.fetchedAt,
      paragraph: documentos.paragraph,
      distance,
    })
    .from(documentos)
    .orderBy(distance)
    .limit(k);
}
