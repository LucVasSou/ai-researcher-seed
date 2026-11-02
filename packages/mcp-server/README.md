# @hero/mcp-server

Servidor MCP do AI Researcher. Expõe uma única tool, `perguntar`, que recebe uma pergunta em texto e roda o grafo inteiro de `@hero/agent` — retrieve → grade → webSearch → answer —, devolvendo a resposta final já citada e com o guardrail de recomendação aplicado.

## A tool `perguntar`

| Campo | |
|---|---|
| Entrada | `{ pergunta: string }` — mesma validação do `POST /api/chat` (sem espaços nas pontas, 1 a 1000 caracteres) |
| Saída | um bloco `text` com a resposta final do nó `answer` |
| Falha | `isError: true` com uma mensagem genérica; o erro real vai para o stderr |

A descrição da tool (`DESCRICAO_PERGUNTAR`, em `src/server.ts`) não é documentação para gente: é o texto que o modelo do cliente lê para decidir quando chamar a tool. Por isso ela lista as 20 empresas, a fonte (CVM, ITR/DFP), os indicadores, o fallback para a web — e repete que a ferramenta nunca recomenda. Mudar esse texto muda o comportamento do cliente.

## Estrutura

```
src/
  index.ts        superfície pública (a única em `exports`): criarServidor, mcpHttpPlugin, tipos
  server.ts       criarServidor(getGraph): o McpServer com a tool, sem transporte
  http-plugin.ts  mcpHttpPlugin: POST /mcp via Streamable HTTP, stateless
  stdio.ts        processo: criarServidor(obterGrafoReal) + StdioServerTransport
  http.ts         processo: Fastify standalone com o mcpHttpPlugin, app.listen()
```

**Biblioteca separada de processo.** `stdio.ts` e `http.ts` têm efeito colateral ao rodar (conectam no stdin, abrem porta) e não são importados por ninguém: `exports` do `package.json` só expõe `index.ts`. Importar `@hero/mcp-server` como biblioteca — como faz o `apps/api` — nunca dispara nenhum dos dois; `src/index.test.ts` garante isso.

## Transportes

| | Onde | Para quem |
|---|---|---|
| stdio | `node dist/stdio.js` | Claude Code, Claude Desktop (`claude mcp add`) |
| Streamable HTTP standalone | `http://127.0.0.1:${MCP_HTTP_PORT}/mcp` (padrão 3100) | cliente MCP local via HTTP |
| Streamable HTTP no apps/api | `/api/mcp`, na porta da API | o Angular, pelo mesmo proxy do `/api/chat` |

Os dois HTTP são o mesmo `mcpHttpPlugin`, registrado em lugares diferentes. Ele é **stateless**: cada `POST` cria um `McpServer` e um transporte novos, que morrem com a resposta; nenhuma sessão fica em memória, e `GET`/`DELETE` respondem 405 com `Allow: POST`. A resposta é JSON (`enableJsonResponse`), não SSE — a tool devolve um resultado só, e JSON passa sem surpresa por qualquer proxy. O que dura entre requisições é o grafo, que vem do `getGraph`.

O standalone escuta só em `127.0.0.1`. Para fora da máquina, o caminho é o `/api/mcp`.

No `apps/api`, `/api/chat` e `/api/mcp` recebem o **mesmo** `getGraph` (`obterGrafoReal`, memoizado por processo): um grafo, um `SearchProvider`, um circuit breaker para a mesma API de busca.

O grafo chega por parâmetro (`GetGraph`), como no resto do projeto. O teste passa um fake e exercita o protocolo inteiro — `initialize`, `tools/list`, `tools/call` — sem Postgres, sem Vertex AI e sem processo filho.

Em produção, `GetGraph` é o `obterGrafoReal` de `@hero/agent/grafo-real`: constrói o grafo (pool do Postgres, clientes da Vertex AI, provedor de busca) na primeira chamada da tool, e reaproveita o mesmo grafo nas seguintes. O processo sobe e responde ao `tools/list` mesmo sem banco nem credenciais; uma variável faltando só aparece quando alguém pergunta, como `isError`.

## Rodando com o Claude Code (stdio)

```bash
pnpm --filter @hero/mcp-server... build     # o mcp-server e os pacotes de que ele depende
claude mcp add ai-researcher -- node "$(pwd)/packages/mcp-server/dist/stdio.js"
```

Use `node` direto, não `pnpm start`: o pnpm escreve o nome do script no stdout antes de rodar, e no transporte stdio o stdout é o canal do protocolo — qualquer linha a mais corrompe a conversa. Pelo mesmo motivo, nada no servidor usa `console.log`; os logs vão para o stderr.

Variáveis de ambiente, as mesmas do `@hero/agent`: `DATABASE_URL`, `MODEL_EMBEDDING`, `MODEL_GRADE`, `MODEL_ANSWER`, `SEARCH_PROVIDER` e a chave do provedor, ou `DEMO=true`. O `claude mcp add -e NOME=valor` grava o valor na configuração local do Claude Code — aceitável para `MODEL_*`, `DEMO` e `SEARCH_PROVIDER`, mas não para `DATABASE_URL` nem chaves de API, que não devem ficar em arquivo.

## Comandos

```bash
pnpm --filter @hero/mcp-server test      # InMemoryTransport (servidor) e inject do Fastify (plugin HTTP)
pnpm --filter @hero/mcp-server dev       # sobe o stdio via tsx (para depurar com um cliente MCP)
pnpm --filter @hero/mcp-server dev:http  # sobe o HTTP standalone via tsx, em MCP_HTTP_PORT (3100)
```
