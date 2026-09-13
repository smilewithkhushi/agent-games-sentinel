# Reference agent build plan — Vercel

Hosting decision: use a separate Vercel project from Agent Games. Keep TypeScript, Node.js, Fastify, Node crypto, and Node's test runner. No language model or LangChain is required.

## Architecture

Agent Games calls the agent's public production HTTPS URL at POST /agent. Fastify verifies the signature over the raw body, validates the request, retrieves or creates the game response, and returns the exact signed JSON. GET /health returns a small health response.

Use Upstash Redis for short-lived response storage in deployed environments. Local development may use an in-memory implementation of the same cache interface. Redis must be separate from the platform database. Store only the minimal replay record, not raw incoming participant payloads.

The deployed cache is mandatory: Vercel may run multiple instances and recycle them. Cache records for at least 600 seconds, keyed by agent namespace plus task_id or matchId/turn. Use atomic create-if-absent and return the stored winner for concurrent duplicates, preserving the same timestamp, UUID, JSON bytes, and signature. Fail safely if shared storage is unavailable; do not silently fall back to instance memory. Separate namespaces for agents, environments, and test modes avoid interference.

## Requirements and hosting adaptations

- Fastify is officially supported on Vercel; use its documented TypeScript entrypoint convention and Node runtime.
- Expose /agent and /health directly on a stable production HTTPS domain. Verify no redirects or Vercel login challenges intercept platform requests. Retain HMAC authentication on /agent.
- Enforce the application-level 16 KB limit, strict schemas, timing-safe HMAC checks, and secret-safe logs.
- Target normal replies under 500 ms, measure both cold and warm requests, and validate against the platform's 15-second deadline. Place compute and Redis close together. Hosting alone does not guarantee the latency target.
- Configure a function duration above the chosen late-test delay; normal mode must still reply promptly. Test invalid JSON and invalid signatures only after incoming authentication succeeds.
- Simulate unavailability through hosting controls on an isolated test deployment, rather than an unauthenticated application control route. Verify the platform's resulting error handling.
- Vercel controls instance lifetime. Persist the replay record before returning and do not depend on shutdown hooks or background work for correctness. Graceful shutdown remains useful for local/Docker execution.
- Keep a Dockerfile for local portability and the original delivery checklist; Vercel deploys source directly.
- Redis introduces necessary outbound traffic. Narrow the original no-outbound design to permit the configured Redis service only; reject redirects for these requests.

## Build order

1. Set up TypeScript, Fastify, environment validation, health route, and tests.
2. Add raw-body HMAC authentication, signed responses, and Gatekeeper decisions. Compare integer balances without floating-point precision loss.
3. Implement the shared cache interface and Redis atomic replay behavior; test concurrent duplicate requests.
4. Confirm the platform's exact VFY protocol, then implement actions, response metadata, and placeholder hash generation.
5. Add failure modes, deadline handling, safe logging, and deployment configuration.
6. Run unit/integration checks and a local Vercel build; publish a separate agent project, configure secrets privately, and verify the public endpoint.
7. Register in Agent Games, run preflight and Gatekeeper practice, complete 20 VFY turns, then test a second deployment with its own secret. Record normal and failure results.

## Information needed before platform integration

- Exact VFY request schemas for practice and competition, including balance and commitment field names/types.
- Exact canonical serialization for publicInputsHash and expected signature header encoding.
- Registration of reference-test-v1 and its matching strategy commitment in the test platform.
- Vercel project/account access and Redis configuration at deployment time. Do not put secrets in chat or commit them.

## Free-tier expectations

Vercel Hobby is restricted to personal, non-commercial use; a platform team's commercial test service may require Pro. Existing platform hosting does not establish agent-project eligibility or spare quota. Upstash currently advertises a free Redis tier with 256 MB and 500,000 commands per month. A request can consume multiple Redis commands. Check account eligibility and current usage before deployment; free service is not guaranteed.

## Official references checked September 13, 2026

- https://vercel.com/docs/frameworks/backend/fastify
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/deployment-protection
- https://vercel.com/docs/plans/hobby
- https://upstash.com/pricing/redis

Status: reference-agent code is complete against the inspected platform source, including preflight and both VFY modes. See ../progress.md and ../test-report.md for verification evidence. The earlier information gaps below are resolved in ../protocol.md; hosted deployment and acceptance are still pending.
