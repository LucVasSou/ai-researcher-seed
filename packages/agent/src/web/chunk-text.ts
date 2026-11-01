export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 100;

/**
 * Divide o texto em pedaços de `size` caracteres, cada um repetindo os últimos
 * `overlap` caracteres do anterior.
 *
 * A sobreposição evita que uma frase cortada na fronteira fique sem sentido nos
 * dois lados: ela aparece inteira em pelo menos um dos chunks (se for menor que
 * `overlap`).
 *
 * Exemplo com size 10 e overlap 3: o primeiro chunk vai de 0 a 10, o segundo
 * de 7 a 17, o terceiro de 14 a 24 — o início anda `size - overlap` por vez.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  const passo = size - overlap;

  for (let inicio = 0; inicio < text.length; inicio += passo) {
    chunks.push(text.slice(inicio, inicio + size));
    // O chunk que já alcançou o fim do texto é o último; sem isso, sobraria um
    // chunk final contido inteiro na sobreposição do anterior.
    if (inicio + size >= text.length) {
      break;
    }
  }

  return chunks;
}
