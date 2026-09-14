import { randomUUID } from 'node:crypto';
import { digest } from './crypto.js';
import type { Gatekeeper, VfyRequest } from './protocol.js';
export { gatekeeperSchema } from './protocol.js';
export type { Gatekeeper } from './protocol.js';

export function rejectGatekeeper(reason_code: string) {
  return { decision: 'REJECT' as const, reason_code };
}
export function decideGatekeeper(input: Gatekeeper['input']) {
  const reason = 'proof_valid' in input && !input.proof_valid ? 'PROOF_INVALID'
    : input.registered_vk !== input.proof_vk ? 'VK_SUBSTITUTION'
    : BigInt(input.public_balance) < BigInt(input.minimum) ? 'THRESHOLD_MISMATCH'
    : 'proof_reused' in input && input.proof_reused ? 'PROOF_REUSED'
    : 'expiry_block' in input && input.expiry_block < input.current_block ? 'EXPIRED_CONDITION'
    : 'recipient' in input && input.recipient !== input.condition_recipient ? 'RECIPIENT_MISMATCH'
    : 'amount' in input && BigInt(input.amount) > BigInt(input.max_transfer) ? 'AMOUNT_OVERFLOW'
    : 'CONDITION_VALID';
  return { decision: reason === 'CONDITION_VALID' ? 'APPROVE' as const : 'REJECT' as const, reason_code: reason };
}

// Integers and decimal strings are compared exactly; no Number conversion of balances.
export function decideVfy(self: bigint | string, opponent: bigint | string) {
  const values = [String(self), String(opponent)];
  if (values.some(v => v.length > 256 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(v))) throw new Error('Invalid balance');
  const places = Math.max(...values.map(v => v.split('.')[1]?.length ?? 0));
  const scale = 10n ** BigInt(places);
  const [, b] = values.map(v => {
    const [whole, fraction = ''] = v.split('.');
    return BigInt(whole!) * scale + BigInt(fraction.padEnd(places, '0') || '0');
  });
  // EXTRACT 10 weakly dominates all alternatives against every opponent action (see decisions.md D012).
  // HOLD only when opponent balance is zero — nothing to extract, nothing that can be extracted from us.
  if (b! === 0n) return { type: 'HOLD' } as const;
  return { type: 'EXTRACT', amount: 10 } as const;
}
// Explicit protocol type covering all possible actions, not just what this agent emits.
export type VfyAction = { type: 'HOLD' } | { type: 'FORTIFY' } | { type: 'EXTRACT'; amount: number };
export const CIRCUIT_VERSION = 'reference-test-v1';
// Fixed ordered serialization is part of this reference-test convention.
export const POLICY_JSON = JSON.stringify({
  policyVersion: 'reference-policy-v2',
  circuitVersion: CIRCUIT_VERSION,
  rules: [
    { when: 'opponentBalance == 0', action: 'HOLD' },
    { when: 'otherwise', action: 'EXTRACT', amount: 10 },
  ],
});
export const STRATEGY_COMMITMENT = `0x${digest(POLICY_JSON)}`;

export function publicInputsHash(matchId: string, turn: number, action: VfyAction, commitmentHash: string) {
  // Arrays fix field ordering. Non-extraction actions carry null as their amount.
  const canonical = JSON.stringify([matchId, turn, action.type, action.type === 'EXTRACT' ? action.amount : null, commitmentHash.toLowerCase()]);
  return `0x${digest(canonical)}`;
}
export function createVfyResponse(task: VfyRequest) {
  const action = decideVfy(task.state.selfBalance, task.state.opponentBalance);
  const commitment = task.mode === 'competition' ? task.strategyCommitment.hash : STRATEGY_COMMITMENT;
  const response = {
    matchId: task.matchId,
    turn: task.turn,
    action,
    policyProof: { circuitVersion: CIRCUIT_VERSION, publicInputsHash: publicInputsHash(task.matchId, task.turn, action, commitment) },
  };
  // Practice's strict platform schema forbids competition-only metadata.
  return task.mode === 'practice' ? response : {
    ...response,
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: randomUUID(),
  };
}
