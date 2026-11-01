import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { RetrievedDoc } from '../db/retrieve-similar.js';

/**
 * Instrução fixa do nó `grade`.
 *
 * O ponto central é a lista de perguntas qualitativas: o corpus só tem números,
 * então "por que o lucro caiu?" nunca é respondível com ele — mesmo quando o
 * documento recuperado é da empresa e do trimestre certos. Sem essa regra
 * explícita, o modelo tende a achar que "documento da empresa certa" basta.
 */
const SYSTEM = `Você avalia se um contexto recuperado é suficiente para responder uma pergunta.

O contexto contém APENAS indicadores financeiros numéricos (receita líquida, lucro bruto,
lucro líquido, ativo total, patrimônio líquido, caixa operacional), por empresa e trimestre,
extraídos dos formulários ITR e DFP da CVM.

Classifique como suficiente somente quando os números do contexto respondem a pergunta
por inteiro: a empresa certa, o período certo e o indicador certo estão presentes.

Classifique SEMPRE como insuficiente, mesmo que o documento seja da empresa certa, quando
a pergunta pedir algo qualitativo que números não contêm:
- o motivo ou a explicação por trás de um número;
- notícias ou acontecimentos;
- fatos relevantes;
- guidance ou projeções da empresa;
- previsão de preço ou de cotação.

Também é insuficiente quando falta a empresa, o período ou o indicador pedido.

Em missingAspects, liste o que falta para responder, em frases curtas que sirvam de
termo de busca na web. Se o contexto for suficiente, devolva missingAspects vazio.`;

function formatDocuments(documents: RetrievedDoc[]): string {
  if (documents.length === 0) {
    return '(nenhum documento encontrado)';
  }

  return documents
    .map((doc, i) => `[${i + 1}] ${doc.ticker} — ${doc.period}\n${doc.paragraph}`)
    .join('\n\n');
}

export function gradePrompt({
  question,
  documents,
}: {
  question: string;
  documents: RetrievedDoc[];
}) {
  return [
    new SystemMessage(SYSTEM),
    new HumanMessage(`Pergunta: ${question}\n\nContexto:\n${formatDocuments(documents)}`),
  ];
}
