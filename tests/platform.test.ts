import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { buildApp } from '../src/application.js';
import { readConfig } from '../src/config.js';
import { MemoryStore } from '../src/cache.js';
import { publicInputsHash, STRATEGY_COMMITMENT, POLICY_JSON } from '../src/games.js';
import { preflight, vfy } from './fixtures/requests.js';
import { hasValidAgentSignature, signAgentMessage } from './fixtures/platform/agent-signature.js';
import { responseSchema as practiceSchema } from './fixtures/platform/practice-response.js';
import { responseSchema as competitionSchema } from './fixtures/platform/competition-response.js';
import { agentResponseSchema } from './fixtures/platform/gatekeeper-response.js';
import { generateRoundTasks } from './fixtures/platform/traps.js';
import { resolveStealTheVfyTurn } from './fixtures/platform/resolver.js';
const secret = 'local-platform-contract-test';
const setup = (store = new MemoryStore(), mode = 'normal', wait?: (ms: number) => Promise<unknown>, namespace = 'reference-local') => buildApp(readConfig({ AGENT_GAMES_HMAC_SECRET: secret, REFERENCE_AGENT_MODE: mode, AGENT_NAMESPACE: namespace }), { store, wait });
async function send(app: ReturnType<typeof setup>, payload: unknown) {
    const body = JSON.stringify(payload);
    return app.inject({ method: 'POST', url: '/agent', headers: { 'content-type': 'application/json', 'x-agent-games-signature': signAgentMessage(secret, body) }, payload: body });
}
function checkSignature(res: Awaited<ReturnType<typeof send>>) {
    assert.equal(hasValidAgentSignature(secret, res.body, String(res.headers['x-agent-games-signature'])), true);
    assert.ok(Buffer.byteLength(res.body) < 16384);
}
test('platform preflight is signed protocol-v1 JSON, and replay is identical', async (t) => {
    const app = setup();
    t.after(() => app.close());
    const payload = preflight();
    const first = await send(app, payload);
    const second = await send(app, payload);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), { ok: true, protocolVersion: 'v1' });
    checkSignature(first);
    assert.equal(first.body, second.body);
});
for (const mode of ['practice', 'competition'] as const) {
    for (const [self, opponent, action, label] of [
        ['100', '100', { type: 'EXTRACT', amount: 10 }, 'normal'],
        ['1', '100', { type: 'EXTRACT', amount: 10 }, 'low-self-still-extracts'],
        ['100', '0', { type: 'HOLD' }, 'depleted-opponent'],
    ] as const) {
        test(`${mode} VFY ${label} passes the platform's actual strict response schema`, async (t) => {
            const app = setup();
            t.after(() => app.close());
            const payload = vfy(mode, self, opponent);
            const res = await send(app, payload);
            assert.equal(res.statusCode, 200);
            checkSignature(res);
            const response = (mode === 'practice' ? practiceSchema : competitionSchema).parse(res.json());
            assert.equal(response.matchId, payload.matchId);
            assert.equal(response.turn, payload.turn);
            assert.deepEqual(response.action, action);
            assert.equal(response.policyProof.circuitVersion, 'reference-test-v1');
            assert.match(response.policyProof.publicInputsHash, /^0x[a-f0-9]{64}$/);
            if (mode === 'practice')
                assert.equal('agentTimestamp' in res.json(), false);
            else
                assert.ok(Math.abs(Date.parse(res.json().agentTimestamp) - Date.now()) < 5000);
        });
    }
}
test('VFY keeps UUID, timestamp, body and signature stable through regenerated delivery nonces and simultaneous instances', async (t) => {
    const store = new MemoryStore();
    const a = setup(store);
    const b = setup(store);
    t.after(() => Promise.all([a.close(), b.close()]));
    const payload = vfy();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => send(i % 2 ? a : b, { ...payload, nonce: randomUUID(), issuedAt: new Date().toISOString() })));
    for (const res of results) {
        assert.equal(res.statusCode, 200);
        assert.equal(res.body, results[0]!.body);
        assert.equal(res.headers['x-agent-games-signature'], results[0]!.headers['x-agent-games-signature']);
    }
    assert.equal((await send(a, { ...payload, state: { ...payload.state, selfBalance: '1' } })).statusCode, 409);
    assert.equal((await send(a, { ...payload, strategyCommitment: { hash: '0x' + 'b'.repeat(64) } })).statusCode, 409);
    const next = await send(a, { ...payload, turn: 2 });
    assert.equal(next.statusCode, 200);
    assert.notEqual(next.json().idempotencyKey, results[0]!.json().idempotencyKey);
});
test('VFY rejects malformed or unsupported envelopes instead of guessing fields', async (t) => {
    const app = setup();
    t.after(() => app.close());
    const payload = vfy();
    const cases = [
        { ...payload, turn: 0 }, { ...payload, turn: 21 }, { ...payload, turn: 1.5 },
        { ...payload, matchId: 'not-a-uuid' }, { ...payload, protocolVersion: 'v2' },
        { ...payload, resolverVersion: 'unknown' }, { ...payload, deadlineAt: 'tomorrow' },
        { ...payload, nonce: 'bad' }, { ...payload, surprise: true },
        { ...payload, strategyCommitment: undefined }, { ...payload, strategyCommitment: { hash: 'bad' } },
        { ...payload, state: { ...payload.state, selfBalance: 10 } },
        { ...payload, state: { ...payload.state, selfBalance: '-1' } },
        { ...payload, state: { ...payload.state, selfBalance: '1e3' } },
        { ...payload, state: { ...payload.state, selfBalance: 'Infinity' } },
        { ...payload, state: { ...payload.state, extra: true } },
        { ...vfy('practice'), strategyCommitment: { hash: STRATEGY_COMMITMENT } },
    ];
    for (const bad of cases)
        assert.equal((await send(app, bad)).statusCode, 400);
});
test('test hash has a documented independent byte representation and is stable', () => {
    const commitment = '0x' + 'a'.repeat(64);
    const matchId = '00000000-0000-4000-8000-000000000001';
    const expected = '0x' + createHash('sha256').update(`["${matchId}",1,"EXTRACT",5,"${commitment}"]`).digest('hex');
    assert.equal(publicInputsHash(matchId, 1, { type: 'EXTRACT', amount: 5 }, commitment), expected);
    assert.equal(publicInputsHash(matchId, 1, { type: 'EXTRACT', amount: 5 }, commitment.toUpperCase()), expected);
    assert.notEqual(publicInputsHash(matchId, 2, { type: 'EXTRACT', amount: 5 }, commitment), expected);
    assert.equal(STRATEGY_COMMITMENT, '0x' + createHash('sha256').update(POLICY_JSON).digest('hex'));
});
test('practice and competition caches and separate agent namespaces do not collide', async (t) => {
    const store = new MemoryStore();
    const a = setup(store);
    const b = setup(store, 'normal', undefined, 'second-agent');
    t.after(() => Promise.all([a.close(), b.close()]));
    const competition = vfy();
    const practice = { ...vfy('practice'), matchId: competition.matchId };
    assert.equal((await send(a, competition)).statusCode, 200);
    const res = await send(a, practice);
    assert.equal(res.statusCode, 200);
    practiceSchema.parse(res.json());
    assert.equal((await send(b, { ...competition, state: { ...competition.state, selfBalance: '0' } })).statusCode, 200);
});
test('all generated Gatekeeper round traps match platform expectations, including cross-round proof reuse', async (t) => {
    const app = setup();
    t.after(() => app.close());
    const agentId = '11111111-1111-4111-8111-111111111111';
    for (const round of ['R01', 'R02', 'R03', 'R04']) {
        for (const [index, trap] of generateRoundTasks(agentId, round).entries()) {
            const task = { type: 'agent-games.proof-gatekeeper.v1', task_id: `task_${round}_${index}`, mode: 'competition', issued_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 60000).toISOString(), input: trap.input };
            const response = await send(app, task);
            assert.equal(response.statusCode, 200);
            checkSignature(response);
            const parsed = agentResponseSchema.parse(response.json());
            assert.equal(parsed.decision, trap.expected, `${round}: ${trap.trapCode}`);
            const retry = await send(app, task);
            assert.equal(retry.body, response.body);
        }
    }
});
test('Gatekeeper practice metadata and explicit reused proof are accepted and rejected correctly', async (t) => {
    const app = setup();
    t.after(() => app.close());
    const res = await send(app, { type: 'agent-games.proof-gatekeeper.v1', task_id: 'practice_reused', mode: 'practice', issued_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 15000).toISOString(), input: { registered_vk: '0x7d91a4', proof_vk: '0x7d91a4', proof_valid: true, proof_reused: true, minimum: '1000', public_balance: '1460' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { decision: 'REJECT', reason_code: 'PROOF_REUSED' });
});
test('proof claim survives replay expiry; only one different task can claim a proof concurrently', async (t) => {
    let now = Date.now();
    const store = new MemoryStore(() => now);
    const a = setup(store);
    const b = setup(store);
    t.after(() => Promise.all([a.close(), b.close()]));
    const input = generateRoundTasks(randomUUID(), 'R01').find(task => task.trapCode === 'VALID_CONDITION')!.input;
    const payload = { type: 'agent-games.proof-gatekeeper.v1', task_id: 'original', mode: 'competition', deadline_at: new Date(now + 60000).toISOString(), input };
    const responses = await Promise.all([send(a, payload), send(b, { ...payload, task_id: 'second' })]);
    assert.deepEqual(responses.map(r => r.json().decision).sort(), ['APPROVE', 'REJECT']);
    const originalIndex = responses.findIndex(r => r.json().decision === 'APPROVE');
    now += 600001;
    const retry = await send(a, { ...payload, task_id: originalIndex === 0 ? 'original' : 'second' });
    assert.equal(retry.json().decision, 'APPROVE');
    const reused = await send(a, { ...payload, task_id: 'third' });
    assert.equal(reused.json().reason_code, 'PROOF_REUSED');
});
for (const reference of [{ type: 'HOLD' }, { type: 'FORTIFY' }, { type: 'EXTRACT', amount: 8 }] as import('./fixtures/platform/resolver.js').VfyAction[]) {
    test(`20-turn local practice session against ${reference.type} using the platform resolver`, async (t) => {
        const app = setup();
        t.after(() => app.close());
        const initial = vfy('practice');
        let self = 100, opponent = 100;
        for (let turn = 1; turn <= 20; turn++) {
            const request = { ...initial, turn, nonce: randomUUID(), state: { ...initial.state, selfBalance: String(self), opponentBalance: String(opponent) } };
            const res = await send(app, request);
            assert.equal(res.statusCode, 200);
            checkSignature(res);
            const response = practiceSchema.parse(res.json());
            assert.equal(response.turn, turn);
            const result = resolveStealTheVfyTurn(self, opponent, response.action, reference);
            self += result.balanceDeltaA;
            opponent += result.balanceDeltaB;
            assert.ok(self >= 0 && opponent >= 0);
        }
    });
}
test('VFY and preflight honor failure modes and skip intentional delays for expired tasks', async (t) => {
    for (const mode of ['late', 'invalid_json', 'invalid_signature']) {
        const delays: number[] = [];
        const app = setup(new MemoryStore(), mode, async (ms) => { delays.push(ms); });
        t.after(() => app.close());
        for (const request of [preflight(), vfy('practice'), vfy()]) {
            const res = await send(app, request);
            assert.equal(res.statusCode, 200);
            if (mode === 'invalid_json') {
                assert.throws(() => JSON.parse(res.body));
                checkSignature(res);
            }
            if (mode === 'invalid_signature')
                assert.equal(hasValidAgentSignature(secret, res.body, String(res.headers['x-agent-games-signature'])), false);
        }
        if (mode === 'late') {
            assert.deepEqual(delays, [16000, 16000, 16000]);
            assert.equal((await send(app, { ...vfy(), deadlineAt: '2020-01-01T00:00:00.000Z' })).statusCode, 200);
            assert.equal(delays.length, 3);
        }
    }
});
test('invalid UTF-8 is rejected after valid authentication', async (t) => {
    const app = setup();
    t.after(() => app.close());
    const body = Buffer.from([0xff, 0xfe]);
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const res = await app.inject({ method: 'POST', url: '/agent', headers: { 'content-type': 'application/json', 'x-agent-games-signature': signature }, payload: body });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: 'INVALID_JSON' });
});
