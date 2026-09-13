import { buildApp } from '../src/application.js';
import { readConfig } from '../src/config.js';
import { sign, verify } from '../src/crypto.js';
import { preflight, vfy } from '../tests/fixtures/requests.js';
const secret = 'ephemeral-local-demo-only';
const app = buildApp(readConfig({ AGENT_GAMES_HMAC_SECRET: secret }));
try {
  for (const [label, payload] of [
    ['Preflight', preflight()],
    ['Gatekeeper', { type: 'agent-games.proof-gatekeeper.v1', task_id: 'demo', deadline_at: new Date(Date.now() + 15000).toISOString(), input: { registered_vk: '0xabc', proof_vk: '0xabc', proof_valid: true, minimum: '1000', public_balance: '1460' } }],
    ['VFY practice', vfy('practice')],
    ['VFY competition (test)', vfy('competition')],
  ] as const) {
    const body = JSON.stringify(payload);
    const response = await app.inject({ method: 'POST', url: '/agent', headers: { 'content-type': 'application/json', 'x-agent-games-signature': sign(body, secret) }, payload: body });
    if (response.statusCode !== 200 || !verify(Buffer.from(response.body), response.headers['x-agent-games-signature'], secret)) throw new Error(`${label} failed`);
    console.log(`${label}: ${response.body}`);
  }
} finally { await app.close(); }
