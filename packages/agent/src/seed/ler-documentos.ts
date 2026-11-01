import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCUMENTOS_DIR = path.join(HERE, '../../../corpus/data/documentos');

/**
 * Formato de cada documento em packages/corpus/data/documentos/{TICKER}.json.
 * Ler arquivo é fronteira: valida aqui, e daqui pra dentro o seed confia nos tipos.
 */
export const DocumentoSchema = z.object({
  ticker: z.string().min(1),
  companyName: z.string().min(1),
  setor: z.string().min(1),
  period: z.string().regex(/^[1-4]T\d{2}$/, 'esperado no formato 3T25'),
  periodEnd: z.iso.date(),
  receitaLiquida: z.int(),
  lucroBruto: z.int(),
  lucroLiquido: z.int(),
  ativoTotal: z.int(),
  patrimonioLiquido: z.int(),
  caixaOperacional: z.int(),
  receitaMesmoTrimestreAnoAnterior: z.int().optional(),
  sourceUrl: z.url(),
  fetchedAt: z.iso.datetime(),
  paragraph: z.string().min(1),
});

export type Documento = z.infer<typeof DocumentoSchema>;

export class DocumentoInvalidoError extends Error {
  constructor(arquivo: string, detalhe: string) {
    super(`Documento inválido em ${arquivo}:\n${detalhe}`);
    this.name = 'DocumentoInvalidoError';
  }
}

/** Lê e valida todos os JSONs do diretório. Um arquivo inválido interrompe o seed inteiro. */
export function lerDocumentos(diretorio: string = DOCUMENTOS_DIR): Documento[] {
  const arquivos = readdirSync(diretorio)
    .filter((arquivo) => arquivo.endsWith('.json'))
    .sort();

  return arquivos.flatMap((arquivo) => {
    const conteudo: unknown = JSON.parse(readFileSync(path.join(diretorio, arquivo), 'utf-8'));
    const resultado = z.array(DocumentoSchema).safeParse(conteudo);
    if (!resultado.success) {
      throw new DocumentoInvalidoError(arquivo, z.prettifyError(resultado.error));
    }
    return resultado.data;
  });
}
