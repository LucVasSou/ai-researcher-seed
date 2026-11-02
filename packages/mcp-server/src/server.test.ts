import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarServidor, MENSAGEM_FALHA, type GetGraph, type GraphLike } from './server.js';

/**
 * Sobe o servidor de verdade e conecta um cliente MCP de verdade a ele, pelo
 * InMemoryTransport do SDK: o teste passa pelo protocolo inteiro (initialize,
 * tools/list, tools/call), só sem processo filho e sem rede.
 */
async function conectar(getGraph: GetGraph) {
  const [transporteCliente, transporteServidor] = InMemoryTransport.createLinkedPair();
  const server = criarServidor(getGraph);
  const client = new Client({ name: 'teste', version: '0.0.0' });

  await Promise.all([server.connect(transporteServidor), client.connect(transporteCliente)]);
  return client;
}

/** Grafo fake: anota as perguntas recebidas e devolve sempre a mesma resposta. */
function fakeGraph(finalAnswer: string) {
  const perguntas: string[] = [];
  const graph: GraphLike = {
    async invoke(input) {
      perguntas.push(input.question);
      return { finalAnswer };
    },
  };
  return { graph, perguntas };
}

function textoDe(resultado: Awaited<ReturnType<Client['callTool']>>) {
  const [item] = resultado.content as { type: string; text: string }[];
  return item.text;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('servidor MCP', () => {
  it('expõe uma única tool, perguntar, com o domínio e o guardrail na descrição', async () => {
    const client = await conectar(() => fakeGraph('').graph);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['perguntar']);
    const [perguntar] = tools;
    expect(perguntar.description).toContain('20 empresas listadas na B3');
    expect(perguntar.description).toContain('CVM');
    expect(perguntar.description).toContain('nunca recomenda');
    expect(perguntar.inputSchema.required).toEqual(['pergunta']);
  });

  it('roda o grafo com a pergunta e devolve a resposta final como texto', async () => {
    const resposta = 'A Vale teve receita líquida de R$ 56,7 bilhões no 3T25 [1].\n\nFontes: ...';
    const { graph, perguntas } = fakeGraph(resposta);
    const client = await conectar(() => graph);

    const resultado = await client.callTool({
      name: 'perguntar',
      arguments: { pergunta: '  Qual foi a receita líquida da Vale no 3T25?  ' },
    });

    expect(resultado.isError).toBeFalsy();
    expect(textoDe(resultado)).toBe(resposta);
    // mesma validação do /api/chat: espaços das pontas removidos
    expect(perguntas).toEqual(['Qual foi a receita líquida da Vale no 3T25?']);
  });

  it('só pede o grafo na primeira chamada da tool, não ao subir o servidor', async () => {
    const getGraph = vi.fn(() => fakeGraph('resposta').graph);
    const client = await conectar(getGraph);
    await client.listTools();

    expect(getGraph).not.toHaveBeenCalled();

    await client.callTool({ name: 'perguntar', arguments: { pergunta: 'Lucro da Klabin?' } });
    expect(getGraph).toHaveBeenCalledTimes(1);
  });

  it('com o grafo falhando, devolve isError com mensagem genérica, sem vazar o erro', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = await conectar(() => ({
      invoke: async () => {
        throw new Error('falha em postgres://usuario:senha@10.0.0.5/hero');
      },
    }));

    const resultado = await client.callTool({
      name: 'perguntar',
      arguments: { pergunta: 'Qual o lucro da Petrobras?' },
    });

    expect(resultado.isError).toBe(true);
    expect(textoDe(resultado)).toBe(MENSAGEM_FALHA);
    expect(JSON.stringify(resultado)).not.toContain('postgres://');
  });

  it('com a construção do grafo falhando, também devolve isError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = await conectar(() => {
      throw new Error('DATABASE_URL não definida.');
    });

    const resultado = await client.callTool({
      name: 'perguntar',
      arguments: { pergunta: 'Qual o lucro da Petrobras?' },
    });

    expect(resultado.isError).toBe(true);
    expect(textoDe(resultado)).toBe(MENSAGEM_FALHA);
  });

  it('recusa pergunta vazia sem chamar o grafo', async () => {
    const getGraph = vi.fn(() => fakeGraph('resposta').graph);
    const client = await conectar(getGraph);

    const resultado = await client.callTool({ name: 'perguntar', arguments: { pergunta: '   ' } });

    expect(resultado.isError).toBe(true);
    expect(getGraph).not.toHaveBeenCalled();
  });
});
