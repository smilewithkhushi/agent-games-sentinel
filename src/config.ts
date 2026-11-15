import { z } from 'zod';

// Platform circuit verification-key hash, registered on zkVerify mainnet (Agent Games build
// playbook). It is public and shared by all agents using the platform's vfy-policy circuit.
// Defaulting here makes a stale/placeholder env value (e.g. 'your_hash_here') self-heal instead
// of silently disabling the on-chain proof anchor.
const DEFAULT_ZKVERIFY_VFY_VK_HASH =
  '0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047';
const vkHash = z.string().optional().transform((v) =>
  v && /^0x[a-f0-9]{64}$/i.test(v) ? v : DEFAULT_ZKVERIFY_VFY_VK_HASH);

const schema = z.object({
  AGENT_GAMES_HMAC_SECRET: z.string().min(1),
  REFERENCE_AGENT_MODE: z.enum(['normal', 'late', 'invalid_signature', 'invalid_json']).default('normal'),
  REFERENCE_AGENT_DELAY_MS: z.coerce.number().int().min(0).max(25000).default(0),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CACHE_BACKEND: z.enum(['memory', 'redis']).default('memory'),
  AGENT_NAMESPACE: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).default('reference-local'),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  KURIER_API_KEY: z.string().optional(),
  ZKVERIFY_VFY_VK_HASH: vkHash,
  // Salt source for the VFY Poseidon strategy commitment. Defaults to AGENT_GAMES_HMAC_SECRET, but
  // can be pinned separately so rotating the signing secret never changes (and thus never
  // invalidates) the registered commitment. Set this to the secret that produced the commitment
  // currently registered on the platform.
  VFY_COMMITMENT_SECRET: z.string().optional(),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error('Invalid configuration: ' + result.error.issues.map(i => i.path.join('.')).join(', '));
  const config = result.data;
  if (config.CACHE_BACKEND === 'redis') {
    let url: URL;
    try { url = new URL(config.UPSTASH_REDIS_REST_URL ?? ''); } catch { throw new Error('Invalid Redis URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Redis URL must be an HTTPS origin');
    if (!config.UPSTASH_REDIS_REST_TOKEN) throw new Error('Redis token is required');
  }
  return config;
}
