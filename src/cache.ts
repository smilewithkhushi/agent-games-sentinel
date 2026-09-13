import { z } from 'zod';
const recordSchema = z.strictObject({ body: z.string(), signature: z.string(), fingerprint: z.string() });
export type Replay = z.infer<typeof recordSchema>;
export type ProofClaim = { proofKey: string; reused: Replay };
export interface ReplayStore {
  get(key: string): Promise<Replay | null>;
  putIfAbsent(key: string, value: Replay, proof?: ProofClaim): Promise<Replay>;
}
export class MemoryStore implements ReplayStore {
  private records = new Map<string, { value: Replay; expires: number }>();
  private proofOwners = new Map<string, string>();
  constructor(private now = Date.now, private capacity = 10000) {}
  async get(key: string) {
    const entry = this.records.get(key);
    if (!entry) return null;
    if (entry.expires <= this.now()) { this.records.delete(key); return null; }
    return entry.value;
  }
  async putIfAbsent(key: string, value: Replay, proof?: ProofClaim) {
    // No await between lookup and insertion: concurrent callers share one winner.
    const now = this.now();
    for (const [k, entry] of this.records) if (entry.expires <= now) this.records.delete(k);
    const existing = this.records.get(key);
    if (existing) return existing.value;
    if (this.records.size >= this.capacity) throw new Error('Cache capacity reached');
    if (proof) {
      const owner = this.proofOwners.get(proof.proofKey);
      if (owner && owner !== key) value = proof.reused;
      else if (!owner) {
        if (this.proofOwners.size >= this.capacity) throw new Error('Proof ledger capacity reached');
        this.proofOwners.set(proof.proofKey, key);
      }
    }
    this.records.set(key, { value, expires: now + 600000 });
    return value;
  }
}
export class RedisStore implements ReplayStore {
  constructor(private url: string, private token: string, private fetcher: typeof fetch = fetch) {}
  private async command(args: (string | number)[]): Promise<unknown> {
    const response = await this.fetcher(this.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(2000),
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error('Cache unavailable');
    const data = await response.json() as { result?: unknown; error?: unknown };
    if (data.error || !Object.hasOwn(data, 'result')) throw new Error('Cache unavailable');
    return data.result;
  }
  async get(key: string) {
    const value = await this.command(['GET', key]);
    if (value === null) return null;
    if (typeof value !== 'string') throw new Error('Invalid cache record');
    return recordSchema.parse(JSON.parse(value));
  }
  async putIfAbsent(key: string, value: Replay, proof?: ProofClaim) {
    if (proof) {
      // One transaction binds the proof owner and replay result; there is no
      // crash window where a retry loses its originally approved response.
      const result = await this.command(['EVAL', CLAIM_AND_CACHE, 2, key, proof.proofKey, JSON.stringify(value), JSON.stringify(proof.reused)]);
      if (typeof result !== 'string') throw new Error('Invalid cache record');
      return recordSchema.parse(JSON.parse(result));
    }
    const result = await this.command(['SET', key, JSON.stringify(value), 'NX', 'EX', 600]);
    if (result === 'OK') return value;
    if (result !== null) throw new Error('Invalid cache result');
    const winner = await this.get(key);
    if (!winner) throw new Error('Cache record expired during replay');
    return winner;
  }
}

// Hash-only proof ownership persists across rounds, beyond the ten-minute response TTL.
const CLAIM_AND_CACHE = `
local cached = redis.call('GET', KEYS[1])
if cached then return cached end
local owner = redis.call('GET', KEYS[2])
local result = ARGV[1]
if owner and owner ~= KEYS[1] then
  result = ARGV[2]
else
  redis.call('SET', KEYS[2], KEYS[1])
end
redis.call('SET', KEYS[1], result, 'EX', 600)
return result
`;
