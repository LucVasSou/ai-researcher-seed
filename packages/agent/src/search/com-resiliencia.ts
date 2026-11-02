import type { SearchProvider } from './search-provider.js';

export const DEFAULT_TENTATIVAS = 3;
export const DEFAULT_ESPERA_INICIAL_MS = 500;
export const DEFAULT_FALHAS_PARA_ABRIR = 3;
export const DEFAULT_RESFRIAMENTO_MS = 30_000;

export type OpcoesResiliencia = {
  /** Quantas vezes chamar o provedor, contando a primeira. */
  tentativas?: number;
  /** Espera antes da 2ª tentativa; dobra a cada nova tentativa (500, 1000, 2000…). */
  esperaInicialMs?: number;
  /** Quantas buscas seguidas falhando — já depois do retry — abrem o circuito. */
  falhasParaAbrir?: number;
  /** Quanto tempo o circuito fica aberto antes de deixar uma busca passar de novo. */
  resfriamentoMs?: number;
  /** Como esperar entre tentativas. No teste, um fake que só anota quanto esperaria. */
  esperar?: (ms: number) => Promise<void>;
  /** Relógio, em milissegundos. No teste, um número que o próprio teste avança. */
  agora?: () => number;
};

/** O circuito está aberto: a busca nem chegou a ser feita. */
export class CircuitoAbertoError extends Error {
  constructor(liberaEmMs: number) {
    super(`Busca web suspensa após falhas seguidas; nova tentativa em ${liberaEmMs} ms.`);
    this.name = 'CircuitoAbertoError';
  }
}

function esperarDeVerdade(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Envolve um SearchProvider com duas proteções, sem que ele saiba disso:
 *
 * 1. **Retry com backoff exponencial.** Uma busca que falha é repetida até
 *    `tentativas` vezes, esperando 500 ms, depois 1000 ms, e assim por diante —
 *    uma falha passageira (timeout, 503) não derruba a pergunta.
 *
 * 2. **Circuit breaker.** Se `falhasParaAbrir` buscas seguidas falham mesmo com o
 *    retry, o provedor provavelmente está fora do ar. O circuito abre: durante
 *    `resfriamentoMs`, toda busca falha na hora com CircuitoAbertoError, sem chamar
 *    o provedor e sem esperar timeout nenhum. Passado o resfriamento, a próxima
 *    busca é liberada como teste: se der certo, o circuito fecha; se falhar, abre
 *    de novo por mais um resfriamento.
 *
 * O breaker fica por fora do retry: uma busca conta como uma falha só, não importa
 * quantas tentativas ela tenha feito.
 */
export function comResiliencia(
  provider: SearchProvider,
  {
    tentativas = DEFAULT_TENTATIVAS,
    esperaInicialMs = DEFAULT_ESPERA_INICIAL_MS,
    falhasParaAbrir = DEFAULT_FALHAS_PARA_ABRIR,
    resfriamentoMs = DEFAULT_RESFRIAMENTO_MS,
    esperar = esperarDeVerdade,
    agora = Date.now,
  }: OpcoesResiliencia = {},
): SearchProvider {
  // O estado do circuito vive aqui, compartilhado por todas as buscas deste provedor.
  let falhasSeguidas = 0;
  let abertoAte: number | undefined;

  async function buscarComRetry(query: string) {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await provider.search(query);
      } catch (erro) {
        if (tentativa >= tentativas) {
          throw erro;
        }
        await esperar(esperaInicialMs * 2 ** (tentativa - 1));
      }
    }
  }

  return {
    async search(query) {
      if (abertoAte !== undefined && agora() < abertoAte) {
        throw new CircuitoAbertoError(abertoAte - agora());
      }

      try {
        const resultados = await buscarComRetry(query);
        falhasSeguidas = 0;
        abertoAte = undefined;
        return resultados;
      } catch (erro) {
        falhasSeguidas += 1;
        if (falhasSeguidas >= falhasParaAbrir) {
          abertoAte = agora() + resfriamentoMs;
        }
        throw erro;
      }
    },
  };
}
