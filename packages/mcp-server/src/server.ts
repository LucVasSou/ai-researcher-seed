import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { chatRequestSchema } from '@hero/contracts';

/**
 * O mínimo do grafo que a tool usa: o `invoke`, que roda retrieve → grade →
 * webSearch → answer e devolve o estado final. O grafo compilado do LangGraph
 * satisfaz esta interface; no teste, um fake de poucas linhas também.
 */
export interface GraphLike {
  invoke(
    input: { question: string },
    options?: { signal?: AbortSignal },
  ): Promise<{ finalAnswer: string }>;
}

/**
 * Quem entrega o grafo. Em produção é o `obterGrafoReal` de @hero/agent, que só
 * constrói o grafo na primeira chamada; no teste, uma função que devolve um fake.
 */
export type GetGraph = () => GraphLike;

/**
 * A descrição não é documentação para gente: é o texto que o modelo do cliente MCP
 * lê para decidir quando chamar a tool e o que esperar dela. Por isso diz o
 * domínio (quais empresas, qual fonte, quais indicadores), o que acontece com
 * pergunta qualitativa, o formato da resposta — e repete o guardrail.
 */
export const DESCRICAO_PERGUNTAR = `Responde perguntas sobre indicadores financeiros de 20 empresas listadas na B3, com dados oficiais da CVM (formulários ITR e DFP) dos últimos 4 trimestres.

Empresas: Itaú Unibanco (ITUB), Bradesco (BBDC), Banco do Brasil (BBAS), Axia Energia (ELET), Engie Brasil (EGIE), Cemig (CMIG), Petrobras (PETR), Prio (PRIO), Vale (VALE), Gerdau (GGBR), CSN (CSNA), Magazine Luiza (MGLU), Lojas Renner (LREN), Assaí/Sendas (ASAI), Ambev (ABEV), JBS (JBSS), BRF (BRFS), Suzano (SUZB), Klabin (KLBN) e Totvs (TOTS).

Indicadores disponíveis: receita líquida, lucro bruto, lucro líquido, ativo total, patrimônio líquido e caixa operacional. Perguntas qualitativas (motivo de um resultado, notícias, fatos relevantes, guidance) são complementadas com busca na web.

A resposta vem em português, com cada dado citado como [n] e uma lista de fontes com a data-base. Repasse as citações e as datas ao usuário.

Esta ferramenta apenas informa: nunca recomenda comprar, vender ou manter ativos, e não deve ser usada para pedir recomendação de investimento. Não apresente a resposta dela como recomendação.`;

/** O que o cliente recebe quando o grafo falha. Nada do erro interno vai junto. */
export const MENSAGEM_FALHA =
  'Não foi possível concluir a pesquisa agora. Tente novamente em instantes.';

/**
 * Cria o servidor MCP com a tool `perguntar`. O transporte (stdio, HTTP) fica de
 * fora: quem chama conecta o servidor no transporte que quiser.
 */
export function criarServidor(getGraph: GetGraph): McpServer {
  const server = new McpServer({ name: 'ai-researcher', version: '0.0.0' });

  server.registerTool(
    'perguntar',
    {
      title: 'Perguntar ao AI Researcher',
      description: DESCRICAO_PERGUNTAR,
      // Mesma regra de validação da pergunta no POST /api/chat.
      inputSchema: {
        pergunta: chatRequestSchema.shape.question.describe(
          'A pergunta em linguagem natural, em português. Ex.: "Qual foi o lucro líquido da Vale no 3T25?"',
        ),
      },
    },
    async ({ pergunta }, extra) => {
      try {
        // getGraph() fica dentro do try: é na primeira chamada que o grafo real é
        // construído, e uma variável de ambiente faltando falha aqui.
        // O signal cancela o grafo se o cliente desistir da chamada.
        const { finalAnswer } = await getGraph().invoke(
          { question: pergunta },
          { signal: extra.signal },
        );
        return { content: [{ type: 'text', text: finalAnswer }] };
      } catch (erro) {
        // stderr, nunca stdout: no transporte stdio, o stdout é o canal do protocolo.
        console.error('perguntar: falha ao executar o grafo.', erro);
        return { isError: true, content: [{ type: 'text', text: MENSAGEM_FALHA }] };
      }
    },
  );

  return server;
}
