import type { RetrievedDoc } from '../db/retrieve-similar.js';

/**
 * Texto que substitui a resposta inteira quando o filtro encontra linguagem
 * recomendatória. É fixo de propósito: não depende do LLM acertar nada.
 */
export const AVISO_GUARDRAIL =
  'Não posso recomendar compra, venda ou manutenção de investimentos: consultoria de ' +
  'valores mobiliários é atividade regulada pela CVM. Posso informar os indicadores ' +
  'financeiros disponíveis nas fontes abaixo.';

/**
 * Padrões de linguagem recomendatória. `(?<!\p{L})` e `(?!\p{L})` fazem o papel
 * de `\b`, que em JavaScript não enxerga letra acentuada como parte da palavra.
 *
 * O filtro é conservador: "não recomendo" também casa. Errar para esse lado só
 * troca a resposta pelo aviso fixo — o contrário deixaria passar uma recomendação.
 */
const PADROES_RECOMENDATORIOS: RegExp[] = [
  // Verbo de recomendação em primeira pessoa: recomendo, sugerimos, aconselho...
  /(?<!\p{L})(recomendo|recomendamos|sugiro|sugerimos|aconselho|aconselhamos)(?!\p{L})/iu,
  /(?<!\p{L})(minha|nossa)\s+(recomendação|sugestão)(?!\p{L})/iu,
  // "vale a pena comprar", "você deveria vender", "é um bom momento para investir"
  /(?<!\p{L})vale\s+a\s+pena\s+(comprar|vender|investir|manter)(?!\p{L})/iu,
  /(?<!\p{L})você\s+(deve|deveria|poderia)\s+(comprar|vender|investir|manter)(?!\p{L})/iu,
  /(?<!\p{L})(é|seria)\s+(um\s+)?(bom|ótimo|excelente)\s+momento\s+(para|de)\s+(comprar|vender|investir)(?!\p{L})/iu,
];

export function contemLinguagemRecomendatoria(texto: string): boolean {
  return PADROES_RECOMENDATORIOS.some((padrao) => padrao.test(texto));
}

/** Um item do bloco de fontes. */
export type Fonte = {
  rotulo: string;
  url: string;
};

/**
 * O que torna duas fontes "a mesma".
 *
 * Não dá para usar só a URL: no corpus CVM ela é o ZIP anual da CVM, igual para
 * as 20 empresas — deduplicar por ela juntaria PETR e VALE num item só. Já na web
 * a URL é a chave certa: vários chunks da mesma página são uma fonte só.
 */
export function chaveDaFonte(doc: RetrievedDoc): string {
  if (doc.kind === 'cvm') {
    return `cvm:${doc.ticker}:${doc.period}`;
  }
  return `web:${doc.sourceUrl}`;
}

/** "2025-09-30" → "30/09/2025" */
function formatarData(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function rotuloDaFonte(doc: RetrievedDoc): string {
  if (doc.kind === 'cvm') {
    return `${doc.ticker} — ${doc.period}, data-base ${formatarData(doc.periodEnd)} (CVM)`;
  }
  return doc.title;
}

/**
 * Uma fonte por chave, na ordem em que aparecem nos documentos. A posição na lista
 * (a partir de 1) é o número que o prompt usa e que o LLM cita como [n].
 */
export function listarFontes(documents: RetrievedDoc[]): Fonte[] {
  const vistas = new Set<string>();
  const fontes: Fonte[] = [];

  for (const doc of documents) {
    const chave = chaveDaFonte(doc);
    if (vistas.has(chave)) {
      continue;
    }
    vistas.add(chave);
    fontes.push({ rotulo: rotuloDaFonte(doc), url: doc.sourceUrl });
  }

  return fontes;
}

function blocoDeFontes(documents: RetrievedDoc[]): string {
  const fontes = listarFontes(documents);
  if (fontes.length === 0) {
    return 'Fontes: nenhum documento encontrado.';
  }

  const itens = fontes.map((fonte, i) => `[${i + 1}] ${fonte.rotulo} — ${fonte.url}`);
  return ['Fontes:', ...itens].join('\n');
}

/**
 * Último passo antes de a resposta sair: o guardrail determinístico e o bloco de
 * fontes. O prompt já proíbe recomendar; isto garante, mesmo que o modelo desobedeça.
 *
 * O bloco de fontes é anexado nos dois casos — também quando o texto foi trocado
 * pelo aviso, para quem perguntou poder consultar os dados por conta própria.
 */
export function formatResposta(textoDoLlm: string, documents: RetrievedDoc[]): string {
  const corpo = contemLinguagemRecomendatoria(textoDoLlm) ? AVISO_GUARDRAIL : textoDoLlm.trim();

  return `${corpo}\n\n${blocoDeFontes(documents)}`;
}
