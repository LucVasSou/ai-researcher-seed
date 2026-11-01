import { FakeListChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it } from 'vitest';
import { AVISO_GUARDRAIL, contemLinguagemRecomendatoria } from '../answer/format-resposta.js';
import type { RetrievedDoc } from '../db/retrieve-similar.js';
import { answerPrompt, SYSTEM } from '../prompts/answer.js';
import { makeAnswerNode } from './answer.js';

const petr3T25: RetrievedDoc = {
  kind: 'cvm',
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

function fakeLlm(resposta: string) {
  return new FakeListChatModel({ responses: [resposta] });
}

describe('answer', () => {
  it('devolve a resposta do LLM com a citação e o bloco de fontes', async () => {
    const answer = makeAnswerNode(
      fakeLlm('No 3T25, a receita líquida da Petrobras foi de R$ 127,9 bilhões [1].'),
    );

    const { finalAnswer: resposta } = await answer({
      question: 'Qual a receita da Petrobras no 3T25?',
      documents: [petr3T25],
      sufficient: true,
    });

    expect(resposta).toContain('R$ 127,9 bilhões [1]');
    expect(resposta).toContain('Fontes:\n[1] PETR — 3T25, data-base 30/09/2025 (CVM)');
  });

  // Guardrail regulatório (CLAUDE.md): este teste é obrigatório e não pode ser removido.
  // Se ele quebrar, o problema é o comportamento, não o teste.
  it('guardrail: "devo comprar?" nunca sai com linguagem recomendatória, mesmo se o LLM recomendar', async () => {
    const answer = makeAnswerNode(
      fakeLlm('A Petrobras lucrou bem no 3T25 [1]. Recomendo comprar PETR4, vale a pena comprar.'),
    );

    const { finalAnswer: resposta } = await answer({
      question: 'Devo comprar PETR4?',
      documents: [petr3T25],
      sufficient: true,
    });

    expect(contemLinguagemRecomendatoria(resposta)).toBe(false);
    expect(resposta.startsWith(AVISO_GUARDRAIL)).toBe(true);
    expect(resposta).toContain('[1] PETR — 3T25');
  });
});

describe('answerPrompt', () => {
  it('instrui o modelo a nunca recomendar, mesmo quando a pergunta pede', () => {
    const [system] = answerPrompt({
      question: 'Devo comprar PETR4?',
      documents: [petr3T25],
      sufficient: true,
    });

    expect(system.content).toBe(SYSTEM);
    expect(SYSTEM).toContain('Nunca recomende decisão de investimento');
    expect(SYSTEM).toMatch(/comprar, vender ou manter/);
    expect(SYSTEM).toContain('mesmo se a pergunta pedir diretamente');
  });

  it('instrui a responder só com o contexto e a não inventar números', () => {
    expect(SYSTEM).toContain('apenas com base no contexto');
    expect(SYSTEM).toContain('Não invente números');
  });

  it('pede o aviso de contexto incompleto só quando sufficient é false', () => {
    const [, completo] = answerPrompt({ question: 'q', documents: [petr3T25], sufficient: true });
    const [, incompleto] = answerPrompt({
      question: 'q',
      documents: [petr3T25],
      sufficient: false,
    });

    expect(completo.content).not.toContain('incompleto');
    expect(incompleto.content).toContain('avaliado como incompleto');
  });

  it('numera os documentos pela fonte, com o mesmo número para chunks da mesma página', () => {
    const chunk = (content: string): RetrievedDoc => ({
      kind: 'web',
      title: 'Notícia',
      content,
      sourceUrl: 'https://exemplo.com/a',
      fetchedAt: new Date('2026-10-30T00:00:00Z'),
      distance: 0.2,
    });

    const [, human] = answerPrompt({
      question: 'q',
      documents: [petr3T25, chunk('parte 1'), chunk('parte 2')],
      sufficient: true,
    });

    expect(human.content).toContain('[1] CVM — PETR — 3T25');
    expect(human.content).toContain('[2] Web — Notícia\nparte 1');
    expect(human.content).toContain('[2] Web — Notícia\nparte 2');
  });
});
