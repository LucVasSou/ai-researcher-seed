import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

/**
 * Tamanho do vetor guardado no banco. O cliente de embeddings pede exatamente essa
 * dimensão ao modelo — se os dois divergirem, o insert falha.
 *
 * Por que não os 3072 nativos do gemini-embedding-001: o índice HNSW do pgvector
 * aceita no máximo 2000 dimensões.
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Um registro por empresa e trimestre — espelha o DocumentoFinal de packages/corpus,
 * mais o embedding do parágrafo.
 *
 * Os indicadores já estão em reais (a conversão de milhares acontece uma única vez,
 * na normalização do corpus). O maior valor do corpus fica na casa de 10^12, longe do
 * limite seguro de um number do JavaScript (~9 × 10^15) — por isso mode: 'number'.
 */
export const documentos = pgTable(
  'documentos',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    ticker: text('ticker').notNull(),
    companyName: text('company_name').notNull(),
    setor: text('setor').notNull(),
    /** Ex.: "3T25" */
    period: text('period').notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),

    receitaLiquida: bigint('receita_liquida', { mode: 'number' }).notNull(),
    lucroBruto: bigint('lucro_bruto', { mode: 'number' }).notNull(),
    lucroLiquido: bigint('lucro_liquido', { mode: 'number' }).notNull(),
    ativoTotal: bigint('ativo_total', { mode: 'number' }).notNull(),
    patrimonioLiquido: bigint('patrimonio_liquido', { mode: 'number' }).notNull(),
    caixaOperacional: bigint('caixa_operacional', { mode: 'number' }).notNull(),
    /** Nulo no 4º trimestre: a CVM não oferece o comparativo do ano anterior. */
    receitaMesmoTrimestreAnoAnterior: bigint('receita_mesmo_trimestre_ano_anterior', {
      mode: 'number',
    }),

    sourceUrl: text('source_url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),

    paragraph: text('paragraph').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  (table) => [
    uniqueIndex('documentos_ticker_period_idx').on(table.ticker, table.period),
    index('documentos_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
);

/**
 * Um registro por pedaço (chunk) de página web, gravado pelo nó `webSearch`.
 *
 * Fica separada de `documentos` porque o formato é outro: texto livre em vez de
 * indicadores, e com prazo de validade. Notícia envelhece; o ITR de um trimestre
 * fechado não — por isso só esta tabela tem `expires_at`.
 */
export const documentosWeb = pgTable(
  'documentos_web',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    /** A query de busca que trouxe esta página — útil para entender o trace depois. */
    query: text('query').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),

    sourceUrl: text('source_url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    /** Depois desta data o retrieve ignora o registro. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  (table) => [
    index('documentos_web_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
);
