import { describe, expect, it, vi } from 'vitest';
import { CircuitoAbertoError, comResiliencia, type OpcoesResiliencia } from './com-resiliencia.js';
import { SearchProviderError, type SearchResult } from './search-provider.js';

const RESULTADO: SearchResult[] = [{ title: 't', snippet: 's', url: 'https://exemplo.com' }];
const FALHA = new SearchProviderError('Fake', 'HTTP 503');

/**
 * Provedor fake que segue um roteiro: cada item é o desfecho de uma chamada, na
 * ordem — 'ok' devolve RESULTADO, 'falha' lança FALHA.
 */
function providerComRoteiro(roteiro: ('ok' | 'falha')[]) {
  const search = vi.fn(async () => {
    const desfecho = roteiro.shift();
    if (desfecho === 'falha') throw FALHA;
    return RESULTADO;
  });
  return { search };
}

/**
 * Espera e relógio falsos: `esperar` só anota quantos ms esperaria, e o relógio
 * só anda quando o teste chama `avancar`. Nenhum teste espera de verdade.
 */
function ambienteFalso() {
  const esperas: number[] = [];
  let instante = 0;
  const opcoes: OpcoesResiliencia = {
    esperar: async (ms) => {
      esperas.push(ms);
    },
    agora: () => instante,
  };
  return {
    esperas,
    opcoes,
    avancar(ms: number) {
      instante += ms;
    },
  };
}

describe('comResiliencia — retry com backoff', () => {
  it('não espera nem repete quando a primeira tentativa dá certo', async () => {
    const provider = providerComRoteiro(['ok']);
    const { esperas, opcoes } = ambienteFalso();

    expect(await comResiliencia(provider, opcoes).search('q')).toBe(RESULTADO);
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(esperas).toEqual([]);
  });

  it('repete após falha, dobrando a espera a cada tentativa', async () => {
    const provider = providerComRoteiro(['falha', 'falha', 'ok']);
    const { esperas, opcoes } = ambienteFalso();

    expect(await comResiliencia(provider, opcoes).search('q')).toBe(RESULTADO);
    expect(provider.search).toHaveBeenCalledTimes(3);
    expect(esperas).toEqual([500, 1000]);
  });

  it('desiste depois da última tentativa e relança o erro original', async () => {
    const provider = providerComRoteiro(['falha', 'falha', 'falha', 'falha', 'ok']);
    const { esperas, opcoes } = ambienteFalso();

    await expect(
      comResiliencia(provider, { ...opcoes, tentativas: 4, esperaInicialMs: 100 }).search('q'),
    ).rejects.toBe(FALHA);
    expect(provider.search).toHaveBeenCalledTimes(4);
    // sem espera depois da última tentativa: não haveria o que esperar
    expect(esperas).toEqual([100, 200, 400]);
  });

  it('repassa a query ao provedor em toda tentativa', async () => {
    const provider = providerComRoteiro(['falha', 'ok']);
    const { opcoes } = ambienteFalso();

    await comResiliencia(provider, opcoes).search('lucro Vale 3T25');

    expect(provider.search).toHaveBeenNthCalledWith(1, 'lucro Vale 3T25');
    expect(provider.search).toHaveBeenNthCalledWith(2, 'lucro Vale 3T25');
  });
});

describe('comResiliencia — circuit breaker', () => {
  // Com uma tentativa só, cada busca é uma chamada ao provedor: fica fácil contar.
  const semRetry = { tentativas: 1, falhasParaAbrir: 3, resfriamentoMs: 30_000 };

  it('abre depois de N buscas seguidas falhando e passa a falhar sem chamar o provedor', async () => {
    const provider = providerComRoteiro(['falha', 'falha', 'falha', 'ok']);
    const { opcoes } = ambienteFalso();
    const resiliente = comResiliencia(provider, { ...opcoes, ...semRetry });

    for (let i = 0; i < 3; i++) {
      await expect(resiliente.search('q')).rejects.toBe(FALHA);
    }

    await expect(resiliente.search('q')).rejects.toThrow(CircuitoAbertoError);
    expect(provider.search).toHaveBeenCalledTimes(3);
  });

  it('conta uma busca como uma falha só, não importa quantas tentativas ela fez', async () => {
    const provider = providerComRoteiro(Array(6).fill('falha'));
    const { opcoes } = ambienteFalso();
    const resiliente = comResiliencia(provider, { ...opcoes, tentativas: 3, falhasParaAbrir: 2 });

    await expect(resiliente.search('q')).rejects.toBe(FALHA);
    await expect(resiliente.search('q')).rejects.toBe(FALHA);
    expect(provider.search).toHaveBeenCalledTimes(6);

    await expect(resiliente.search('q')).rejects.toThrow(CircuitoAbertoError);
  });

  it('com o circuito aberto, não espera backoff nenhum', async () => {
    const provider = providerComRoteiro(['falha', 'falha', 'falha']);
    const { esperas, opcoes } = ambienteFalso();
    const resiliente = comResiliencia(provider, { ...opcoes, ...semRetry });
    for (let i = 0; i < 3; i++) await resiliente.search('q').catch(() => {});

    await expect(resiliente.search('q')).rejects.toThrow(CircuitoAbertoError);
    expect(esperas).toEqual([]);
  });

  it('um sucesso no meio zera a contagem de falhas seguidas', async () => {
    const provider = providerComRoteiro(['falha', 'falha', 'ok', 'falha', 'falha', 'ok']);
    const { opcoes } = ambienteFalso();
    const resiliente = comResiliencia(provider, { ...opcoes, ...semRetry });

    for (const esperado of ['falha', 'falha', 'ok', 'falha', 'falha', 'ok']) {
      if (esperado === 'ok') await expect(resiliente.search('q')).resolves.toBe(RESULTADO);
      else await expect(resiliente.search('q')).rejects.toBe(FALHA);
    }
    // nunca houve três falhas seguidas: o provedor foi chamado em todas as seis
    expect(provider.search).toHaveBeenCalledTimes(6);
  });

  it('continua aberto até o fim do resfriamento', async () => {
    const provider = providerComRoteiro(['falha', 'falha', 'falha', 'ok']);
    const { opcoes, avancar } = ambienteFalso();
    const resiliente = comResiliencia(provider, { ...opcoes, ...semRetry });
    for (let i = 0; i < 3; i++) await resiliente.search('q').catch(() => {});

    avancar(29_999);

    await expect(resiliente.search('q')).rejects.toThrow(CircuitoAbertoError);
    expect(provider.search).toHaveBeenCalledTimes(3);
  });

  it('passado o resfriamento, libera uma busca; se ela dá certo, o circuito fecha', async () => {
    const provider = providerComRoteiro(['falha', 'falha', 'falha', 'ok', 'falha', 'ok']);
    const { opcoes, avancar } = ambienteFalso();
    const resiliente = comResiliencia(provider, { ...opcoes, ...semRetry });
    for (let i = 0; i < 3; i++) await resiliente.search('q').catch(() => {});

    avancar(30_000);

    await expect(resiliente.search('q')).resolves.toBe(RESULTADO);
    // fechado e com a contagem zerada: uma falha isolada não reabre
    await expect(resiliente.search('q')).rejects.toBe(FALHA);
    await expect(resiliente.search('q')).resolves.toBe(RESULTADO);
  });

  it('passado o resfriamento, se a busca liberada falha, reabre na hora', async () => {
    const provider = providerComRoteiro(['falha', 'falha', 'falha', 'falha', 'ok']);
    const { opcoes, avancar } = ambienteFalso();
    const resiliente = comResiliencia(provider, { ...opcoes, ...semRetry });
    for (let i = 0; i < 3; i++) await resiliente.search('q').catch(() => {});

    avancar(30_000);
    await expect(resiliente.search('q')).rejects.toBe(FALHA);

    // não precisou de mais três falhas: abriu de novo, por mais um resfriamento
    await expect(resiliente.search('q')).rejects.toThrow(CircuitoAbertoError);
    expect(provider.search).toHaveBeenCalledTimes(4);
  });
});
