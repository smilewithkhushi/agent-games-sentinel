import { CIRCUIT_VERSION, POLICY_JSON, STRATEGY_COMMITMENT } from '../src/games.js';
import { computePoseidonCommitment } from '../src/proof.js';
import { readConfig } from '../src/config.js';

const config = readConfig();
// The commitment binds to VFY_COMMITMENT_SECRET when set (decoupled from the signing secret),
// otherwise to AGENT_GAMES_HMAC_SECRET.
const commitmentSecret = config.VFY_COMMITMENT_SECRET ?? config.AGENT_GAMES_HMAC_SECRET;
const poseidonCommitment = await computePoseidonCommitment(commitmentSecret);

console.log(JSON.stringify({
  circuitVersion: CIRCUIT_VERSION,
  // SHA-256 placeholder — used for practice turns and tests; registered for practice.
  sha256CommitmentHash: STRATEGY_COMMITMENT,
  // Poseidon commitment — MUST be registered before competition matches open.
  // Derived from AGENT_GAMES_HMAC_SECRET; re-run after rotating the secret.
  poseidonCommitmentHash: poseidonCommitment,
  policyVersion: 'reference-policy-v2',
  policy: JSON.parse(POLICY_JSON),
  warning: 'Register poseidonCommitmentHash with the platform before any competition match.',
}, null, 2));
