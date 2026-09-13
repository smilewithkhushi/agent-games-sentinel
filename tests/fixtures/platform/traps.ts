// Platform contract snapshot: lib/gatekeeper/traps.ts, revision 0efa2ec. Test-only.
import { createHash } from "crypto";

export type TrapCode =
  | "VALID_CONDITION"
  | "VK_SUBSTITUTION"
  | "THRESHOLD_MISMATCH"
  | "PROOF_REUSED"
  | "EXPIRED_CONDITION"
  | "RECIPIENT_MISMATCH"
  | "AMOUNT_OVERFLOW";

export type GatekeeperInput = {
  registered_vk: string;
  proof_vk: string;
  minimum: string;
  public_balance: string;
  recipient: string;
  condition_recipient: string;
  expiry_block: number;
  current_block: number;
  amount: string;
  max_transfer: string;
  proof_tx: string;
};

export type TrapTask = {
  trapCode: TrapCode;
  expected: "APPROVE" | "REJECT";
  input: GatekeeperInput;
};

// One registered VK per round. Agents should learn this is the authoritative key.
const ROUND_VK: Record<string, string> = {
  R01: "0x4a9f2c",
  R02: "0x8b3e51",
  R03: "0xd72a0f",
  R04: "0x1c6b84",
};

// Trap pool per round. Shuffled per-agent, never changed after a round opens.
// PROOF_REUSED starts at R02 so agents have a prior-round seen-list to check against.
const ROUND_POOL: Record<string, TrapCode[]> = {
  R01: [
    "VALID_CONDITION", "VALID_CONDITION",
    "VK_SUBSTITUTION", "VK_SUBSTITUTION",
    "THRESHOLD_MISMATCH",
    "EXPIRED_CONDITION",
    "RECIPIENT_MISMATCH",
    "AMOUNT_OVERFLOW",
  ],
  R02: [
    "VALID_CONDITION", "VALID_CONDITION",
    "VK_SUBSTITUTION", "VK_SUBSTITUTION",
    "THRESHOLD_MISMATCH", "THRESHOLD_MISMATCH",
    "EXPIRED_CONDITION",
    "RECIPIENT_MISMATCH",
    "AMOUNT_OVERFLOW",
    "PROOF_REUSED",
  ],
  R03: [
    "VALID_CONDITION", "VALID_CONDITION", "VALID_CONDITION",
    "VK_SUBSTITUTION", "VK_SUBSTITUTION",
    "THRESHOLD_MISMATCH", "THRESHOLD_MISMATCH",
    "EXPIRED_CONDITION", "EXPIRED_CONDITION",
    "RECIPIENT_MISMATCH",
    "AMOUNT_OVERFLOW",
    "PROOF_REUSED",
  ],
  R04: [
    "VALID_CONDITION", "VALID_CONDITION",
    "VK_SUBSTITUTION", "VK_SUBSTITUTION", "VK_SUBSTITUTION",
    "THRESHOLD_MISMATCH", "THRESHOLD_MISMATCH",
    "EXPIRED_CONDITION", "EXPIRED_CONDITION",
    "RECIPIENT_MISMATCH", "RECIPIENT_MISMATCH",
    "AMOUNT_OVERFLOW", "AMOUNT_OVERFLOW",
    "PROOF_REUSED",
  ],
};

// Which round's proof_tx a PROOF_REUSED task references.
// An agent must have tracked their seen-list from the prior round to detect this.
const PREV_ROUND: Partial<Record<string, string>> = {
  R02: "R01",
  R03: "R02",
  R04: "R03",
};

// ─── Deterministic helpers ────────────────────────────────────────────────────

function digest(agentId: string, round: string, slot: string): Buffer {
  return createHash("sha256").update(`${agentId}:${round}:${slot}`).digest();
}

function toHex(buf: Buffer, bytes = 3): string {
  return "0x" + buf.subarray(0, bytes).toString("hex");
}

function toInt(buf: Buffer, min: number, max: number): number {
  return Math.floor(min + (buf.readUInt32BE(0) / 0xffffffff) * (max - min));
}

function toAddress(buf: Buffer): string {
  return "0x" + buf.subarray(0, 20).toString("hex");
}

function shuffle<T>(arr: T[], agentId: string, round: string): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = digest(agentId, round, `shuffle:${i}`).readUInt32BE(0) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ─── Task input builder ───────────────────────────────────────────────────────

function buildInput(
  code: TrapCode,
  agentId: string,
  round: string,
  index: number,
  proofTx: string,
): GatekeeperInput {
  const roundVk = ROUND_VK[round] ?? "0x000000";
  const s = digest(agentId, round, `task:${index}`);
  const fakeVk = toHex(digest(agentId, round, `fake_vk:${index}`), 3);
  const correctRecipient = toAddress(digest(agentId, round, "correct_recipient"));
  const wrongRecipient = toAddress(digest(agentId, round, `wrong_recipient:${index}`));
  const currentBlock = toInt(digest(agentId, round, "current_block"), 8_400_000, 8_500_000);
  const maxTransfer = toInt(digest(agentId, round, "max_transfer"), 600, 1500);

  const base: GatekeeperInput = {
    registered_vk: roundVk,
    proof_vk: roundVk,
    minimum: "1000",
    public_balance: String(toInt(s, 1100, 5000)),
    recipient: correctRecipient,
    condition_recipient: correctRecipient,
    expiry_block: currentBlock + 10_000,
    current_block: currentBlock,
    amount: String(toInt(digest(agentId, round, `amount:${index}`), 100, maxTransfer)),
    max_transfer: String(maxTransfer),
    proof_tx: proofTx,
  };

  switch (code) {
    case "VALID_CONDITION":
      return base;
    case "VK_SUBSTITUTION":
      return { ...base, proof_vk: fakeVk };
    case "THRESHOLD_MISMATCH":
      return { ...base, public_balance: String(toInt(s, 10, 999)) };
    case "PROOF_REUSED":
      return base;
    case "EXPIRED_CONDITION":
      return { ...base, expiry_block: currentBlock - toInt(s, 1, 500) };
    case "RECIPIENT_MISMATCH":
      return { ...base, recipient: wrongRecipient };
    case "AMOUNT_OVERFLOW":
      return { ...base, amount: String(maxTransfer + toInt(s, 1, 500)) };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate the full ordered task set for one agent in one round.
 *
 * Order is shuffled deterministically from agentId — agents cannot share answers.
 *
 * PROOF_REUSED tasks reference a proof_tx from the previous round's first
 * VALID_CONDITION task. Agents who track proof_tx values across rounds will
 * detect this; agents who don't will incorrectly APPROVE it.
 */
export function generateRoundTasks(agentId: string, round: string): TrapTask[] {
  const pool = ROUND_POOL[round];
  if (!pool) throw new Error(`Unknown round: ${round}`);

  const shuffled = shuffle(pool, agentId, round);

  // Each round has one "reusable" proof_tx that next round's PROOF_REUSED will reference.
  const thisRoundReusableProofTx = toHex(digest(agentId, round, "reusable_proof_tx"), 16);

  // The proof_tx to reuse: comes from the previous round's reusable slot.
  const prevRound = PREV_ROUND[round];
  const reusedProofTx = prevRound
    ? toHex(digest(agentId, prevRound, "reusable_proof_tx"), 16)
    : thisRoundReusableProofTx;

  let firstValidSeen = false;

  return shuffled.map((code, index) => {
    let proofTx: string;

    if (code === "VALID_CONDITION" && !firstValidSeen) {
      // The first VALID_CONDITION in this agent's shuffled sequence carries the
      // reusable proof_tx so the next round's PROOF_REUSED trap is detectable.
      proofTx = thisRoundReusableProofTx;
      firstValidSeen = true;
    } else if (code === "PROOF_REUSED") {
      proofTx = reusedProofTx;
    } else {
      proofTx = toHex(digest(agentId, round, `proof_tx:${index}`), 16);
    }

    const input = buildInput(code, agentId, round, index, proofTx);
    const expected: "APPROVE" | "REJECT" = code === "VALID_CONDITION" ? "APPROVE" : "REJECT";
    return { trapCode: code, expected, input };
  });
}
