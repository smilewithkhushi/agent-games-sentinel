import Fastify, { LogController } from 'fastify';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Config } from './config.js';
import { digest, sign, verify } from './crypto.js';
import { prepareTask } from './tasks.js';
import type { Replay } from './cache.js';
import { MemoryStore, RedisStore, type ReplayStore } from './cache.js';

export function buildApp(config: Config, options: { store?: ReplayStore; logger?: boolean; wait?: (ms: number) => Promise<unknown> } = {}) {
  const app = Fastify({ bodyLimit: 16384, logger: options.logger ?? false, logController: new LogController({ disableRequestLogging: true }) });
  const store = options.store ?? (config.CACHE_BACKEND === 'redis'
    ? new RedisStore(config.UPSTASH_REDIS_REST_URL!, config.UPSTASH_REDIS_REST_TOKEN!) : new MemoryStore());
  const wait = options.wait ?? sleep;
  const namespace = `${config.AGENT_NAMESPACE}:${config.REFERENCE_AGENT_MODE}:${digest(config.AGENT_GAMES_HMAC_SECRET)}`;
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (request.method === 'POST' && request.url.split('?')[0] === '/agent') {
      const signature = request.headers['x-agent-games-signature'];
      if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature)) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    const code = status && status >= 400 && status < 500 ? status : 500;
    request.log.warn({ requestId: request.id, status: code }, 'Request rejected');
    reply.code(code).send({ error: code === 413 ? 'BODY_TOO_LARGE' : code === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'REQUEST_FAILED' });
  });
  app.get('/health', async () => ({ ok: true }));
  app.post('/agent', async (request, reply) => {
    const raw = request.body;
    if (!Buffer.isBuffer(raw) || !verify(raw, request.headers['x-agent-games-signature'], config.AGENT_GAMES_HMAC_SECRET)) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch { return reply.code(400).send({ error: 'INVALID_JSON' }); }
    const task = prepareTask(payload);
    if (!task) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const expired = task.deadline <= Date.now();
    const key = `{${digest(namespace)}}:${task.family}:${task.cacheId}`;
    const fingerprint = task.fingerprint;
    const encode = (response: object): Replay => {
      const body = config.REFERENCE_AGENT_MODE === 'invalid_json' ? '{"response":' : JSON.stringify(response);
      const correct = sign(body, config.AGENT_GAMES_HMAC_SECRET);
      // Flip one nibble so a deliberately bad signature can never equal the real one.
      const signature = config.REFERENCE_AGENT_MODE === 'invalid_signature' ? (correct[0] === '0' ? '1' : '0') + correct.slice(1) : correct;
      return { body, signature, fingerprint };
    };
    try {
      let record = await store.get(key);
      if (!record) {
        record = await store.putIfAbsent(key, encode(task.createResponse()), task.proofId && task.reusedResponse ? {
          proofKey: `{${digest(namespace)}}:proof:${task.proofId}`,
          reused: encode(task.reusedResponse),
        } : undefined);
      }
      if (record.fingerprint !== fingerprint) return reply.code(409).send({ error: 'IDEMPOTENCY_CONFLICT' });
      const delay = config.REFERENCE_AGENT_MODE === 'late' ? Math.max(16000, config.REFERENCE_AGENT_DELAY_MS) : config.REFERENCE_AGENT_DELAY_MS;
      if (!expired && delay) await wait(delay);
      request.log.info({ requestId: request.id, game: task.family, expired }, 'Agent response');
      return reply.type('application/json').header('x-agent-games-signature', record.signature).send(record.body);
    } catch {
      request.log.warn({ requestId: request.id }, 'Replay storage or response unavailable');
      return reply.code(503).send({ error: 'SERVICE_UNAVAILABLE' });
    }
  });
  return app;
}
