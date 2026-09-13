import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedisStore } from '../../src/cache.js';
import { buildApp } from '../../src/application.js';
import { readConfig } from '../../src/config.js';
import { sign } from '../../src/crypto.js';
import { vfy } from '../fixtures/requests.js';
const exec = promisify(execFile);
test('real Redis transactions through the REST adapter command boundary', { timeout: 20000 }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-redis-'));
    const socket = join(dir, 'redis.sock');
    const server = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(async () => {
        if (server.exitCode === null) {
            await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill('SIGTERM'); });
        }
        await rm(dir, { recursive: true, force: true });
    });
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Redis startup timeout')), 5000);
        server.once('error', error => { clearTimeout(timeout); reject(error); });
        server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Redis startup exited: ${code}`)); });
        server.stdout.on('data', data => { if (/ready to accept connections/i.test(String(data))) {
            clearTimeout(timeout);
            resolve();
        } });
    });
    const command = async (args: (string | number)[]) => {
        const result = await exec('redis-cli', ['-s', socket, '--json', ...args.map(String)], { timeout: 3000 });
        return JSON.parse(result.stdout);
    };
    const fetcher: typeof fetch = async (_input, init) => {
        assert.equal(init?.redirect, 'error');
        return Response.json({ result: await command(JSON.parse(String(init?.body))) });
    };
    const store = new RedisStore('https://redis-test.invalid', 'local-test-token', fetcher);
    const approved = { body: '{"decision":"APPROVE"}', signature: 'a'.repeat(64), fingerprint: 'a' };
    const reused = { body: '{"decision":"REJECT"}', signature: 'b'.repeat(64), fingerprint: 'b' };
    await t.test('SET NX chooses one response, with a 600-second TTL', async () => {
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) => store.putIfAbsent('{test}:race', { ...approved, body: String(i) })));
        assert.equal(new Set(results.map(r => r.body)).size, 1);
        assert.ok(await command(['TTL', '{test}:race']) >= 599);
    });
    await t.test('Lua binds proof ownership and response in one transaction', async () => {
        const results = await Promise.all(['{test}:one', '{test}:two'].map(key => store.putIfAbsent(key, approved, { proofKey: '{test}:proof', reused })));
        assert.deepEqual(results.map(r => r.body).sort(), [approved.body, reused.body].sort());
        const winner = await command(['GET', '{test}:proof']);
        assert.equal(await command(['TTL', '{test}:proof']), -1);
        assert.deepEqual(await store.putIfAbsent(winner, approved, { proofKey: '{test}:proof', reused }), approved);
        await command(['DEL', winner]);
        assert.deepEqual(await store.putIfAbsent(winner, approved, { proofKey: '{test}:proof', reused }), approved);
        assert.deepEqual(await store.putIfAbsent('{test}:third', approved, { proofKey: '{test}:proof', reused }), reused);
    });
    await t.test('two application instances replay the same competition UUID and timestamp', async () => {
        const secret = 'redis-integration-test';
        const config = readConfig({ AGENT_GAMES_HMAC_SECRET: secret });
        const a = buildApp(config, { store });
        const b = buildApp(config, { store: new RedisStore('https://redis-test.invalid', 'test-token', fetcher) });
        try {
            const body = JSON.stringify(vfy());
            const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).inject({ method: 'POST', url: '/agent', headers: { 'content-type': 'application/json', 'x-agent-games-signature': sign(body, secret) }, payload: body })));
            for (const result of results) {
                assert.equal(result.statusCode, 200);
                assert.equal(result.body, results[0]!.body);
            }
        }
        finally {
            await a.close();
            await b.close();
        }
    });
});
