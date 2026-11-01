/**
 * Blocos cujo conteúdo não é texto para leitura. São removidos inteiros, com o
 * que estiver dentro — senão o código de um <script> viraria "texto" da página.
 */
const BLOCOS_SEM_TEXTO = /<(script|style|noscript|svg|head|template)\b[\s\S]*?<\/\1>/gi;
const COMENTARIO = /<!--[\s\S]*?-->/g;
const TAG = /<[^>]+>/g;

/** Só as entidades mais comuns. `&amp;` vem por último para não decodificar duas vezes. */
function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCodePoint(Number(codigo)))
    .replace(/&amp;/g, '&');
}

/**
 * Transforma HTML em texto corrido. É deliberadamente simples — regex, sem parser
 * de DOM: o objetivo é ter algo que o embedding entenda, não reproduzir a página.
 *
 * Cada tag vira um espaço (para "<p>a</p><p>b</p>" não colar em "ab") e no fim
 * todo espaço repetido vira um só.
 */
export function extractText(html: string): string {
  const semTags = html.replace(BLOCOS_SEM_TEXTO, ' ').replace(COMENTARIO, ' ').replace(TAG, ' ');

  return decodificarEntidades(semTags).replace(/\s+/g, ' ').trim();
}
