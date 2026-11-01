import type { Embeddings } from '@langchain/core/embeddings';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { END, START, StateGraph } from '@langchain/langgraph';
import type { NewWebDocument } from './db/save-web-documents.js';
import { makeAnswerNode } from './nodes/answer.js';
import { makeGradeNode } from './nodes/grade.js';
import { makeRetrieveNode, type SearchSimilar } from './nodes/retrieve.js';
import { makeWebSearchNode } from './nodes/web-search.js';
import type { SearchProvider } from './search/index.js';
import { ResearchState } from './state.js';

/**
 * Quantas vezes o grade pode rodar. Na segunda passada insuficiente o grafo vai
 * para o answer mesmo assim — estourar o limite não é erro, é resposta com menos
 * confiança, e o answer avisa que o contexto é incompleto.
 */
export const MAX_ITERATIONS = 2;

/**
 * Tudo o que o grafo precisa do mundo de fora. Banco e rede entram como funções
 * e clientes já montados — o grafo nunca recebe um `db` — e por isso o grafo
 * inteiro roda no teste só com fakes.
 */
export type GraphDeps = {
  embeddings: Embeddings;
  /** Já configurado com o modelo de MODEL_GRADE. */
  gradeLlm: BaseChatModel;
  /** Já configurado com o modelo de MODEL_ANSWER. */
  answerLlm: BaseChatModel;
  searchSimilar: SearchSimilar;
  searchProvider: SearchProvider;
  fetchPage: (url: string) => Promise<string>;
  saveWebDocuments: (docs: NewWebDocument[]) => Promise<void>;
};

/**
 * A decisão de rota depois do grade. Só lê o estado — quem produziu `sufficient`
 * e `iterations` foi o próprio grade.
 */
export function routeAfterGrade(state: typeof ResearchState.State) {
  if (state.sufficient) return 'answer';
  if (state.iterations >= MAX_ITERATIONS) return 'answer';
  return 'webSearch';
}

/**
 *   START → retrieve → grade → [suficiente]                 → answer → END
 *                            → [insuficiente, limite batido] → answer → END
 *                            → [insuficiente]                → webSearch → retrieve
 */
export function buildGraph(deps: GraphDeps) {
  return new StateGraph(ResearchState)
    .addNode(
      'retrieve',
      makeRetrieveNode({ embeddings: deps.embeddings, searchSimilar: deps.searchSimilar }),
    )
    .addNode('grade', makeGradeNode(deps.gradeLlm))
    .addNode(
      'webSearch',
      makeWebSearchNode({
        searchProvider: deps.searchProvider,
        fetchPage: deps.fetchPage,
        embeddings: deps.embeddings,
        saveWebDocuments: deps.saveWebDocuments,
      }),
    )
    .addNode('answer', makeAnswerNode(deps.answerLlm))
    .addEdge(START, 'retrieve')
    .addEdge('retrieve', 'grade')
    .addConditionalEdges('grade', routeAfterGrade, ['webSearch', 'answer'])
    .addEdge('webSearch', 'retrieve')
    .addEdge('answer', END)
    .compile();
}
