import { Annotation } from '@langchain/langgraph';
import type { RetrievedDoc } from './db/retrieve-similar.js';

/**
 * O estado que circula entre os nós. Cada campo é contrato entre pelo menos
 * dois nós — quem escreve e quem lê:
 *
 * - question: entrada; lida por retrieve, grade e webSearch.
 * - documents: escrito por retrieve, lido por grade e answer.
 * - sufficient: escrito por grade, lido pela aresta condicional e por answer.
 * - missingAspects: escrito por grade, lido por webSearch.
 * - iterations: escrito por grade, lido pela aresta condicional.
 * - finalAnswer: escrito por answer; é a saída do grafo, lida por quem o chamou.
 *   Não pode se chamar `answer`: o LangGraph proíbe campo de estado com o mesmo
 *   nome de um nó.
 *
 * O reducer diz como a atualização de um nó se combina com o valor anterior.
 * `(_prev, next) => next` substitui; `prev + next` acumula.
 */
export const ResearchState = Annotation.Root({
  question: Annotation<string>,
  documents: Annotation<RetrievedDoc[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  sufficient: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  missingAspects: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** O grade devolve `iterations: 1`; o reducer soma. Ninguém guarda contador fora do estado. */
  iterations: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),
  finalAnswer: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
});
