import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentoInvalidoError, lerDocumentos } from './ler-documentos.js';

function diretorioCom(arquivos: Record<string, unknown>): string {
  const diretorio = mkdtempSync(path.join(tmpdir(), 'seed-'));
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    writeFileSync(path.join(diretorio, nome), JSON.stringify(conteudo));
  }
  return diretorio;
}

const documentoValido = {
  ticker: 'PETR',
  companyName: 'Petróleo Brasileiro S.A. - Petrobras',
  setor: 'Petróleo e Gás',
  period: '3T25',
  periodEnd: '2025-09-30',
  receitaLiquida: 127906000000,
  lucroBruto: 61117000000,
  lucroLiquido: 32847000000,
  ativoTotal: 1212038000000,
  patrimonioLiquido: 424961000000,
  caixaOperacional: 53655000000,
  sourceUrl: 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_2025.zip',
  fetchedAt: '2026-08-08T02:19:40.760Z',
  paragraph: 'No 3T25, a Petrobras reportou receita líquida de R$ 127,9 bilhões.',
};

describe('lerDocumentos', () => {
  it('lê os 80 documentos versionados do corpus (20 empresas × 4 trimestres)', () => {
    const documentos = lerDocumentos();

    expect(documentos).toHaveLength(80);
    const chaves = new Set(documentos.map((d) => `${d.ticker}/${d.period}`));
    expect(chaves.size).toBe(80);
  });

  it('aceita documento sem o comparativo do ano anterior (4º trimestre)', () => {
    const diretorio = diretorioCom({ 'PETR.json': [documentoValido] });

    expect(lerDocumentos(diretorio)[0].receitaMesmoTrimestreAnoAnterior).toBeUndefined();
  });

  it('rejeita documento inválido citando o arquivo', () => {
    const diretorio = diretorioCom({
      'PETR.json': [{ ...documentoValido, period: 'terceiro trimestre' }],
    });

    expect(() => lerDocumentos(diretorio)).toThrow(DocumentoInvalidoError);
    expect(() => lerDocumentos(diretorio)).toThrow(/PETR\.json/);
  });

  it('ignora arquivos que não são JSON', () => {
    const diretorio = diretorioCom({ 'PETR.json': [documentoValido], 'LEIAME.txt': 'x' });

    expect(lerDocumentos(diretorio)).toHaveLength(1);
  });
});
