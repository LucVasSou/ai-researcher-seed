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
    index.ts            criarSearchProvider(): escolhe pelo SEARCH_PROVIDER
  web/
    fetch-page.ts       baixa o HTML de uma URL, com timeout de 10 s
    extract-text.ts     HTML → texto corrido (regex, sem parser de DOM)
    chunk-text.ts       chunks de 1000 caracteres com sobreposição de 100
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

### `webSearch`

1. Monta uma query por aspecto faltante (`${question} ${aspecto}`), ou só a pergunta se não houver aspectos.
2. Para cada query, pega os 3 primeiros resultados e pula URL que outra query já trouxe.
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

Variáveis de ambiente usadas pelo pacote: `DATABASE_URL`, `MODEL_EMBEDDING`, `MODEL_GRADE`, `MODEL_ANSWER`, `SEARCH_PROVIDER` e as chaves do provedor de busca (tabela acima). Nenhuma delas vai para arquivo versionado; em produção, vêm do Secret Manager.

## Dependências e versões

- `@langchain/langgraph` está fixado em `1.5.3`, o último patch da minor anterior: a `1.6.0` tinha só dois dias quando o grafo foi montado. Não há conflito de peer com `@langchain/core` 1.3.2 nem com zod 4.

## Pendências conhecidas

- **Migration `0002_create-documentos-web` não aplicada.** Falta rodar `pnpm db:migrate` no Postgres local e no Cloud SQL.
- **Ninguém monta o grafo com clientes reais ainda.** O `GraphDeps` com Vertex, Postgres e provedor de busca entra com a rota `POST /chat` (D.10).
- **Duplicatas em `documentos_web`.** Não há índice único: se a mesma pergunta passar duas vezes pelo `webSearch`, as mesmas páginas são gravadas de novo e os chunks repetidos podem ocupar o top-k. Uma opção é índice único em (`source_url`, posição do chunk) com upsert.
- **Sem limite de chunks por página.** Uma página de 50 mil caracteres gera uns 55 chunks, e o `embedDocuments` dispara uma chamada à Vertex por chunk, todas em paralelo — o problema que o seed resolveu com lotes de 10.
- **A regra qualitativa do `grade` não é provada pelos testes.** O fake só mostra que o nó repassa o que o LLM diz; se o modelo real obedece ao prompt se mede contra o `evals/dataset.json`.
- **Sem `.env.example`.** As variáveis estão documentadas aqui e nos comentários do código; as chaves de busca ainda precisam entrar no Secret Manager e no deploy do Cloud Run.
