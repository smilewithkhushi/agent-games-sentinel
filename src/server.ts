import type { FastifyInstance } from 'fastify';
import { buildApp } from './application.js';
import { readConfig } from './config.js';
export const config = { maxDuration: 30 };
const runtimeConfig = readConfig();
const app: FastifyInstance = buildApp(runtimeConfig, { logger: true });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
}
await app.listen({ port: runtimeConfig.PORT, host: '0.0.0.0' });
