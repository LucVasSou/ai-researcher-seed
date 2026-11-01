import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import type { RetrievedDoc } from '../db/retrieve-similar.js';
import { gradePrompt } from '../prompts/grade.js';

/**
 * O formato que o LLM é obrigado a devolver. A aresta condicional decide a rota
 * a partir de `sufficient` — por isso é saída estruturada, nunca texto livre.
 *
 * As descrições viram parte do schema enviado ao modelo.
 */
export const gradeResult = z.object({
  sufficient: z.boolean().describe('true se o contexto responde a pergunta por inteiro'),
  missingAspects: z
    .array(z.string())
    .describe('o que falta para responder, em frases curtas usáveis como busca na web'),
});

type GradeState = {
  question: string;
  documents: RetrievedDoc[];
};

type GradeUpdate = z.infer<typeof gradeResult> & {
  /** Somado ao contador do estado pelo reducer: cada passagem pelo grade é uma iteração. */
  iterations: number;
};

/**
 * Cria o nó `grade`: pergunta ao LLM se os documentos recuperados bastam.
 *
 * O cliente chega por parâmetro, já configurado com o modelo de MODEL_GRADE.
 * O nó não decide rota — só produz `sufficient`, que a aresta lê.
 */
export function makeGradeNode(llm: BaseChatModel) {
  const structured = llm.withStructuredOutput(gradeResult);

  return async (state: GradeState): Promise<GradeUpdate> => {
    const result = await structured.invoke(
      gradePrompt({ question: state.question, documents: state.documents }),
    );

    return {
      sufficient: result.sufficient,
      missingAspects: result.missingAspects,
      iterations: 1,
    };
  };
}
