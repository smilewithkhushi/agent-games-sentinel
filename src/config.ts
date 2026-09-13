import { z } from 'zod';

const schema = z.object({
  AGENT_GAMES_HMAC_SECRET: z.string().min(1),
  REFERENCE_AGENT_MODE: z.enum(['normal', 'late', 'invalid_signature', 'invalid_json']).default('normal'),
  REFERENCE_AGENT_DELAY_MS: z.coerce.number().int().min(0).max(25000).default(0),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CACHE_BACKEND: z.enum(['memory', 'redis']).default('memory'),
  AGENT_NAMESPACE: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).default('reference-local'),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  VERCEL: z.string().optional(),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error('Invalid configuration: ' + result.error.issues.map(i => i.path.join('.')).join(', '));
  const config = result.data;
  if (config.VERCEL && config.CACHE_BACKEND !== 'redis') throw new Error('Vercel requires CACHE_BACKEND=redis');
  if (config.CACHE_BACKEND === 'redis') {
    let url: URL;
    try { url = new URL(config.UPSTASH_REDIS_REST_URL ?? ''); } catch { throw new Error('Invalid Redis URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Redis URL must be an HTTPS origin');
    if (!config.UPSTASH_REDIS_REST_TOKEN) throw new Error('Redis token is required');
  }
  return config;
}
