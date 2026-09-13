import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/application.js';
import { readConfig } from '../../src/config.js';
import { sign, verify } from '../../src/crypto.js';
import { preflight, vfy } from '../fixtures/requests.js';
const secret = 'local-http-integration-only';
async function start(mode = 'normal') {
  const app = buildApp(readConfig({ AGENT_GAMES_HMAC_SECRET: secret, REFERENCE_AGENT_MODE: mode }));
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, origin };
}
async function send(origin: string, payload: unknown, timeout = 3000, signed = true) {
  const body = JSON.stringify(payload);
  return fetch(`${origin}/agent`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout), headers: { 'content-type': 'application/json', ...(signed ? { 'x-agent-games-signature': sign(body, secret) } : {}) }, body });
}
test('actual HTTP: health, preflight, both VFY envelopes, retries, and unavailable endpoint', async () => {
  const { app, origin } = await start();
  try {
    assert.deepEqual(await (await fetch(`${origin}/health`)).json(), { ok: true });
    for (const payload of [preflight(), vfy('practice'), vfy('competition')]) {
      const res = await send(origin, payload); const body = await res.text();
      assert.equal(res.status, 200); assert.equal(verify(Buffer.from(body), res.headers.get('x-agent-games-signature'), secret), true);
      assert.equal(await (await send(origin, payload)).text(), body);
    }
    assert.equal((await send(origin, preflight(), 3000, false)).status, 401);
  } finally { await app.close(); }
  await assert.rejects(send(origin, preflight()));
});
for (const mode of ['invalid_signature', 'invalid_json']) {
  test(`actual HTTP: ${mode}`, async () => {
    const { app, origin } = await start(mode);
    try {
      const res = await send(origin, vfy()); const body = await res.text();
      assert.equal(res.status, 200);
      if (mode === 'invalid_json') { assert.throws(() => JSON.parse(body)); assert.equal(verify(Buffer.from(body), res.headers.get('x-agent-games-signature'), secret), true); }
      else assert.equal(verify(Buffer.from(body), res.headers.get('x-agent-games-signature'), secret), false);
    } finally { await app.close(); }
  });
}
test('actual HTTP: late mode exceeds the real 15-second platform timeout', { timeout: 22000 }, async () => {
  const { app, origin } = await start('late');
  try {
    const started = performance.now();
    await assert.rejects(send(origin, vfy(), 15000), error => error instanceof Error && error.name === 'TimeoutError');
    assert.ok(performance.now() - started >= 14500);
  } finally { await app.close(); }
});
