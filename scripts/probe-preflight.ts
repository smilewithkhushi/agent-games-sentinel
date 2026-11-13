// Signed preflight probe. Proves the live /agent endpoint accepts a correctly
// signed request and returns a correctly signed response.
//
// Usage (secret stays out of the transcript via env):
//   AGENT_GAMES_HMAC_SECRET=... node --import tsx scripts/probe-preflight.ts
//   AGENT_GAMES_HMAC_SECRET=... ENDPOINT=https://host/agent node --import tsx scripts/probe-preflight.ts
import { createHmac, randomUUID } from 'node:crypto';

const secret = process.env.AGENT_GAMES_HMAC_SECRET;
if (!secret) {
  console.error('Set AGENT_GAMES_HMAC_SECRET in the environment first.');
  process.exit(2);
}
const endpoint = process.env.ENDPOINT ?? 'https://agent-games-sentinel.fly.dev/agent';
const sign = (body: string) => createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');

const body = JSON.stringify({
  type: 'agent-games.preflight.v1',
  agent_id: randomUUID(),
  issued_at: new Date().toISOString(),
  nonce: randomUUID(),
});

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-agent-games-signature': sign(body) },
  body,
});
const text = await res.text();
const respSig = res.headers.get('x-agent-games-signature');
console.log('HTTP', res.status);
console.log('body:', text);
console.log('response signature valid under this secret:', respSig === sign(text));
