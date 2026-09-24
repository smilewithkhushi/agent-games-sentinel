import { createHash } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { resolve } from 'node:path';

// ── Strategy parameters ───────────────────────────────────────────────────────
// extractAmount=10, fortifyThreshold=0, extractThreshold=0, holdPriority=0, reserved=0×4
// Encoding: EXTRACT 10 always; HOLD only when opponentBalance=0 (> 0 fails extractThreshold).
export const STRATEGY_PARAMS = [10n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;

// ── Circuit version mapping ───────────────────────────────────────────────────
// Mirrors VFY_CIRCUIT_VERSION_INTEGERS in the platform's resolver.ts.
const VFY_CIRCUIT_VERSION_INTEGERS: Record<string, bigint> = {
  'v1-draft': 1n,
  'v1': 1n,
};

const ACTION_SIGNAL: Record<string, bigint> = {
  HOLD: 0n,
  FORTIFY: 1n,
  EXTRACT: 2n,
};

// ── Keccak256 helpers ─────────────────────────────────────────────────────────

function toBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  if (hex.length > 64) throw new Error(`Value ${value} overflows 32 bytes`);
  return Buffer.from(hex, 'hex');
}

// Canonical keccak256 of ABI-packed VFY circuit public inputs.
// Must match computeVfyPublicInputsHash in the platform's lib/steal-the-vfy/resolver.ts.
export function computeVfyPublicInputsHash(params: {
  commitment: string;
  matchId: string;
  turnNumber: number;
  selfBalance: number;
  opponentBalance: number;
  action: 'HOLD' | 'FORTIFY' | 'EXTRACT';
  amount: number;
  circuitVersion: string;
}): string {
  const packed = Buffer.concat([
    toBytes32(BigInt(params.commitment)),
    toBytes32(BigInt('0x' + params.matchId.replace(/-/g, ''))),
    toBytes32(BigInt(params.turnNumber)),
    toBytes32(BigInt(params.selfBalance)),
    toBytes32(BigInt(params.opponentBalance)),
    toBytes32(ACTION_SIGNAL[params.action] ?? 0n),
    toBytes32(BigInt(params.amount)),
    toBytes32(VFY_CIRCUIT_VERSION_INTEGERS[params.circuitVersion] ?? 1n),
  ]);
  return '0x' + Buffer.from(keccak_256(packed)).toString('hex');
}

// ── Poseidon commitment ───────────────────────────────────────────────────────

// Salt is derived deterministically from the agent's HMAC secret so it is
// always reproducible without persistent storage.
export function deriveAgentSalt(hmacSecret: string): bigint {
  const raw = createHash('sha256').update('vfy-strategy-salt-v1:' + hmacSecret).digest();
  return BigInt('0x' + raw.toString('hex'));
}

// Returns a singleton Poseidon hasher (lazy-loaded, ~300 ms first call).
let _poseidon: ((inputs: bigint[]) => bigint) & { F: { toString: (v: bigint) => string } } | undefined;

async function getPoseidon() {
  if (_poseidon) return _poseidon;
  const { buildPoseidon } = await import('circomlibjs');
  _poseidon = await buildPoseidon();
  return _poseidon!;
}

// Compute Poseidon(strategyParams[0..7], salt) — the commitment registered before
// each competition match.  Must be called with the same hmacSecret used at registration.
export async function computePoseidonCommitment(hmacSecret: string): Promise<string> {
  const poseidon = await getPoseidon();
  const salt = deriveAgentSalt(hmacSecret);
  const inputs = [...STRATEGY_PARAMS, salt];
  // circomlibjs returns a Uint8Array-like field element; F.toString gives decimal.
  const hashFe = poseidon(inputs);
  const decStr = poseidon.F.toString(hashFe);
  const hex = BigInt(decStr).toString(16).padStart(64, '0');
  return '0x' + hex;
}

// ── VFY proof generation ──────────────────────────────────────────────────────

const CIRCUITS_DIR = resolve(process.cwd(), 'circuits');
const VFY_WASM = resolve(CIRCUITS_DIR, 'vfy-policy', 'vfy-policy.wasm');
const VFY_ZKEY = resolve(CIRCUITS_DIR, 'vfy-policy', 'vfy-policy.zkey');

export type VfyProofResult = {
  proof: object;
  publicSignals: string[];
  proofTag: string; // 0x-prefixed hex of the circuit's proofTag output
};

// Generate a Groth16 proof that the submitted action is the unique output of
// the committed strategy applied to the current match state.
// Returns null on any failure so the caller can fall back to no-proof response.
export async function generateVfyProof(params: {
  commitment: string;
  matchId: string;
  turnNumber: number;
  selfBalance: number;
  opponentBalance: number;
  action: 'HOLD' | 'FORTIFY' | 'EXTRACT';
  amount: number;
  circuitVersion: string;
  hmacSecret: string;
}): Promise<VfyProofResult | null> {
  try {
    const salt = deriveAgentSalt(params.hmacSecret);
    const inputs = {
      strategyParams: STRATEGY_PARAMS.map(v => v.toString()),
      salt: salt.toString(),
      commitment: BigInt(params.commitment).toString(),
      matchId: BigInt('0x' + params.matchId.replace(/-/g, '')).toString(),
      turnNumber: params.turnNumber.toString(),
      selfBalance: params.selfBalance.toString(),
      opponentBalance: params.opponentBalance.toString(),
      action: (ACTION_SIGNAL[params.action] ?? 0n).toString(),
      amount: params.amount.toString(),
      circuitVersion: (VFY_CIRCUIT_VERSION_INTEGERS[params.circuitVersion] ?? 1n).toString(),
    };
    const snarkjs = (await import('snarkjs')).default;
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, VFY_WASM, VFY_ZKEY);
    // publicSignals order matches the circuit's public output then inputs: proofTag is last.
    const proofTagDecimal = publicSignals[publicSignals.length - 1]!;
    const proofTag = '0x' + BigInt(proofTagDecimal).toString(16).padStart(64, '0');
    return { proof, publicSignals, proofTag };
  } catch (err) {
    console.error('VFY proof generation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Kurier submission ─────────────────────────────────────────────────────────

const KURIER_API = 'https://api-testnet.kurier.xyz/api/v1';

// Submit a Groth16 proof to Kurier (zkVerify relay).
// Returns the job_id to include as proofReference, or null on failure.
export async function submitToKurier(
  proof: object,
  publicSignals: string[],
  registeredVkHash: string,
  kurierApiKey: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${KURIER_API}/submit-proof/${kurierApiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        proofType: 'groth16',
        vkRegistered: true,
        proofOptions: { library: 'snarkjs', curve: 'bn128' },
        proofData: { proof, publicSignals, vk: registeredVkHash },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { job_id?: string };
    return data.job_id ?? null;
  } catch {
    return null;
  }
}
