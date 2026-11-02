import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { CircuitoAbertoError } from '@hero/agent/search';
import { PROBLEM_JSON_CONTENT_TYPE, type ProblemDetails } from '@hero/contracts';

/**
 * Com `type: "about:blank"`, a RFC 7807 manda o `title` ser o texto padrão do
 * status HTTP ("Bad Request", "Service Unavailable"). O que muda de um erro para
 * outro vai no `detail`.
 */
function problema(status: number, detail: string): ProblemDetails {
  return { type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status, detail };
}

/** Traduz qualquer erro lançado por uma rota no problema que o cliente recebe. */
export function paraProblema(error: FastifyError | Error): ProblemDetails {
  // Entrada inválida: a rota chamou `schema.parse(...)` e o zod recusou.
  if (error instanceof ZodError) {
    return problema(400, error.issues.map((issue) => issue.message).join('; '));
  }

  // O circuito do SearchProvider está aberto: a busca web está fora por um tempo.
  if (error instanceof CircuitoAbertoError) {
    return problema(
      503,
      'A busca web está temporariamente indisponível. Tente de novo em instantes.',
    );
  }

  // Erros que o próprio Fastify gera antes da rota — JSON malformado, corpo grande
  // demais, content-type não suportado — já chegam com um status 4xx. São culpa da
  // requisição, não do servidor, e a mensagem deles não expõe nada interno.
  if (
    'statusCode' in error &&
    error.statusCode &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return problema(error.statusCode, error.message);
  }

  // Todo o resto é falha nossa. A mensagem e a stack ficam no log; o cliente recebe
  // um texto genérico, que não revela nada da implementação.
  return problema(500, 'Ocorreu um erro inesperado. Tente novamente mais tarde.');
}

/**
 * O único lugar da API que transforma erro em resposta. Registrado uma vez, em
 * `build()`; as rotas só lançam.
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const problemaDoErro = paraProblema(error);

  if (problemaDoErro.status >= 500) {
    request.log.error(error, 'erro ao atender a requisição');
  }

  return reply.code(problemaDoErro.status).type(PROBLEM_JSON_CONTENT_TYPE).send(problemaDoErro);
}
