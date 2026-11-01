import { cosineDistance, gt, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { documentos, documentosWeb } from './schema.js';

/**
 * Um documento do corpus CVM: o parágrafo que vai para o LLM e os metadados que
 * a resposta precisa citar (fonte e data-base).
 *
 * Os indicadores numéricos ficam de fora de propósito — eles já estão escritos
 * dentro do parágrafo, que é o único texto que o LLM lê.
 */
export type CorpusDoc = {
  kind: 'cvm';
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

/** Um pedaço de página web gravado pelo nó `webSearch`. */
export type WebDoc = {
  kind: 'web';
  title: string;
  content: string;
  sourceUrl: string;
  fetchedAt: Date;
  distance: number;
};

/** O `kind` diz de que tabela o documento veio — e, portanto, quais campos ele tem. */
export type RetrievedDoc = CorpusDoc | WebDoc;

/**
 * Busca no corpus CVM. Ordenar pela `cosineDistance` (o operador `<=>` do pgvector),
 * do menor para o maior, é o que faz o Postgres usar o índice HNSW criado com
 * `vector_cosine_ops` em schema.ts — operador e índice precisam ser da mesma família.
 *
 * Devolve o query builder sem executar, para o teste poder inspecionar o SQL.
 */
export function corpusQuery(db: Db, embedding: number[], k: number) {
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

/**
 * Busca nas páginas web já gravadas, ignorando as expiradas. O "agora" é o
 * `now()` do Postgres, não o relógio da aplicação — a comparação acontece toda
 * dentro do banco.
 */
export function webQuery(db: Db, embedding: number[], k: number) {
  const distance = cosineDistance(documentosWeb.embedding, embedding).mapWith(Number);

  return db
    .select({
      title: documentosWeb.title,
      content: documentosWeb.content,
      sourceUrl: documentosWeb.sourceUrl,
      fetchedAt: documentosWeb.fetchedAt,
      distance,
    })
    .from(documentosWeb)
    .where(gt(documentosWeb.expiresAt, sql`now()`))
    .orderBy(distance)
    .limit(k);
}

/**
 * Junta as duas listas e fica com os `k` mais próximos, olhando só a distância.
 * Um documento web não ganha nem perde prioridade por ser web.
 */
export function combineByDistance(corpus: CorpusDoc[], web: WebDoc[], k: number): RetrievedDoc[] {
  const todos: RetrievedDoc[] = [...corpus, ...web];
  return todos.sort((a, b) => a.distance - b.distance).slice(0, k);
}

/**
 * Busca os `k` documentos mais próximos do vetor da pergunta, somando corpus CVM
 * e páginas web.
 *
 * Cada tabela devolve até `k` — no pior caso, os `k` melhores estão todos numa
 * só delas. Depois `combineByDistance` corta para `k` no total.
 */
export async function retrieveSimilar(
  db: Db,
  embedding: number[],
  k: number,
): Promise<RetrievedDoc[]> {
  const [corpusRows, webRows] = await Promise.all([
    corpusQuery(db, embedding, k),
    webQuery(db, embedding, k),
  ]);

  const corpus = corpusRows.map((row) => ({ kind: 'cvm' as const, ...row }));
  const web = webRows.map((row) => ({ kind: 'web' as const, ...row }));

  return combineByDistance(corpus, web, k);
}
