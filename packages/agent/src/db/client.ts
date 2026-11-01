import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

/**
 * Devolve o pool junto com o cliente Drizzle: quem cria a conexão é quem fecha
 * (`pool.end()`), senão um script como o seed fica pendurado ao terminar.
 */
export function criarDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = ReturnType<typeof criarDb>['db'];
