import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { formatResposta } from '../answer/format-resposta.js';
import type { RetrievedDoc } from '../db/retrieve-similar.js';
import { answerPrompt } from '../prompts/answer.js';

type AnswerState = {
  question: string;
  documents: RetrievedDoc[];
  sufficient: boolean;
};

/**
 * Cria o nó `answer`: gera a resposta final a partir do contexto recuperado.
 *
 * O cliente chega por parâmetro, já configurado com o modelo de MODEL_ANSWER.
 * O texto do LLM nunca sai direto: passa antes pelo `formatResposta`, que aplica
 * o guardrail de recomendação e anexa as fontes.
 */
export function makeAnswerNode(llm: BaseChatModel) {
  return async (state: AnswerState): Promise<{ finalAnswer: string }> => {
    const resposta = await llm.invoke(
      answerPrompt({
        question: state.question,
        documents: state.documents,
        sufficient: state.sufficient,
      }),
    );

    return { finalAnswer: formatResposta(resposta.text, state.documents) };
  };
}
