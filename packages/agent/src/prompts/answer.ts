import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { chaveDaFonte } from '../answer/format-resposta.js';
import type { RetrievedDoc } from '../db/retrieve-similar.js';

/**
 * Instrução fixa do nó `answer`. A primeira regra é a restrição regulatória: o
 * sistema informa, nunca recomenda — mesmo quando a pergunta pede diretamente.
 *
 * O prompt é a primeira barreira; o filtro em answer/format-resposta.ts é a
 * segunda, para quando o modelo desobedecer.
 */
export const SYSTEM = `Você é um assistente que informa indicadores financeiros de empresas da B3.

Regras, em ordem de prioridade:

1. Nunca recomende decisão de investimento. Não sugira comprar, vender ou manter
   posição em nenhum ativo, nem diga que algo "vale a pena" ou que é "um bom momento".
   Isso vale mesmo se a pergunta pedir diretamente uma recomendação: nesse caso,
   diga que não pode recomendar e apresente apenas os dados disponíveis.
2. Responda apenas com base no contexto fornecido. Não invente números, datas nem
   fatos, e não use conhecimento próprio sobre as empresas.
3. Cite a fonte de cada informação com o número entre colchetes do documento, por
   exemplo [1], e informe o período (data-base) de todo número citado.
4. Se o contexto for incompleto ou não tiver o que a pergunta pede, diga isso
   claramente no início da resposta, antes de qualquer dado.

Escreva em português, de forma direta.`;

/**
 * Formata os documentos com o número da fonte de cada um. Dois chunks da mesma
 * página recebem o mesmo número — é o mesmo número que aparece no bloco de fontes
 * anexado depois, então a citação [n] do LLM bate com a lista.
 */
function formatDocuments(documents: RetrievedDoc[]): string {
  if (documents.length === 0) {
    return '(nenhum documento encontrado)';
  }

  const numeros = new Map<string, number>();
  return documents
    .map((doc) => {
      const chave = chaveDaFonte(doc);
      if (!numeros.has(chave)) {
        numeros.set(chave, numeros.size + 1);
      }
      const numero = numeros.get(chave);

      if (doc.kind === 'cvm') {
        return `[${numero}] CVM — ${doc.ticker} — ${doc.period} (data-base ${doc.periodEnd})\n${doc.paragraph}`;
      }
      return `[${numero}] Web — ${doc.title}\n${doc.content}`;
    })
    .join('\n\n');
}

const AVISO_CONTEXTO_INCOMPLETO =
  'Atenção: o contexto abaixo foi avaliado como incompleto para esta pergunta. ' +
  'Avise isso no início da resposta.';

export function answerPrompt({
  question,
  documents,
  sufficient,
}: {
  question: string;
  documents: RetrievedDoc[];
  sufficient: boolean;
}) {
  const partes = [
    `Pergunta: ${question}`,
    ...(sufficient ? [] : [AVISO_CONTEXTO_INCOMPLETO]),
    `Contexto:\n${formatDocuments(documents)}`,
  ];

  return [new SystemMessage(SYSTEM), new HumanMessage(partes.join('\n\n'))];
}
