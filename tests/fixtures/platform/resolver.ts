// Platform contract snapshot: lib/steal-the-vfy/resolver.ts, revision 0efa2ec. Test-only.
export const STEAL_THE_VFY_RESOLVER_VERSION = "v1-draft";
export const STEAL_THE_VFY_TOTAL_TURNS = 20;

export type VfyAction =
  | { type: "HOLD" }
  | { type: "FORTIFY" }
  | { type: "EXTRACT"; amount: number };

export type VfyTurnResolution = {
  actionA: VfyAction;
  actionB: VfyAction;
  balanceDeltaA: number;
  balanceDeltaB: number;
  reasonCode: string;
};

export type VfyResolverConfig = {
  extractCap: number;
  fortifyCost: number;
  fortifyBlock: number;
};

export const DRAFT_RESOLVER_CONFIG: VfyResolverConfig = {
  extractCap: 10,
  fortifyCost: 2,
  fortifyBlock: 6,
};

function assertAction(action: VfyAction, config: VfyResolverConfig) {
  if (action.type !== "EXTRACT") return;
  if (!Number.isFinite(action.amount) || action.amount <= 0 || action.amount > config.extractCap) {
    throw new Error(`EXTRACT amount must be between 0 and ${config.extractCap}.`);
  }
}

function attemptedExtraction(action: VfyAction, opponentAction: VfyAction, opponentBalance: number, config: VfyResolverConfig) {
  if (action.type !== "EXTRACT") return 0;
  const defence = opponentAction.type === "FORTIFY" ? config.fortifyBlock : 0;
  return Math.max(0, Math.min(action.amount, config.extractCap, opponentBalance) - defence);
}

export function resolveStealTheVfyTurn(
  balanceA: number,
  balanceB: number,
  actionA: VfyAction,
  actionB: VfyAction,
  config: VfyResolverConfig = DRAFT_RESOLVER_CONFIG,
): VfyTurnResolution {
  if (!Number.isFinite(balanceA) || !Number.isFinite(balanceB) || balanceA < 0 || balanceB < 0) {
    throw new Error("Balances must be finite, non-negative values.");
  }
  assertAction(actionA, config);
  assertAction(actionB, config);

  const fortifyCostA = actionA.type === "FORTIFY" ? Math.min(config.fortifyCost, balanceA) : 0;
  const fortifyCostB = actionB.type === "FORTIFY" ? Math.min(config.fortifyCost, balanceB) : 0;
  const spendableA = balanceA - fortifyCostA;
  const spendableB = balanceB - fortifyCostB;
  const extractA = attemptedExtraction(actionA, actionB, spendableB, config);
  const extractB = attemptedExtraction(actionB, actionA, spendableA, config);
  const balanceDeltaA = -fortifyCostA + extractA - extractB;
  const balanceDeltaB = -fortifyCostB + extractB - extractA;
  const reasonCode = `${actionA.type[0]}${actionB.type[0]}_${actionA.type === "EXTRACT" || actionB.type === "EXTRACT" ? "SIMULTANEOUS_RESOLUTION" : "NO_TRANSFER"}`;

  return { actionA, actionB, balanceDeltaA, balanceDeltaB, reasonCode };
}
