# @hero/agent

O agente do AI Researcher: o grafo LangGraph que recebe uma pergunta, busca no corpus CVM, decide se o que encontrou basta, vai à web quando não basta e responde com citação — sem nunca recomendar investimento.

Este pacote não importa nada de `apps/*`. Quem monta o grafo com clientes reais (Vertex AI, Postgres, provedor de busca) é a API; aqui, tudo chega por parâmetro.

## O grafo

```
START → retrieve → grade ─┬─ [suficiente]                  → answer → END
                          ├─ [insuficiente, limite batido] → answer → END
                          └─ [insuficiente]                → webSearch → retrieve
```

| Nó | Lê do estado | Escreve no estado | Depende de |
|---|---|---|---|
| `retrieve` | `question` | `documents` | embeddings, busca por similaridade |
| `grade` | `question`, `documents` | `sufficient`, `missingAspects`, `iterations` | LLM (`MODEL_GRADE`) |
| `webSearch` | `question`, `missingAspects` | — (grava no banco) | provedor de busca, fetch de página, embeddings, insert |
| `answer` | `question`, `documents`, `sufficient` | `finalAnswer` | LLM (`MODEL_ANSWER`) |

A decisão de rota mora só na aresta condicional (`routeAfterGrade`, em `src/graph.ts`). Os nós produzem o dado; a aresta lê.

**Guard de iteração.** O `grade` devolve `iterations: 1` e o reducer do estado soma — não existe contador fora do estado. Quando `iterations` chega a `MAX_ITERATIONS` (2), o grafo vai para o `answer` mesmo com contexto insuficiente. Estourar o limite não é erro: é uma resposta com menos confiança, e o `answer` avisa que o contexto é incompleto.

## Estrutura

```
src/
  state.ts              ResearchState: os campos que circulam entre os nós
  graph.ts              buildGraph(deps), routeAfterGrade, MAX_ITERATIONS
  nodes/
    retrieve.ts         pergunta → embedding → top-k documentos
    grade.ts            o contexto responde a pergunta? (saída estruturada)
    web-search.ts       busca, baixa, quebra em chunks e grava em documentos_web
    answer.ts           gera a resposta e passa pelo filtro de guardrail
  prompts/
    grade.ts            instrução do grade
    answer.ts           instrução do answer (inclui a proibição de recomendar)
  answer/
    format-resposta.ts  filtro determinístico de recomendação + bloco de fontes
  search/
    search-provider.ts  interface SearchProvider e erros
    serper.ts           Serper (POST google.serper.dev/search)
    google-custom-search.ts  Google Custom Search (GET customsearch/v1)
    com-resiliencia.ts  comResiliencia(): retry com backoff + circuit breaker
    index.ts            criarSearchProvider(): escolhe pelo SEARCH_PROVIDER
  web/
    fetch-page.ts       baixa o HTML de uma URL, com timeout de 10 s
    extract-text.ts     HTML → texto corrido (regex, sem parser de DOM)
    chunk-text.ts       chunks de 1000 caracteres com sobreposição de 100
    criar-fetch-page.ts criarFetchPage(): fetchPage real ou o das fixtures (DEMO)
  demo/
    fixtures.ts         resultados de busca + HTML congelados (Vale, Petrobras, Klabin)
    demo-search-provider.ts  SearchProvider que responde das fixtures
    demo-fetch-page.ts  fetchPage que responde das fixtures
  db/
    schema.ts           tabelas documentos (corpus CVM) e documentos_web
    client.ts           criarDb(DATABASE_URL)
    retrieve-similar.ts busca por cosseno nas duas tabelas e combina
    save-web-documents.ts  insert em documentos_web
  seed/                 pnpm seed: JSONs do corpus → embeddings → documentos
drizzle/                migrations geradas pelo drizzle-kit
```

## As peças, uma a uma

### Banco: duas tabelas

- **`documentos`** — um registro por empresa e trimestre do corpus CVM, populado pelo `pnpm seed`. Não expira: o ITR de um trimestre fechado não muda.
- **`documentos_web`** — um registro por chunk de página web, gravado pelo `webSearch`. Tem `expires_at` (TTL padrão de 7 dias): notícia envelhece.

As duas têm índice HNSW com `vector_cosine_ops`, e o vetor tem 768 dimensões (o HNSW do pgvector aceita no máximo 2000; os 3072 nativos do `gemini-embedding-001` não caberiam).

### `retrieve`

Gera o embedding da pergunta com `embedQuery` e chama a busca. `retrieveSimilar` consulta as duas tabelas em paralelo — até `k` de cada, ignorando os documentos web expirados (`expires_at > now()`, pelo relógio do banco) — e `combineByDistance` junta tudo ordenando **só pela distância**, cortando em `k` (padrão 5). Um documento web não ganha nem perde prioridade por ser web.

O resultado é um `RetrievedDoc`, que é uma união: `CorpusDoc` (`kind: 'cvm'`, com ticker, período, data-base e parágrafo) ou `WebDoc` (`kind: 'web'`, com título e conteúdo). O `kind` diz quais campos existem.

### `grade`

Pede ao LLM uma saída estruturada validada por zod — `{ sufficient: boolean, missingAspects: string[] }` — e nunca faz parsing de texto livre para decidir rota.

A regra central do prompt: **documento CVM nunca basta para pergunta qualitativa** (motivo por trás de um número, notícia, fato relevante, guidance, previsão de preço), mesmo sendo da empresa e do trimestre certos — o corpus só tem números. Uma pergunta assim só fica suficiente se um documento **Web** tratar dela diretamente. Se a regra valesse para o contexto inteiro, a segunda volta do loop nunca seria suficiente.

Cada item de `missingAspects` é escrito como termo de busca, porque é o que o `webSearch` usa.

### Provedores de busca

`SearchProvider` é a interface mínima — `search(query): Promise<SearchResult[]>` — com duas implementações reais, ambas com `fetch` nativo e sem SDK:

| `SEARCH_PROVIDER` | Variáveis exigidas |
|---|---|
| `serper` (padrão) | `SERPER_API_KEY` |
| `google` | `GOOGLE_CUSTOM_SEARCH_API_KEY`, `GOOGLE_CUSTOM_SEARCH_CX` |

`criarSearchProvider()` confere as variáveis antes de qualquer busca e lança `SearchConfigError` citando a que falta. A resposta de cada provedor é validada com zod; busca sem resultado vira lista vazia, e qualquer outro desvio vira `SearchProviderError`.

**Resiliência.** Cada provedor real passa ao `fetch` um `AbortSignal.timeout(SEARCH_TIMEOUT_MS)` (10 s): uma API travada vira erro em vez de prender o grafo. Por cima disso, `criarSearchProvider()` envolve o provedor escolhido com `comResiliencia()` (`search/com-resiliencia.ts`), que acrescenta duas camadas sem o provedor saber:

- **Retry com backoff exponencial** — até 3 tentativas, esperando 500 ms e depois 1000 ms.
- **Circuit breaker** — 3 buscas seguidas falhando (já depois do retry) abrem o circuito; por 30 s, toda busca falha na hora com `CircuitoAbertoError`, sem chamar o provedor. Passado o resfriamento, a próxima busca é liberada: se der certo o circuito fecha, se falhar reabre.

A espera entre tentativas (`esperar`) e o relógio (`agora`) entram como opção, e os testes passam versões falsas — nenhum teste espera de verdade. O provedor do modo demo não passa por essa camada: não há rede ali para proteger.

### Modo demo (`DEMO=true`)

Para gravar o fallback de busca web sem depender do Serper no ar. Com `DEMO=true`, `criarSearchProvider()` devolve um provedor que responde das fixtures de `src/demo/fixtures.ts`, e `criarFetchPage()` devolve um `fetchPage` que entrega o HTML das mesmas fixtures — nenhuma chave de busca é exigida e nenhuma requisição sai para a web. `grade`, `answer` e os embeddings continuam na Vertex AI de verdade, e as páginas da fixture são gravadas em `documentos_web` como qualquer outra.

Cada fábrica lê `DEMO` uma vez e é o único lugar que lê para aquela dependência; `serper.ts`, `google-custom-search.ts` e `fetch-page.ts` não sabem que o modo existe.

A fixture é escolhida por substring do ticker ou do nome da empresa na query, sem diferenciar maiúscula de minúscula. Cobre as perguntas B01, B02 (Vale), B03 (Petrobras) e B05 (Klabin) do `evals/dataset.json`; qualquer outra cai numa fixture genérica que diz não ter resultado — nunca lança erro. O conteúdo é escrito para a demonstração: as URLs ficam no domínio reservado `demo.invalid` e os títulos começam com `[DEMO]`, para a citação na resposta deixar claro que a fonte não é real.

### `webSearch`

1. Monta uma query por aspecto faltante (`${question} ${aspecto}`), ou só a pergunta se não houver aspectos.
2. Para cada query, pega os 3 primeiros resultados e pula URL que outra query já trouxe. Se a busca lançar erro — provedor fora do ar, `CircuitoAbertoError` —, a query é pulada com um `console.warn` e o nó segue para a próxima. Se todas falharem, o nó não grava nada: o `retrieve` volta com o mesmo contexto do corpus, o guard de iteração encerra o loop e o `answer` responde avisando que o contexto é incompleto.
3. Baixa as páginas com `Promise.allSettled`: página fora do ar, em timeout ou que não é HTML é descartada, e as outras seguem.
4. Extrai o texto, divide em chunks, gera os embeddings e grava um registro por chunk, com `expiresAt = fetchedAt + ttlDays`.

O nó não devolve documentos para o estado. Quem os traz de volta é o `retrieve` na próxima volta — o mesmo caminho de qualquer documento.

### `answer` e o guardrail

A consultoria de valores mobiliários é atividade regulada pela CVM: **o sistema informa, nunca recomenda.** São duas barreiras:

1. **O prompt** (`prompts/answer.ts`) proíbe recomendar comprar, vender ou manter — mesmo quando a pergunta pede diretamente —, manda responder só com o contexto, sem inventar número, citar cada informação como `[n]` com a data-base, e avisar no início quando o contexto for incompleto.
2. **O filtro determinístico** (`answer/format-resposta.ts`) roda sobre o texto do LLM. Se encontrar linguagem recomendatória — verbo em primeira pessoa (recomendo, sugiro, aconselho e plurais), "minha recomendação", "vale a pena comprar", "você deveria vender", "é um bom momento para investir" — troca a resposta inteira por um aviso fixo. O filtro é conservador de propósito: "não recomendo" também casa. Errar para esse lado só troca o texto por uma mensagem segura; o erro oposto deixaria passar uma recomendação.

Nos dois casos, a resposta sai com um **bloco de fontes** no final, um item por fonte:

```
Fontes:
[1] PETR — 3T25, data-base 30/09/2025 (CVM) — https://dados.cvm.gov.br/.../itr_cia_aberta_2025.zip
[2] Petrobras explica queda no lucro — https://exemplo.com/petrobras
```

A deduplicação **não é só pela URL**: no corpus CVM, a URL é o ZIP anual da CVM, igual para as 20 empresas (os 80 documentos têm só 3 URLs distintas). A chave é ticker + período para o corpus e URL para a web — aí sim vários chunks da mesma página viram uma fonte só. O prompt numera os documentos pela mesma chave, então o `[n]` citado pelo LLM bate com a lista.

O estado guarda a resposta em `finalAnswer`, e não em `answer`: o LangGraph proíbe campo de estado com o mesmo nome de um nó.

## Como o grafo chega ao cliente: `POST /api/chat`

A rota fica em `apps/api/src/routes/chat.ts` e transmite a execução do grafo como Server-Sent Events — **um evento por nó concluído**, não por token.

```
POST /api/chat   { "question": "Por que o lucro da PETR caiu?" }

data: {"type":"retrieve","documents":[{"kind":"cvm","ticker":"PETR","period":"3T25",...}]}
data: {"type":"grade","sufficient":false,"missingAspects":["motivo da queda"],"iterations":1}
data: {"type":"webSearch"}
data: {"type":"retrieve","documents":[{"kind":"web","title":"Petrobras explica queda",...}]}
data: {"type":"grade","sufficient":true,"missingAspects":[],"iterations":2}
data: {"type":"answer","answer":"O lucro caiu por causa do Brent [1].\n\nFontes: ..."}
```

- **Entrada:** validada pelo `chatRequestSchema` de `@hero/contracts` (`question` sem espaços nas pontas, de 1 a 1000 caracteres). Inválida → 400 em `application/problem+json`, sem chamar o grafo.
- **Headers escritos à mão:** `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` e `Connection: keep-alive`. Sem o `no-transform`, o Cloud Run bufferiza a resposta inteira e ela chega de uma vez.
- **Tradução dos eventos** (`apps/api/src/routes/chat-event.ts`): o `retrieve` vira um resumo dos documentos, sem o texto; o `grade` leva `sufficient`, `missingAspects` e `iterations`; o `webSearch` vai só com o nome, porque não produz campo de estado; o `answer` leva o texto final.
- **`iterations` no evento é o total.** O update do `grade` traz o incremento (`1`) que o reducer soma; a rota soma os incrementos para o cliente ver a contagem real.
- **Erro no meio do stream:** vai para o log, o cliente recebe `{"type":"error","message":...}` com mensagem genérica (sem detalhe interno), a conexão fecha e o processo segue de pé.
- **Cancelamento:** o grafo recebe um `signal` que dispara se o cliente fechar a conexão — para não pagar LLM para ninguém — ou após 60 s.
- **`GraphLike`:** a rota depende só de uma interface com o método `stream`. O grafo real do `buildGraph` a satisfaz (conferido pelo compilador), e o teste usa um grafo fake de poucas linhas, sem LLM nem Postgres.

A rota só é registrada quando `build()` recebe um grafo. O `index.ts` da API ainda não monta um — ver pendências.

## Testes

```bash
pnpm --filter @hero/agent test
```

Nenhum teste usa rede ou banco:

- **LLM:** `FakeListChatModel` do `@langchain/core`, que também atende `withStructuredOutput` lendo a resposta como JSON.
- **Embeddings:** `FakeEmbeddings` do `@langchain/core`, ou uma classe fake mínima.
- **HTTP:** `vi.stubGlobal('fetch', ...)` nos provedores de busca e no `fetchPage`.
- **SQL:** `drizzle.mock()` monta a consulta sem conexão; o teste confere o SQL gerado (operador `<=>`, filtro de expirados).
- **Grafo inteiro:** `buildGraph` com todas as dependências fake; o teste coleta os nós visitados com `app.stream(..., { streamMode: 'updates' })` e confere o caminho direto, o loop completo e o guard parando em `MAX_ITERATIONS`.

O teste de guardrail em `src/nodes/answer.test.ts` — "Devo comprar PETR4?" com o LLM fake recomendando — é obrigatório e não pode ser removido. Se ele quebrar, o problema é o comportamento, não o teste.

## Comandos

```bash
pnpm db:migrate     # aplica as migrations (usa DATABASE_URL)
pnpm seed           # popula documentos a partir dos JSONs do corpus
pnpm --filter @hero/agent run db:generate   # gera migration a partir do schema.ts
```

Variáveis de ambiente usadas pelo pacote: `DATABASE_URL`, `MODEL_EMBEDDING`, `MODEL_GRADE`, `MODEL_ANSWER`, `SEARCH_PROVIDER` e as chaves do provedor de busca (tabela acima), e `DEMO` (opcional, `true` liga o modo demo). Nenhuma delas vai para arquivo versionado; em produção, vêm do Secret Manager.

## Dependências e versões

- `@langchain/langgraph` está fixado em `1.5.3`, o último patch da minor anterior: a `1.6.0` tinha só dois dias quando o grafo foi montado. Não há conflito de peer com `@langchain/core` 1.3.2 nem com zod 4.

## Pendências conhecidas

- **Migration `0002_create-documentos-web` não aplicada no Cloud SQL.** No Postgres local do `docker-compose` as três migrations já rodaram. Para o Cloud SQL falta autenticação no Google Cloud (gcloud + `cloud-sql-proxy`) ou um passo de migration no `deploy.yml`.
- **O `/api/chat` ainda não está ligado em produção.** A rota existe e está testada, mas o `index.ts` da API não monta o grafo com clientes reais (Vertex, Postgres, provedor de busca). `apps/api` já depende de `@hero/agent`, mas o pacote só exporta `@hero/agent/search` (usado pelo error handler para reconhecer `CircuitoAbertoError`); falta exportar o `buildGraph` e as fábricas dos clientes — além das variáveis `MODEL_*` e da chave de busca no Cloud Run.
- **`ChatEvent` mora em `apps/api`.** Quando o Angular consumir o stream, o tipo deve ir para `@hero/contracts`, para os dois lados compartilharem o mesmo contrato.
- **Duplicatas em `documentos_web`.** Não há índice único: se a mesma pergunta passar duas vezes pelo `webSearch`, as mesmas páginas são gravadas de novo e os chunks repetidos podem ocupar o top-k. Uma opção é índice único em (`source_url`, posição do chunk) com upsert.
- **Sem limite de chunks por página.** Uma página de 50 mil caracteres gera uns 55 chunks, e o `embedDocuments` dispara uma chamada à Vertex por chunk, todas em paralelo — o problema que o seed resolveu com lotes de 10.
- **A regra qualitativa do `grade` não é provada pelos testes.** O fake só mostra que o nó repassa o que o LLM diz; se o modelo real obedece ao prompt se mede contra o `evals/dataset.json`.
- **O retry repete qualquer erro, inclusive os que não passam sozinhos.** Um 401 (chave errada) ou uma resposta fora do schema também gasta as 3 tentativas e conta para o circuit breaker. Distinguir erro passageiro de permanente exigiria o `SearchProviderError` carregar o status HTTP.
- **O pior caso de uma busca passa de 30 s.** São 3 tentativas de até 10 s cada, mais 1,5 s de backoff. O `webSearch` faz uma busca por aspecto faltante, uma depois da outra, então duas buscas travadas já estouram o timeout de 60 s do `/api/chat` antes de o circuito abrir.
- **Páginas do modo demo ficam em `documentos_web`.** Depois de uma gravação com `DEMO=true`, os chunks com `source_url` em `https://demo.invalid/` continuam recuperáveis por até 7 dias (TTL), também fora do modo demo. Apague-os antes de voltar ao uso normal no mesmo banco.
- **Sem `.env.example`.** As variáveis estão documentadas aqui e nos comentários do código; as chaves de busca ainda precisam entrar no Secret Manager e no deploy do Cloud Run.
