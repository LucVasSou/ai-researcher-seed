import type { Db } from './client.js';
import { documentosWeb } from './schema.js';

/** O que o nó `webSearch` entrega para gravar: um registro por chunk. */
export type NewWebDocument = typeof documentosWeb.$inferInsert;

export async function saveWebDocuments(db: Db, docs: NewWebDocument[]): Promise<void> {
  if (docs.length === 0) {
    return;
  }
  await db.insert(documentosWeb).values(docs);
}
