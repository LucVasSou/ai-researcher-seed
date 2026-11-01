import { defineConfig } from 'drizzle-kit';

// Gerar migration não precisa de banco: o drizzle-kit compara o schema.ts com os
// snapshots em drizzle/meta. A DATABASE_URL só é lida no `db:migrate` — local aponta
// pro Postgres do docker-compose, em produção pro Cloud SQL. Mesmo comando, só muda a URL.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
