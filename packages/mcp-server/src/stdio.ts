import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { obterGrafoReal } from '@hero/agent/grafo-real';
import { criarServidor } from './server.js';

/**
 * Ponto de entrada do transporte stdio: o cliente MCP (Claude Code, Claude
 * Desktop) inicia este processo e conversa com ele pela entrada e saída padrão.
 *
 * O grafo real não é construído aqui: `obterGrafoReal` só monta Postgres e Vertex AI
 * na primeira chamada da tool. O processo sobe e responde ao `tools/list` mesmo
 * sem banco nem credenciais.
 *
 * Nada pode escrever no stdout além do SDK — qualquer `console.log` corromperia o
 * protocolo. Logs vão para o stderr (`console.error`, `console.warn`).
 */
const server = criarServidor(obterGrafoReal);
await server.connect(new StdioServerTransport());
