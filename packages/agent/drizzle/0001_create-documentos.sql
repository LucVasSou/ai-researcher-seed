CREATE TABLE "documentos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "documentos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ticker" text NOT NULL,
	"company_name" text NOT NULL,
	"setor" text NOT NULL,
	"period" text NOT NULL,
	"period_end" date NOT NULL,
	"receita_liquida" bigint NOT NULL,
	"lucro_bruto" bigint NOT NULL,
	"lucro_liquido" bigint NOT NULL,
	"ativo_total" bigint NOT NULL,
	"patrimonio_liquido" bigint NOT NULL,
	"caixa_operacional" bigint NOT NULL,
	"receita_mesmo_trimestre_ano_anterior" bigint,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"paragraph" text NOT NULL,
	"embedding" vector(768) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "documentos_ticker_period_idx" ON "documentos" USING btree ("ticker","period");--> statement-breakpoint
CREATE INDEX "documentos_embedding_idx" ON "documentos" USING hnsw ("embedding" vector_cosine_ops);