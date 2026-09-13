import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/application.js';
import { readConfig } from '../src/config.js';
import { sign, verify } from '../src/crypto.js';
import { MemoryStore, RedisStore, type Replay } from '../src/cache.js';
import { decideVfy } from '../src/games.js';
const secret = 'local-test-secret-not-a-platform-credential';
const task = () => ({ type: 'agent-games.proof-gatekeeper.v1', task_id: 'practice_test', deadline_at: new Date(Date.now() + 60000).toISOString(), input: { registered_vk: '0xabc', proof_vk: '0xabc', proof_valid: true, minimum: '1000', public_balance: '1460' } });
function setup(env: Record<string, string> = {}, options: Parameters<typeof buildApp>[1] = {}) {
  return buildApp(readConfig({ AGENT_GAMES_HMAC_SECRET: secret, ...env }), options);
}
function request(app: ReturnType<typeof setup>, payload: unknown) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return app.inject({ method: 'POST', url: '/agent', headers: { 'content-type': 'application/json', 'x-agent-games-signature': sign(body, secret) }, payload: body });
}
test('HMAC matches the RFC 4231 SHA-256 test vector', () => {
  assert.equal(sign('Hi There', '\x0b'.repeat(20)), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
});
test('HMAC uses exact bytes and rejects malformed/wrong signatures', () => {
  const raw = Buffer.from('{ "hello": "world" }');
  assert.equal(verify(raw, sign(raw, secret), secret), true);
  for (const signature of [undefined, '', 'gg'.repeat(32), '0'.repeat(64), [sign(raw, secret)]]) assert.equal(verify(raw, signature, secret), false);
  assert.equal(verify(Buffer.from('{"hello":"world"}'), sign(raw, secret), secret), false);
});
test('health and wrong methods', async t => {
  const app = setup(); t.after(() => app.close());
  assert.deepEqual((await app.inject('/health')).json(), { ok: true });
  assert.equal((await app.inject('/agent')).statusCode, 404);
});
for (const [label, patch, reason] of [
  ['approve', {}, 'CONDITION_VALID'],
  ['invalid proof first', { proof_valid: false, proof_vk: 'other', public_balance: '0' }, 'PROOF_INVALID'],
  ['substituted key', { proof_vk: 'other', public_balance: '0' }, 'VK_SUBSTITUTION'],
  ['low balance', { public_balance: '999' }, 'THRESHOLD_MISMATCH'],
  ['equal threshold', { public_balance: '1000' }, 'CONDITION_VALID'],
  ['large exact integer', { public_balance: '9007199254740992', minimum: '9007199254740993' }, 'THRESHOLD_MISMATCH'],
] as const) {
  test(`Gatekeeper: ${label}`, async t => {
    const app = setup(); t.after(() => app.close());
    const payload = task(); Object.assign(payload.input, patch);
    const res = await request(app, payload);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { decision: reason === 'CONDITION_VALID' ? 'APPROVE' : 'REJECT', reason_code: reason });
    assert.equal(res.headers['x-agent-games-signature'], sign(res.body, secret));
    assert.match(String(res.headers['content-type']), /application\/json/);
    assert.equal(res.headers['cache-control'], 'no-store');
  });
}
test('authentication, JSON, schema, content type and size errors', async t => {
  const app = setup(); t.after(() => app.close());
  for (const signature of [undefined, 'bad', '0'.repeat(64)]) {
    const res = await app.inject({ method: 'POST', url: '/agent', payload: '{', headers: { 'content-type': 'application/json', ...(signature ? { 'x-agent-games-signature': signature } : {}) } });
    assert.equal(res.statusCode, 401);
  }
  assert.equal((await request(app, '{')).statusCode, 400);
  for (const payload of [{ ...task(), extra: true }, { ...task(), deadline_at: 'yesterday' }, { ...task(), input: { ...task().input, proof_valid: 'true' } }, { ...task(), input: { ...task().input, minimum: '-1' } }, null]) assert.equal((await request(app, payload)).statusCode, 400);
  assert.equal((await request(app, 'x'.repeat(16385))).statusCode, 413);
  assert.equal((await app.inject({ method: 'POST', url: '/agent', headers: { 'content-type': 'text/plain', 'x-agent-games-signature': sign('hi', secret) }, payload: 'hi' })).statusCode, 415);
  assert.equal((await request(app, { eventId: 'steal-the-vfy' })).statusCode, 400);
});
test('concurrent retries across app instances return identical bytes; conflicting input is rejected', async t => {
  const store = new MemoryStore();
  const a = setup({}, { store }); const b = setup({}, { store });
  t.after(() => Promise.all([a.close(), b.close()]));
  const payload = task();
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => request(i % 2 ? a : b, payload)));
  for (const res of responses) { assert.equal(res.statusCode, 200); assert.equal(res.body, responses[0]!.body); assert.equal(res.headers['x-agent-games-signature'], responses[0]!.headers['x-agent-games-signature']); }
  assert.equal((await request(a, { ...payload, input: { ...payload.input, public_balance: '0' } })).statusCode, 409);
});
test('expired requests skip intentional delay; late mode waits past 15 seconds', async t => {
  const delays: number[] = [];
  const app = setup({ REFERENCE_AGENT_MODE: 'late' }, { wait: async ms => { delays.push(ms); } }); t.after(() => app.close());
  assert.equal((await request(app, task())).statusCode, 200);
  assert.deepEqual(delays, [16000]);
  assert.equal((await request(app, { ...task(), task_id: 'expired', deadline_at: '2020-01-01T00:00:00.000Z' })).statusCode, 200);
  assert.deepEqual(delays, [16000]);
});
test('failure modes are authenticated and repeatable', async t => {
  for (const mode of ['invalid_signature', 'invalid_json']) {
    const app = setup({ REFERENCE_AGENT_MODE: mode }); t.after(() => app.close());
    const payload = task(); const first = await request(app, payload); const second = await request(app, payload);
    assert.equal(first.statusCode, 200); assert.equal(first.body, second.body);
    if (mode === 'invalid_json') { assert.throws(() => JSON.parse(first.body)); assert.equal(first.headers['x-agent-games-signature'], sign(first.body, secret)); }
    else assert.notEqual(first.headers['x-agent-games-signature'], sign(first.body, secret));
  }
});
test('cache outages fail safely', async t => {
  const app = setup({}, { store: { get: async () => { throw new Error('sensitive backend error'); }, putIfAbsent: async (_key, value) => value } }); t.after(() => app.close());
  const response = await request(app, task());
  assert.equal(response.statusCode, 503); assert.equal(response.body.includes('sensitive'), false);
});
test('VFY action boundaries', () => {
  assert.deepEqual(decideVfy(9n, 100n), { type: 'HOLD' });
  assert.deepEqual(decideVfy(10n, 25n), { type: 'FORTIFY' });
  assert.deepEqual(decideVfy(10n, 24n), { type: 'EXTRACT', amount: 5 });
  assert.deepEqual(decideVfy(30n, 0n), { type: 'EXTRACT', amount: 5 });
  assert.throws(() => decideVfy(-1n, 0n));
});
test('memory cache expiration and capacity preserve unexpired replies', async () => {
  let now = 0; const store = new MemoryStore(() => now, 1);
  const value = { body: '{}', signature: 'sig', fingerprint: 'fp' };
  await store.putIfAbsent('a', value);
  await assert.rejects(store.putIfAbsent('b', value));
  now = 599999; assert.deepEqual(await store.get('a'), value);
  now = 600000; assert.equal(await store.get('a'), null);
  assert.deepEqual(await store.putIfAbsent('b', value), value);
});
test('Redis adapter uses expiring atomic insert and reads the winner', async () => {
  const commands: unknown[] = []; const winner: Replay = { body: '{}', signature: 'sig', fingerprint: 'fp' };
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    commands.push(JSON.parse(String(init?.body)));
    return Response.json({ result: commands.length === 1 ? null : JSON.stringify(winner) });
  };
  const store = new RedisStore('https://example.com', 'test-token', fetcher);
  assert.deepEqual(await store.putIfAbsent('key', winner), winner);
  assert.deepEqual(commands, [['SET', 'key', JSON.stringify(winner), 'NX', 'EX', 600], ['GET', 'key']]);
});
test('Redis error responses do not become cached replies', async () => {
  for (const response of [Response.json({ error: 'backend failure' }), Response.json({ result: 42 }), new Response('unavailable', { status: 503 })]) {
    const store = new RedisStore('https://example.com', 'test', async () => response);
    await assert.rejects(store.get('key'));
  }
});
test('configuration rejects unsafe or incomplete deployment settings', () => {
  assert.throws(() => readConfig({}));
  assert.throws(() => readConfig({ AGENT_GAMES_HMAC_SECRET: secret, VERCEL: '1' }));
  assert.throws(() => readConfig({ AGENT_GAMES_HMAC_SECRET: secret, REFERENCE_AGENT_MODE: 'unavailable' }));
  assert.throws(() => readConfig({ AGENT_GAMES_HMAC_SECRET: secret, CACHE_BACKEND: 'redis', UPSTASH_REDIS_REST_URL: 'http://example.com', UPSTASH_REDIS_REST_TOKEN: 'token' }));
  assert.equal(readConfig({ AGENT_GAMES_HMAC_SECRET: secret, VERCEL: '1', CACHE_BACKEND: 'redis', UPSTASH_REDIS_REST_URL: 'https://example.com', UPSTASH_REDIS_REST_TOKEN: 'token' }).CACHE_BACKEND, 'redis');
});
