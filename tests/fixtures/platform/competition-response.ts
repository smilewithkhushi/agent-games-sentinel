// Platform contract snapshot: lib/steal-the-vfy/match-engine.ts, revision 0efa2ec. Test-only.
import {z} from 'zod';
const STEAL_THE_VFY_TOTAL_TURNS = 20;
export const responseSchema = z
  .object({
    matchId: z.string().uuid(),
    turn: z.number().int().min(1).max(STEAL_THE_VFY_TOTAL_TURNS),
    action: z.discriminatedUnion("type", [
      z.object({ type: z.literal("HOLD") }).strict(),
      z.object({ type: z.literal("FORTIFY") }).strict(),
      z.object({ type: z.literal("EXTRACT"), amount: z.number().positive().max(10) }).strict(),
    ]),
    policyProof: z
      .object({
        circuitVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i),
        proofReference: z.string().max(512).optional(),
        publicInputsHash: z.string().regex(/^0x[a-f0-9]{64}$/i),
      })
      .strict(),
    agentTimestamp: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
