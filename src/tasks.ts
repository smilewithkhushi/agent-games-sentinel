import { digest } from './crypto.js';
import { createVfyResponse, decideGatekeeper, rejectGatekeeper, type VfyResponseContext } from './games.js';
import { gatekeeperSchema, preflightSchema, vfySchema } from './protocol.js';

export type PreparedTask = {
  family: 'preflight' | 'gatekeeper' | 'vfy';
  cacheId: string;
  fingerprint: string;
  deadline: number;
  createResponse: () => Promise<object> | object;
  proofId?: string;
  reusedResponse?: object;
};

export function prepareTask(payload: unknown, vfyCtx?: VfyResponseContext): PreparedTask | null {
  const preflight = preflightSchema.safeParse(payload);
  if (preflight.success) {
    const task = preflight.data;
    return {
      family: 'preflight', cacheId: digest(JSON.stringify([task.agent_id, task.nonce])),
      fingerprint: digest(JSON.stringify([task.agent_id, task.nonce])),
      deadline: Date.parse(task.issued_at) + 10000,
      createResponse: () => ({ ok: true, protocolVersion: 'v1' }),
    };
  }
  const gatekeeper = gatekeeperSchema.safeParse(payload);
  if (gatekeeper.success) {
    const task = gatekeeper.data;
    const base = decideGatekeeper(task.input);
    const response = base;
    return {
      family: 'gatekeeper', cacheId: digest(task.task_id),
      fingerprint: digest(JSON.stringify([task.mode ?? 'reference', task.input])),
      deadline: Date.parse(task.deadline_at), createResponse: () => response,
      ...('proof_tx' in task.input && base.decision === 'APPROVE' ? {
        proofId: digest(task.input.proof_tx), reusedResponse: rejectGatekeeper('PROOF_REUSED'),
      } : {}),
    };
  }
  const vfy = vfySchema.safeParse(payload);
  if (!vfy.success) return null;
  const task = vfy.data;
  return {
    family: 'vfy', cacheId: digest(JSON.stringify([task.mode, task.matchId, task.turn])),
    // Delivery retries regenerate nonce/issuedAt. Neither changes turn identity.
    fingerprint: digest(JSON.stringify([task.mode, task.state, task.mode === 'competition' ? task.strategyCommitment.hash.toLowerCase() : null, task.resolverVersion])),
    deadline: Date.parse(task.deadlineAt), createResponse: () => createVfyResponse(task, vfyCtx),
  };
}
