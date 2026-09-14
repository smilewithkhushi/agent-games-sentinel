import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { decideGatekeeper, decideVfy } from '../src/games.js';
import { resolveStealTheVfyTurn, type VfyAction } from '../tests/fixtures/platform/resolver.js';

// ANSI styling
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderBar(value: number, max = 150, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  const empty = width - filled;
  return `${C.green}${'█'.repeat(filled)}${C.dim}${'░'.repeat(empty)}${C.reset} ${value.toFixed(0)} VFY`;
}

type OpponentStrategy = 'aggressive' | 'fortifier' | 'sentinel_clone' | 'random';

function getOpponentAction(strategy: OpponentStrategy, oppBal: number, sentBal: number): VfyAction {
  switch (strategy) {
    case 'aggressive':
      return oppBal >= 5 ? { type: 'EXTRACT', amount: 8 } : { type: 'HOLD' };
    case 'fortifier':
      return oppBal >= 10 ? { type: 'FORTIFY' } : { type: 'HOLD' };
    case 'sentinel_clone': {
      const decision = decideVfy(String(oppBal), String(sentBal));
      return decision as VfyAction;
    }
    case 'random': {
      const r = Math.random();
      if (r < 0.4) return { type: 'EXTRACT', amount: Math.floor(Math.random() * 8) + 1 };
      if (r < 0.7) return { type: 'FORTIFY' };
      return { type: 'HOLD' };
    }
  }
}

async function runVfySimulation(strategy: OpponentStrategy = 'aggressive') {
  console.clear();
  console.log(`${C.bold}${C.cyan}╔════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║             STEAL THE VFY — MATCH ARENA                   ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚════════════════════════════════════════════════════════════╝${C.reset}\n`);

  console.log(`🤖 ${C.bold}Player 1:${C.reset} Agent Sentinel (Automated Rule-Based Agent)`);
  console.log(`👾 ${C.bold}Player 2:${C.reset} Opponent [Profile: ${C.yellow}${strategy.toUpperCase()}${C.reset}]`);
  console.log(`⚔️  ${C.dim}Rules: 20 turns. EXTRACT steals VFY, FORTIFY defends, HOLD conserves.${C.reset}\n`);

  let sentinelBalance = 100;
  let opponentBalance = 100;

  for (let turn = 1; turn <= 20; turn++) {
    // 1. Sentinel computes its action based on state
    const sentinelAction = decideVfy(String(sentinelBalance), String(opponentBalance)) as VfyAction;

    // 2. Opponent computes action
    const opponentAction = getOpponentAction(strategy, opponentBalance, sentinelBalance);

    // 3. Platform Resolver calculates outcome
    const resolution = resolveStealTheVfyTurn(sentinelBalance, opponentBalance, sentinelAction, opponentAction);

    sentinelBalance += resolution.balanceDeltaA;
    opponentBalance += resolution.balanceDeltaB;

    const deltaAStr = resolution.balanceDeltaA >= 0 ? `+${resolution.balanceDeltaA}` : `${resolution.balanceDeltaA}`;
    const deltaBStr = resolution.balanceDeltaB >= 0 ? `+${resolution.balanceDeltaB}` : `${resolution.balanceDeltaB}`;

    const formatAction = (a: VfyAction) => (a.type === 'EXTRACT' ? `${a.type} (${a.amount})` : a.type);

    console.log(`${C.bold}Turn ${turn.toString().padStart(2, ' ')}/20${C.reset} │ Sentinel: ${C.cyan}${formatAction(sentinelAction).padEnd(12, ' ')}${C.reset} (${deltaAStr.padStart(3, ' ')}) ║ Opponent: ${C.yellow}${formatAction(opponentAction).padEnd(12, ' ')}${C.reset} (${deltaBStr.padStart(3, ' ')})`);
    console.log(`         │ Sentinel: ${renderBar(sentinelBalance)}`);
    console.log(`         │ Opponent: ${renderBar(opponentBalance)}`);
    console.log(`${C.dim}─────────────────────────────────────────────────────────────${C.reset}`);

    await sleep(400);
  }

  console.log(`\n${C.bold}🏁 MATCH FINISHED!${C.reset}\n`);
  console.log(`Final Sentinel Balance: ${C.cyan}${C.bold}${sentinelBalance} VFY${C.reset}`);
  console.log(`Final Opponent Balance: ${C.yellow}${C.bold}${opponentBalance} VFY${C.reset}\n`);

  if (sentinelBalance > opponentBalance) {
    console.log(`${C.green}${C.bold}🏆 WINNER: AGENT SENTINEL (+${sentinelBalance - opponentBalance} VFY advantage)${C.reset}\n`);
  } else if (opponentBalance > sentinelBalance) {
    console.log(`${C.red}${C.bold}💀 WINNER: OPPONENT (+${opponentBalance - sentinelBalance} VFY advantage)${C.reset}\n`);
  } else {
    console.log(`${C.yellow}${C.bold}🤝 DRAW: EXACT TIE!${C.reset}\n`);
  }
}

async function runGatekeeperSimulation() {
  console.clear();
  console.log(`${C.bold}${C.magenta}╔════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.magenta}║             PROOF GATEKEEPER — TASK STREAM                ║${C.reset}`);
  console.log(`${C.bold}${C.magenta}╚════════════════════════════════════════════════════════════╝${C.reset}\n`);

  const mockTasks = [
    {
      label: 'Task #1: Valid Proof & Sufficient Balance',
      input: { registered_vk: '0x123abc', proof_vk: '0x123abc', proof_valid: true, minimum: '1000', public_balance: '1460' },
    },
    {
      label: 'Task #2: Invalid ZK Proof Flag',
      input: { registered_vk: '0x123abc', proof_vk: '0x123abc', proof_valid: false, minimum: '1000', public_balance: '1460' },
    },
    {
      label: 'Task #3: Substituted Verification Key (VK Attack)',
      input: { registered_vk: '0x123abc', proof_vk: '0x999evil', proof_valid: true, minimum: '1000', public_balance: '1460' },
    },
    {
      label: 'Task #4: Public Balance Below Minimum Threshold',
      input: { registered_vk: '0x123abc', proof_vk: '0x123abc', proof_valid: true, minimum: '5000', public_balance: '1200' },
    },
    {
      label: 'Task #5: Expired Condition Block',
      input: { registered_vk: '0x123abc', proof_vk: '0x123abc', proof_valid: true, minimum: '1000', public_balance: '1000', expiry_block: 450, current_block: 500 },
    },
    {
      label: 'Task #6: Reused Proof from Prior Round',
      input: { registered_vk: '0x123abc', proof_vk: '0x123abc', proof_valid: true, minimum: '1000', public_balance: '2000', proof_reused: true },
    },
  ];

  for (const task of mockTasks) {
    console.log(`📥 ${C.bold}${task.label}${C.reset}`);
    await sleep(500);

    const result = decideGatekeeper(task.input as any);
    const color = result.decision === 'APPROVE' ? C.green : C.red;

    console.log(`   👉 Decision: ${color}${C.bold}${result.decision}${C.reset}  │  Reason Code: ${C.cyan}${result.reason_code}${C.reset}\n`);
    await sleep(600);
  }

  console.log(`${C.green}✅ All incoming Gatekeeper tasks evaluated in sub-millisecond real-time.${C.reset}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'vfy';
  const opponent = (args[1] || 'aggressive') as OpponentStrategy;

  if (mode === 'gatekeeper') {
    await runGatekeeperSimulation();
  } else {
    await runVfySimulation(opponent);
  }
}

main().catch(console.error);
