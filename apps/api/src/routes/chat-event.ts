/**
 * O que cada nó do grafo devolve, no formato do `graph.stream()` em
 * streamMode 'updates'. Espelha os tipos de packages/agent só no que a rota
 * lê — a API ainda não depende do pacote do agente.
 */
type RetrievedDocUpdate =
  | { kind: 'cvm'; ticker: string; period: string; sourceUrl: string; distance: number }
  | { kind: 'web'; title: string; sourceUrl: string; distance: number };

export type GraphUpdates = {
  retrieve: { documents: RetrievedDocUpdate[] };
  grade: { sufficient: boolean; missingAspects: string[]; iterations: number };
  webSearch: Record<string, never>;
  answer: { finalAnswer: string };
};

/** Um chunk do stream: { nomeDoNó: update }, um nó por vez. */
export type GraphChunk = Partial<GraphUpdates>;

/** Resumo de documento que vai para o cliente — sem o texto, que pode ser longo. */
export type DocumentSummary =
  | { kind: 'cvm'; ticker: string; period: string; sourceUrl: string; distance: number }
  | { kind: 'web'; title: string; sourceUrl: string; distance: number };

/** Um evento SSE por nó concluído. O `type` diz qual nó foi e quais campos vêm junto. */
export type ChatEvent =
  | { type: 'retrieve'; documents: DocumentSummary[] }
  | { type: 'grade'; sufficient: boolean; missingAspects: string[]; iterations: number }
  | { type: 'webSearch' }
  | { type: 'answer'; answer: string }
  | { type: 'error'; message: string };

function summarize(doc: RetrievedDocUpdate): DocumentSummary {
  if (doc.kind === 'cvm') {
    return {
      kind: 'cvm',
      ticker: doc.ticker,
      period: doc.period,
      sourceUrl: doc.sourceUrl,
      distance: doc.distance,
    };
  }
  return { kind: 'web', title: doc.title, sourceUrl: doc.sourceUrl, distance: doc.distance };
}

/**
 * Traduz um chunk do grafo nos eventos que o cliente recebe.
 *
 * `iterationsSoFar` existe por causa do grade: o update dele traz o incremento
 * (`iterations: 1`), que o reducer do estado soma. Para o cliente ver o total,
 * a rota passa quantas iterações já contou e o evento leva a soma.
 */
export function toChatEvents(chunk: GraphChunk, iterationsSoFar: number): ChatEvent[] {
  const events: ChatEvent[] = [];

  if (chunk.retrieve) {
    events.push({ type: 'retrieve', documents: chunk.retrieve.documents.map(summarize) });
  }
  if (chunk.grade) {
    events.push({
      type: 'grade',
      sufficient: chunk.grade.sufficient,
      missingAspects: chunk.grade.missingAspects,
      iterations: iterationsSoFar + chunk.grade.iterations,
    });
  }
  // O webSearch grava no banco e não devolve campo de estado: o evento é só o nome.
  if (chunk.webSearch) {
    events.push({ type: 'webSearch' });
  }
  if (chunk.answer) {
    events.push({ type: 'answer', answer: chunk.answer.finalAnswer });
  }

  return events;
}
