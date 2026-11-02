import Fastify from 'fastify';
import { obterGrafoReal } from '@hero/agent/grafo-real';
import { mcpHttpPlugin } from './http-plugin.js';

/**
 * Ponto de entrada do servidor MCP standalone via Streamable HTTP, em
 * http://127.0.0.1:${MCP_HTTP_PORT}/mcp (padrão 3100).
 *
 * Escuta só em 127.0.0.1: é um servidor para uso local (um cliente MCP na mesma
 * máquina). Para fora, o caminho é o gateway /api/mcp do apps/api.
 *
 * Como no stdio, o grafo real só é construído na primeira chamada da tool.
 */
const app = Fastify({ logger: true });
app.register(mcpHttpPlugin, { getGraph: obterGrafoReal });

const port = Number(process.env.MCP_HTTP_PORT ?? 3100);
await app.listen({ port, host: '127.0.0.1' });
