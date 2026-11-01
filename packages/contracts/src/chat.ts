import { z } from 'zod';

/**
 * Corpo do POST /api/chat. O limite de tamanho existe porque a pergunta vira
 * prompt e busca web: texto gigante é custo de LLM, não pergunta.
 */
export const chatRequestSchema = z.object({
  question: z.string().trim().min(1).max(1000),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
