import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { RetrievedDoc } from '../db/retrieve-similar.js';

/**
 * Instrução fixa do nó `grade`.
 *
 * O ponto central é a lista de perguntas qualitativas: documentos CVM só têm
 * números, então "por que o lucro caiu?" nunca é respondível com eles — mesmo
 * quando o documento é da empresa e do trimestre certos. Sem essa regra
 * explícita, o modelo tende a achar que "documento da empresa certa" basta.
 *
 * Páginas web, gravadas pelo nó `webSearch`, podem trazer o qualitativo. Por isso
 * a regra fala em documentos CVM, e não no contexto inteiro: se ela valesse para
 * tudo, a segunda volta do loop nunca seria suficiente.
 */
const SYSTEM = `Você avalia se um contexto recuperado é suficiente para responder uma pergunta.

O contexto pode ter dois tipos de documento, identificados no cabeçalho de cada um:
- CVM: APENAS indicadores financeiros numéricos (receita líquida, lucro bruto, lucro
  líquido, ativo total, patrimônio líquido, caixa operacional), por empresa e trimestre,
  extraídos dos formulários ITR e DFP da CVM.
- Web: trecho de uma página encontrada em busca na web, em texto livre.

Classifique como suficiente somente quando o contexto responde a pergunta por inteiro:
a empresa certa, o período certo e a informação pedida estão presentes.

Documentos CVM NUNCA bastam, mesmo que sejam da empresa certa, quando a pergunta pedir
algo qualitativo que números não contêm:
- o motivo ou a explicação por trás de um número;
- notícias ou acontecimentos;
- fatos relevantes;
- guidance ou projeções da empresa;
- previsão de preço ou de cotação.
Uma pergunta assim só é suficiente se um documento Web tratar dela diretamente.

Também é insuficiente quando falta a empresa, o período ou a informação pedida.

Em missingAspects, liste o que falta para responder, em frases curtas que sirvam de
termo de busca na web. Se o contexto for suficiente, devolva missingAspects vazio.`;

function formatDocument(doc: RetrievedDoc): string {
  if (doc.kind === 'cvm') {
    return `CVM — ${doc.ticker} — ${doc.period}\n${doc.paragraph}`;
  }
  return `Web — ${doc.title} (${doc.sourceUrl})\n${doc.content}`;
}

function formatDocuments(documents: RetrievedDoc[]): string {
  if (documents.length === 0) {
    return '(nenhum documento encontrado)';
  }

  return documents.map((doc, i) => `[${i + 1}] ${formatDocument(doc)}`).join('\n\n');
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
