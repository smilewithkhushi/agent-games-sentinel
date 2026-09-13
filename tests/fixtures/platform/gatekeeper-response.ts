// Platform contract snapshot: lib/task-delivery.ts, revision 0efa2ec. Test-only.
import {z} from 'zod';
const STEAL_THE_VFY_TOTAL_TURNS = 20;
export const agentResponseSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason_code: z.string().regex(/^[A-Z0-9_:-]{2,80}$/),
  proof_tx: z.string().max(512).optional(),
}).strict();
