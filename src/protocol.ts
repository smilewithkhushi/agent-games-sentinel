import { z } from 'zod';

export const integer = z.string().max(256).regex(/^(0|[1-9][0-9]*)$/);
export const decimal = z.string().max(256).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const identifier = z.string().min(1).max(256);
const datetime = z.iso.datetime({ offset: true });
const hexHash = z.string().regex(/^0x[a-f0-9]{64}$/i);
const sharedGatekeeperInput = {
  registered_vk: z.string().min(1).max(4096),
  proof_vk: z.string().min(1).max(4096),
  minimum: integer,
  public_balance: integer,
};
const referenceInput = z.strictObject({
  ...sharedGatekeeperInput,
  proof_valid: z.boolean(),
  proof_reused: z.boolean().optional(),
});
// The platform's round generator sends a richer envelope without proof_valid.
const roundInput = z.strictObject({
  ...sharedGatekeeperInput,
  recipient: identifier,
  condition_recipient: identifier,
  expiry_block: z.number().int().nonnegative().safe(),
  current_block: z.number().int().nonnegative().safe(),
  amount: integer,
  max_transfer: integer,
  proof_tx: identifier,
});
export const gatekeeperSchema = z.strictObject({
  type: z.literal('agent-games.proof-gatekeeper.v1'),
  task_id: identifier,
  mode: z.enum(['practice', 'competition']).optional(),
  issued_at: datetime.optional(),
  deadline_at: datetime,
  input: z.union([referenceInput, roundInput]),
});
export type Gatekeeper = z.infer<typeof gatekeeperSchema>;
export const preflightSchema = z.strictObject({
  type: z.literal('agent-games.preflight.v1'),
  // Docs show prefixed/opaque ids (e.g. "agt_...", nonce "abc123"), while some
  // platform builds send UUIDs. Accept any non-empty identifier to match both.
  agent_id: identifier,
  issued_at: datetime,
  nonce: identifier,
});
const state = {
  selfBalance: decimal,
  opponentBalance: decimal,
  selfFortifiedUntilTurn: z.number().int().min(1).max(20).nullable(),
  opponentFortifiedUntilTurn: z.number().int().min(1).max(20).nullable(),
};
const vfyEnvelope = {
  protocolVersion: z.literal('v1'),
  eventId: z.literal('steal-the-vfy'),
  matchId: z.uuid(),
  turn: z.number().int().min(1).max(20),
  issuedAt: datetime,
  deadlineAt: datetime,
  // Platform source emits 'v1-draft'; the build spec documents 'v1'. Accept both
  // so a version bump on the platform side cannot reject every turn.
  resolverVersion: z.enum(['v1', 'v1-draft']),
  nonce: z.uuid(),
};
export const vfySchema = z.discriminatedUnion('mode', [
  z.strictObject({
    ...vfyEnvelope,
    mode: z.literal('practice'),
    state: z.strictObject({ ...state, priorTurnHash: identifier }),
  }),
  z.strictObject({
    ...vfyEnvelope,
    mode: z.literal('competition'),
    state: z.strictObject(state),
    strategyCommitment: z.strictObject({ hash: hexHash }),
  }),
]);
export type VfyRequest = z.infer<typeof vfySchema>;
