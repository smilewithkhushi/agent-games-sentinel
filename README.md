# Agent Sentinel — reference agent

A complete reference-agent implementation for Agent Games, built with TypeScript, Node.js 22, Fastify, and Redis. It supports signed preflight, Proof Gatekeeper, and both Steal the VFY practice and competition envelopes. It is a predictable test participant, not a real proof verifier or AI competitor.

The code has local automated coverage against the platform's source contracts. It has not been deployed or registered on the hosted platform. See [test-report.md](info/test-report.md) for the exact verification boundaries.

## Try it without any accounts

Install Node.js 22, then run:

```sh
npm ci
npm run demo
```

The demo sends signed local requests through all four flows and prints their answers. It needs no API key, Redis account, or environment file, and makes no external requests.

## Run the server locally

1. Copy `.env.example` to `.env`.
2. Set `AGENT_GAMES_HMAC_SECRET` to a private local test value.
3. Run `npm run dev`.
4. Open http://localhost:3000/health to check that it is running.

POST /agent requires application/json and an x-agent-games-signature header containing the HMAC-SHA256 of the exact body, encoded as bare hex. This matches the inspected platform source. Unsigned requests receive 401. GET /health is only a liveness check. For step-by-step local testing examples, see the [Testing Guide](info/testing-guide.md).

## Useful commands

| Command | Purpose |
|---|---|
| `npm run check` | Type-check all code/tests, run application tests, and compile the server |
| `npm run demo` | Exercise preflight, Gatekeeper, and both VFY modes locally |
| `npm run commitment` | Print the policy and commitment values to register for a VFY test match |
| `npm run test:redis` | Test actual Redis transactions; requires redis-server and redis-cli locally |
| `npm run test:http` | Test real local HTTP and failure modes; takes about 16 seconds |
| `npm run build` | Compile server source into dist/src |
| `npm start` | Run the compiled server using environment settings |

The local Redis test starts its own temporary server with no TCP port, uses a local socket, and cleans up afterward. It never touches an existing Redis database. The HTTP tests start temporary loopback servers and close them afterward.

## Deploy on Vercel

Follow [deployment.md](info/deployment.md). Use a separate project with the Fastify framework preset and Node.js 22. Runtime settings are:

- `AGENT_GAMES_HMAC_SECRET`: this agent's registration secret.
- `CACHE_BACKEND=redis`.
- `AGENT_NAMESPACE`: unique to the registration and environment.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: private Redis credentials.
- `REFERENCE_AGENT_MODE=normal` and `REFERENCE_AGENT_DELAY_MS=0`.

The entrypoint is src/server.ts. The factory lives in src/application.ts so Vercel cannot select it as another server entrypoint. The function duration is 30 seconds. A local Vercel Fastify builder check succeeded; publishing and live platform checks remain separate tasks.

Use test registrations for placeholder proofs and failure experiments. Do not treat `reference-test-v1` metadata as a verified cryptographic proof.

## Documentation

- [Testing Guide](info/testing-guide.md): beginner-friendly walkthrough of endpoints, auth, and local test scripts.
- [Architecture](info/architecture.md): beginner-friendly stack and flow diagrams.
- [Deployment](info/deployment.md): why to deploy, configuration, and rollout.
- [Protocol](info/protocol.md): exact request formats and source compatibility notes.
- [Test report](info/test-report.md): verification results and limitations.
- [Progress](info/progress.md): development history and outstanding hosted checks.
- [Decisions](info/decisions.md): implementation choices and reasons.
- [Requirements](info/about.md): original brief.
