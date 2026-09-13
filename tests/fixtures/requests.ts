import { randomUUID } from 'node:crypto';
import { STRATEGY_COMMITMENT } from '../../src/games.js';
export const preflight = () => ({ type: 'agent-games.preflight.v1', agent_id: randomUUID(), issued_at: new Date().toISOString(), nonce: randomUUID() });
export function vfy(mode: 'practice' | 'competition' = 'competition', self = '100', opponent = '100') {
  const state = { selfBalance: self, opponentBalance: opponent, selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null };
  const common = { protocolVersion: 'v1', eventId: 'steal-the-vfy', mode, matchId: randomUUID(), turn: 1, issuedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 15000).toISOString(), resolverVersion: 'v1-draft', nonce: randomUUID() };
  return mode === 'practice' ? { ...common, mode: 'practice' as const, state: { ...state, priorTurnHash: '0x0' } }
    : { ...common, mode: 'competition' as const, state, strategyCommitment: { hash: STRATEGY_COMMITMENT } };
}
