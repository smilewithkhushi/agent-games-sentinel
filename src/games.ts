import { randomUUID, createHash } from 'node:crypto';
import { concat, keccak256, numberToHex } from 'viem';
import { digest } from './crypto.js';
import { generateVfyProof, submitToKurier } from './proof.js';
import type { Gatekeeper, VfyRequest } from './protocol.js';
export { gatekeeperSchema } from './protocol.js';
export type { Gatekeeper } from './protocol.js';

export function rejectGatekeeper(reason_code: string) {
  return { decision: 'REJECT' as const, reason_code };
}

// Canonical keccak256 of ABI-packed Gatekeeper circuit public inputs.
// Must match computeGatekeeperPublicInputsHash in lib/gatekeeper/traps.ts exactly.
// Called only for round-format tasks (which carry all required fields).
export function gatekeeperPublicInputsHash(
  input: Extract<Gatekeeper['input'], { expiry_block: number }>,
  taskId: string,
  decision: 'APPROVE' | 'REJECT',
): string {
  // Platform uses UUID task IDs: strip dashes and parse the 32-char hex directly.
  // Fall back to SHA-256 for synthetic test IDs that aren't UUID format.
  const uuidHex = taskId.slice(-36).replace(/-/g, '');
  const taskIdBigInt = /^[0-9a-f]{32}$/i.test(uuidHex)
    ? BigInt('0x' + uuidHex)
    : BigInt('0x' + createHash('sha256').update(taskId).digest('hex'));
  const packed = concat([
    numberToHex(BigInt(input.registered_vk), { size: 32 }),
    numberToHex(BigInt(input.proof_vk), { size: 32 }),
    numberToHex(BigInt(input.minimum), { size: 32 }),
    numberToHex(BigInt(input.public_balance), { size: 32 }),
    numberToHex(BigInt(input.expiry_block), { size: 32 }),
    numberToHex(BigInt(input.current_block), { size: 32 }),
    numberToHex(BigInt(input.recipient), { size: 32 }),
    numberToHex(BigInt(input.condition_recipient), { size: 32 }),
    numberToHex(BigInt(input.amount), { size: 32 }),
    numberToHex(BigInt(input.max_transfer), { size: 32 }),
    numberToHex(decision === 'APPROVE' ? 1n : 0n, { size: 32 }),
    numberToHex(taskIdBigInt, { size: 32 }),
  ]);
  return keccak256(packed);
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

// ── VFY public inputs hash ────────────────────────────────────────────────────

// Maps circuit version strings to the integer signal used in vfy-policy.circom.
// Mirrors VFY_CIRCUIT_VERSION_INTEGERS in the platform's lib/steal-the-vfy/resolver.ts.
const VFY_CIRCUIT_VERSION_INTEGERS: Record<string, bigint> = {
  'v1-draft': 1n,
  'v1': 1n,
};
const ACTION_SIGNAL: Record<string, bigint> = { HOLD: 0n, FORTIFY: 1n, EXTRACT: 2n };

// Canonical keccak256 of ABI-packed VFY circuit public inputs.
// Field order: commitment|matchId|turnNumber|selfBalance|opponentBalance|action|amount|circuitVersion
// Must match computeVfyPublicInputsHash in the platform's lib/steal-the-vfy/resolver.ts.
// The platform independently recomputes and compares this in finalizeVfyTurnProof.
export function publicInputsHash(
  matchId: string, turn: number, selfBalance: number, opponentBalance: number,
  action: VfyAction, commitmentHash: string,
) {
  const packed = concat([
    numberToHex(BigInt(commitmentHash), { size: 32 }),
    numberToHex(BigInt('0x' + matchId.replace(/-/g, '')), { size: 32 }),
    numberToHex(BigInt(turn), { size: 32 }),
    numberToHex(BigInt(selfBalance), { size: 32 }),
    numberToHex(BigInt(opponentBalance), { size: 32 }),
    numberToHex(ACTION_SIGNAL[action.type] ?? 0n, { size: 32 }),
    numberToHex(action.type === 'EXTRACT' ? BigInt(action.amount) : 0n, { size: 32 }),
    numberToHex(VFY_CIRCUIT_VERSION_INTEGERS[CIRCUIT_VERSION] ?? 1n, { size: 32 }),
  ]);
  return keccak256(packed);
}

// ── VFY response context ──────────────────────────────────────────────────────

export type VfyResponseContext = {
  hmacSecret: string;
  kurierApiKey?: string;
  zkverifyVfyVkHash?: string;
};

export async function createVfyResponse(task: VfyRequest, ctx?: VfyResponseContext) {
  const action = decideVfy(task.state.selfBalance, task.state.opponentBalance);
  // Competition uses the task's commitment hash; practice uses the SHA-256 placeholder.
  // (Practice proofStatus is always returned as "verified" by the platform, so the exact
  // hash is not verified there.)
  const commitment = task.mode === 'competition' ? task.strategyCommitment.hash : STRATEGY_COMMITMENT;

  const hash = publicInputsHash(
    task.matchId, task.turn,
    Number(task.state.selfBalance), Number(task.state.opponentBalance),
    action, commitment,
  );

  let proofReference: string | undefined;
  if (task.mode === 'competition' && ctx?.hmacSecret && ctx.kurierApiKey && ctx.zkverifyVfyVkHash) {
    const proof = await generateVfyProof({
      commitment,
      matchId: task.matchId,
      turnNumber: task.turn,
      selfBalance: Number(task.state.selfBalance),
      opponentBalance: Number(task.state.opponentBalance),
      action: action.type,
      amount: action.type === 'EXTRACT' ? action.amount : 0,
      circuitVersion: CIRCUIT_VERSION,
      hmacSecret: ctx.hmacSecret,
    });
    if (proof) {
      proofReference = await submitToKurier(
        proof.proof, proof.publicSignals, ctx.zkverifyVfyVkHash, ctx.kurierApiKey,
      ) ?? undefined;
    }
  }

  const response = {
    matchId: task.matchId,
    turn: task.turn,
    action,
    policyProof: {
      circuitVersion: CIRCUIT_VERSION,
      publicInputsHash: hash,
      ...(proofReference !== undefined ? { proofReference } : {}),
    },
  };

  // Practice's strict platform schema forbids competition-only metadata.
  return task.mode === 'practice' ? response : {
    ...response,
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: randomUUID(),
  };
}
