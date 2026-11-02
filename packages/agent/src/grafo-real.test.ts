import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Todas as variáveis que a construção do grafo real lê. Os nomes de modelo são os
 * reais, porque o ChatVertexAI confere o nome no construtor — mas nenhum teste chama
 * `invoke`, então nada sai para a rede. O banco não existe: o pool só conectaria
 * na primeira consulta.
 */
function ambienteCompleto() {
  vi.stubEnv('DATABASE_URL', 'postgres://usuario:senha@localhost:5432/teste');
  vi.stubEnv('MODEL_EMBEDDING', 'gemini-embedding-001');
  vi.stubEnv('MODEL_GRADE', 'gemini-3.5-flash-lite');
  vi.stubEnv('MODEL_ANSWER', 'gemini-3.6-flash');
  vi.stubEnv('DEMO', 'true');
}

/**
 * O módulo guarda o grafo numa variável de módulo; cada teste importa uma cópia
 * nova para começar sem grafo construído.
 */
async function importarNovo() {
  vi.resetModules();
  return import('./grafo-real.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('obterGrafoReal', () => {
  it('constrói o grafo uma vez e devolve o mesmo nas chamadas seguintes', async () => {
    ambienteCompleto();
    const { obterGrafoReal } = await importarNovo();

    const primeiro = obterGrafoReal();

    expect(obterGrafoReal()).toBe(primeiro);
  });

  it('não constrói nada ao ser importado: variável faltando só falha na chamada', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { obterGrafoReal } = await importarNovo();

    expect(() => obterGrafoReal()).toThrow(/DATABASE_URL/);
  });

  it('não guarda a falha: corrigido o ambiente, a chamada seguinte constrói', async () => {
    ambienteCompleto();
    vi.stubEnv('MODEL_ANSWER', '');
    const { obterGrafoReal } = await importarNovo();
    expect(() => obterGrafoReal()).toThrow(/MODEL_ANSWER/);

    vi.stubEnv('MODEL_ANSWER', 'gemini-3.6-flash');

    expect(obterGrafoReal()).toBeDefined();
  });
});
