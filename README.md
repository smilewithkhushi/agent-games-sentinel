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

## Deploy on Fly.io

Follow [deployment.md](info/deployment.md). The app is defined in `fly.toml` (app `agent-sentinel`, primary region `gru`) and built from the multi-stage `Dockerfile` (Node.js 22, entrypoint `dist/src/server.js`). The container listens on port 3000; Fly's `http_service` terminates TLS and forces HTTPS, so the public endpoint is HTTPS on 443 as the platform requires.

First-time setup:

```sh
flyctl launch --no-deploy   # only if the app does not exist yet; fly.toml is already committed
flyctl deploy
```

Set runtime configuration as Fly secrets (never commit them):

```sh
flyctl secrets set \
  AGENT_GAMES_HMAC_SECRET=... \
  CACHE_BACKEND=redis \
  AGENT_NAMESPACE=reference-prod \
  UPSTASH_REDIS_REST_URL=... \
  UPSTASH_REDIS_REST_TOKEN=... \
  REFERENCE_AGENT_MODE=normal \
  REFERENCE_AGENT_DELAY_MS=0
```

- `AGENT_GAMES_HMAC_SECRET`: this agent's registration secret.
- `CACHE_BACKEND=redis`: required so idempotent replays survive across machines, since `fly.toml` allows autoscaling to zero and multiple machines.
- `AGENT_NAMESPACE`: unique to the registration and environment.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: private Redis credentials.
- `REFERENCE_AGENT_MODE=normal` and `REFERENCE_AGENT_DELAY_MS=0`.

Pushes to `main` or `master` auto-deploy through [.github/workflows/fly-deploy.yml](.github/workflows/fly-deploy.yml), which runs `flyctl deploy --remote-only` using the `FLY_API_TOKEN` repository secret. Create that token with `flyctl tokens create deploy` and add it under the repository's Actions secrets.

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
