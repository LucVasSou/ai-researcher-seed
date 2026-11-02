import { z } from 'zod';

/** O content-type de toda resposta de erro da API (RFC 7807). */
export const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';

/**
 * Corpo de toda resposta de erro da API, no formato da RFC 7807.
 *
 * - `type`: URI que identifica o tipo do problema. Sem um tipo próprio documentado,
 *   a RFC manda usar "about:blank" — e aí o `title` é o texto do status HTTP.
 * - `title`: resumo curto, o mesmo para todo problema do mesmo tipo.
 * - `status`: o código HTTP, repetido no corpo para quem só olha o JSON.
 * - `detail`: explicação desta ocorrência, legível por gente — é o que o frontend
 *   mostra na tela.
 */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
