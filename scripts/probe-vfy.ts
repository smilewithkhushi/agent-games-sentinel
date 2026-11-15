// Signed competition-VFY probe against the live /agent endpoint.
// Proves the deployed build returns an inline Groth16 proof + public_signals that verify, and
// prints the Poseidon commitment hash you must register on the dashboard (derived from the secret).
//
// Usage (secret stays out of the transcript via env):
//   AGENT_GAMES_HMAC_SECRET=... node --import tsx scripts/probe-vfy.ts
//   AGENT_GAMES_HMAC_SECRET=... ENDPOINT=https://host/agent node --import tsx scripts/probe-vfy.ts
import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { computePoseidonCommitment } from '../src/proof.js';

const secret = process.env.AGENT_GAMES_HMAC_SECRET;
if (!secret) {
  console.error('Set AGENT_GAMES_HMAC_SECRET in the environment first.');
  process.exit(2);
}
const endpoint = process.env.ENDPOINT ?? 'https://agent-games-sentinel.fly.dev/agent';
const sign = (body: string) => createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');

// The hash the agent can prove against — this is what must be registered on the dashboard.
const commitment = await computePoseidonCommitment(secret);
console.log('poseidonCommitmentHash (register this):', commitment);

const body = JSON.stringify({
  protocolVersion: 'v1',
  eventId: 'steal-the-vfy',
  mode: 'competition',
  matchId: randomUUID(),
  turn: 1,
  issuedAt: new Date().toISOString(),
  deadlineAt: new Date(Date.now() + 15000).toISOString(),
  resolverVersion: 'v1-draft',
  nonce: randomUUID(),
  state: { selfBalance: '100', opponentBalance: '100', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null },
  strategyCommitment: { hash: commitment },
});

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-agent-games-signature': sign(body) },
  body,
});
const text = await res.text();
console.log('HTTP', res.status);
const respSig = res.headers.get('x-agent-games-signature');
console.log('response signature valid under this secret:', respSig === sign(text));

let json: any;
try { json = JSON.parse(text); } catch { console.error('non-JSON body:', text.slice(0, 400)); process.exit(1); }
const pp = json.policyProof ?? {};
console.log('action:', JSON.stringify(json.action));
const hasProof = !!pp.proof && Array.isArray(pp.public_signals) && pp.public_signals.length > 0;
console.log('policyProof keys:', Object.keys(pp).join(', '));
console.log('inline proof + public_signals present:', hasProof ? 'YES ✅' : 'NO ❌  (deploy is stale or proof failed)');
if (!hasProof) process.exit(1);

// Cryptographically verify the live proof against the local circuit vk.
const m: any = await import('snarkjs');
const snarkjs = m.default ?? m;
const vkey = await snarkjs.zKey.exportVerificationKey(resolve(process.cwd(), 'circuits/vfy-policy/vfy-policy.zkey'));
const ok = await snarkjs.groth16.verify(vkey, pp.public_signals, pp.proof);
console.log('live proof verifies against circuit vk:', ok ? 'VALID ✅' : 'INVALID ❌');
process.exit(ok ? 0 : 1);
