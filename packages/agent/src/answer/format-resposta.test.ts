import { describe, expect, it } from 'vitest';
import type { CorpusDoc, WebDoc } from '../db/retrieve-similar.js';
import {
  AVISO_GUARDRAIL,
  contemLinguagemRecomendatoria,
  formatResposta,
  listarFontes,
} from './format-resposta.js';

const ZIP_ITR_2025 =
  'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_2025.zip';

function corpusDoc(ticker: string, period: string, periodEnd: string): CorpusDoc {
  return {
    kind: 'cvm',
    ticker,
    companyName: ticker,
    setor: 'qualquer',
    period,
    periodEnd,
    sourceUrl: ZIP_ITR_2025,
    fetchedAt: new Date('2026-08-08T00:00:00Z'),
    paragraph: '...',
    distance: 0.1,
  };
}

function webDoc(title: string, sourceUrl: string): WebDoc {
  return {
    kind: 'web',
    title,
    content: '...',
    sourceUrl,
    fetchedAt: new Date('2026-10-30T00:00:00Z'),
    distance: 0.2,
  };
}

describe('contemLinguagemRecomendatoria', () => {
  it.each([
    'Recomendo a compra de PETR4.',
    'Sugiro aguardar o próximo trimestre.',
    'Aconselho cautela com VALE3.',
    'Nós recomendamos manter a posição.',
    'Minha recomendação é vender.',
    'Vale a pena comprar agora.',
    'Você deveria vender suas ações.',
    'É um bom momento para investir em bancos.',
  ])('detecta: %s', (texto) => {
    expect(contemLinguagemRecomendatoria(texto)).toBe(true);
  });

  it.each([
    'No 3T25, a Petrobras reportou receita líquida de R$ 127,9 bilhões [1].',
    'O lucro líquido caiu 12% em relação ao trimestre anterior.',
    // "recomendação" sem "minha/nossa" é só o substantivo, não uma recomendação.
    'A CVM regula a atividade de recomendação de investimentos.',
  ])('não detecta: %s', (texto) => {
    expect(contemLinguagemRecomendatoria(texto)).toBe(false);
  });
});

describe('listarFontes', () => {
  it('mantém um item por empresa e trimestre, mesmo com a mesma URL de ZIP da CVM', () => {
    const fontes = listarFontes([
      corpusDoc('PETR', '3T25', '2025-09-30'),
      corpusDoc('VALE', '3T25', '2025-09-30'),
    ]);

    expect(fontes.map((fonte) => fonte.rotulo)).toEqual([
      'PETR — 3T25, data-base 30/09/2025 (CVM)',
      'VALE — 3T25, data-base 30/09/2025 (CVM)',
    ]);
  });

  it('junta vários chunks da mesma página web num item só, identificado pelo título', () => {
    const fontes = listarFontes([
      webDoc('Petrobras explica queda', 'https://exemplo.com/a'),
      webDoc('Petrobras explica queda', 'https://exemplo.com/a'),
      webDoc('Outra notícia', 'https://exemplo.com/b'),
    ]);

    expect(fontes).toEqual([
      { rotulo: 'Petrobras explica queda', url: 'https://exemplo.com/a' },
      { rotulo: 'Outra notícia', url: 'https://exemplo.com/b' },
    ]);
  });
});

describe('formatResposta', () => {
  const documentos = [corpusDoc('PETR', '3T25', '2025-09-30')];

  it('mantém o texto do LLM e anexa o bloco de fontes numerado', () => {
    expect(formatResposta('A receita foi de R$ 127,9 bilhões [1].', documentos)).toBe(
      'A receita foi de R$ 127,9 bilhões [1].\n\n' +
        `Fontes:\n[1] PETR — 3T25, data-base 30/09/2025 (CVM) — ${ZIP_ITR_2025}`,
    );
  });

  it('troca o texto inteiro pelo aviso fixo, mas mantém as fontes, se houver recomendação', () => {
    const resposta = formatResposta('A receita subiu [1]. Recomendo comprar.', documentos);

    expect(resposta.startsWith(AVISO_GUARDRAIL)).toBe(true);
    expect(resposta).not.toContain('Recomendo');
    expect(resposta).toContain('[1] PETR — 3T25');
  });

  it('avisa no bloco de fontes quando não há documentos', () => {
    expect(formatResposta('Não encontrei dados.', [])).toContain(
      'Fontes: nenhum documento encontrado.',
    );
  });
});
