-- O drizzle-kit não gera CREATE EXTENSION: o tipo vector precisa existir antes da tabela.
-- No Cloud SQL a extensão já foi habilitada no Bloco A; IF NOT EXISTS torna isto inofensivo lá.
CREATE EXTENSION IF NOT EXISTS vector;
