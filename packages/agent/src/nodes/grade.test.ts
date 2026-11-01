import { FakeListChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it } from 'vitest';
import type { RetrievedDoc } from '../db/retrieve-similar.js';
import { gradePrompt } from '../prompts/grade.js';
import { makeGradeNode } from './grade.js';

const petr3T25: RetrievedDoc = {
  ticker: 'PETR',
  companyName: 'Petróleo Brasileiro S.A. - Petrobras',
  setor: 'Petróleo e Gás',
  period: '3T25',
  periodEnd: '2025-09-30',
  sourceUrl: 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_2025.zip',
  fetchedAt: new Date('2026-08-08T02:19:40.760Z'),
  paragraph: 'No 3T25, a Petrobras reportou receita líquida de R$ 127,9 bilhões.',
  distance: 0.12,
};

/** LLM fake: devolve a resposta dada como JSON, que o withStructuredOutput do fake parseia. */
function fakeLlm(response: unknown) {
  return new FakeListChatModel({ responses: [JSON.stringify(response)] });
}

describe('grade', () => {
  it('devolve a classificação do LLM e conta uma iteração', async () => {
    const grade = makeGradeNode(fakeLlm({ sufficient: true, missingAspects: [] }));

    const result = await grade({
      question: 'Qual a receita da Petrobras no 3T25?',
      documents: [petr3T25],
    });

    expect(result).toEqual({ sufficient: true, missingAspects: [], iterations: 1 });
  });

  it('repassa os aspectos faltantes quando o contexto é insuficiente', async () => {
    const grade = makeGradeNode(
      fakeLlm({ sufficient: false, missingAspects: ['motivo da queda do lucro da Petrobras'] }),
    );

    const result = await grade({
      question: 'Por que o lucro da Petrobras caiu?',
      documents: [petr3T25],
    });

    expect(result.sufficient).toBe(false);
    expect(result.missingAspects).toEqual(['motivo da queda do lucro da Petrobras']);
  });
});

describe('gradePrompt', () => {
  it('leva a pergunta e o parágrafo de cada documento, identificado por ticker e período', () => {
    const [, human] = gradePrompt({
      question: 'Qual a receita da Petrobras no 3T25?',
      documents: [petr3T25],
    });

    expect(human.content).toContain('Qual a receita da Petrobras no 3T25?');
    expect(human.content).toContain('PETR — 3T25');
    expect(human.content).toContain(petr3T25.paragraph);
  });

  it('avisa o modelo quando nenhum documento foi encontrado', () => {
    const [, human] = gradePrompt({ question: 'qualquer', documents: [] });

    expect(human.content).toContain('(nenhum documento encontrado)');
  });
});
