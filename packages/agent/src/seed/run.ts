import type { Embeddings } from '@langchain/core/embeddings';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { criarDb, type Db } from '../db/client.js';
import { documentos } from '../db/schema.js';
import { criarEmbeddingsVertex } from './embeddings.js';
import { lerDocumentos, type Documento } from './ler-documentos.js';

/**
 * Quantos documentos processar por vez.
 *
 * O gemini-embedding-001 na Vertex aceita um texto por requisição, então o
 * `embedDocuments` do LangChain dispara uma chamada por documento, todas em paralelo.
 * Passar os 80 de uma vez seriam 80 chamadas simultâneas; em lotes de 10, nunca há
 * mais que 10 em voo — e cada lote já é gravado antes de o próximo começar.
 */
const TAMANHO_DO_LOTE = 10;

function dividirEmLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    lotes.push(itens.slice(i, i + tamanho));
  }
  return lotes;
}

/** No upsert, `excluded.coluna` é o valor que tentou ser inserido e conflitou. */
function valorNovo(coluna: { name: string }) {
  return sql.raw(`excluded.${coluna.name}`);
}

async function gravarLote(db: Db, lote: Documento[], vetores: number[][]): Promise<void> {
  const linhas = lote.map((documento, i) => ({
    ...documento,
    fetchedAt: new Date(documento.fetchedAt),
    embedding: vetores[i],
  }));

  // Rodar o seed de novo atualiza a linha de (ticker, period) em vez de duplicar.
  await db
    .insert(documentos)
    .values(linhas)
    .onConflictDoUpdate({
      target: [documentos.ticker, documentos.period],
      set: {
        companyName: valorNovo(documentos.companyName),
        setor: valorNovo(documentos.setor),
        periodEnd: valorNovo(documentos.periodEnd),
        receitaLiquida: valorNovo(documentos.receitaLiquida),
        lucroBruto: valorNovo(documentos.lucroBruto),
        lucroLiquido: valorNovo(documentos.lucroLiquido),
        ativoTotal: valorNovo(documentos.ativoTotal),
        patrimonioLiquido: valorNovo(documentos.patrimonioLiquido),
        caixaOperacional: valorNovo(documentos.caixaOperacional),
        receitaMesmoTrimestreAnoAnterior: valorNovo(documentos.receitaMesmoTrimestreAnoAnterior),
        sourceUrl: valorNovo(documentos.sourceUrl),
        fetchedAt: valorNovo(documentos.fetchedAt),
        paragraph: valorNovo(documentos.paragraph),
        embedding: valorNovo(documentos.embedding),
      },
    });
}

export async function seed(db: Db, embeddings: Embeddings): Promise<void> {
  const todos = lerDocumentos();
  const lotes = dividirEmLotes(todos, TAMANHO_DO_LOTE);
  console.log(`${todos.length} documentos lidos, ${lotes.length} lotes de até ${TAMANHO_DO_LOTE}.`);

  for (const [i, lote] of lotes.entries()) {
    const vetores = await embeddings.embedDocuments(lote.map((documento) => documento.paragraph));
    await gravarLote(db, lote, vetores);
    console.log(`Lote ${i + 1}/${lotes.length}: ${lote.length} documentos gravados.`);
  }
}

const executadoDiretamente = process.argv[1] === fileURLToPath(import.meta.url);
if (executadoDiretamente) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL não definida.');
    process.exit(1);
  }

  const { db, pool } = criarDb(databaseUrl);
  seed(db, criarEmbeddingsVertex())
    .catch((erro) => {
      console.error(erro);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
