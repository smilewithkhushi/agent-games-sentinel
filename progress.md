# Progress

**Current status:** reference-agent code complete against the inspected platform contracts. Local verification is recorded in test-report.md. Hosted deployment and acceptance remain pending. Earlier entries below are development history.

## September 13, 2026 — Implementation started

- Reviewed the product requirements and Vercel's Fastify support.
- Selected TypeScript, Node.js 22, Fastify, and Redis for deployed replay storage.
- Started the server, authentication, Gatekeeper, cache, test suite, and documentation.
- Requested the platform's full VFY protocol. Strategy can be implemented independently; the HTTP adapter must wait for verified field names and hash serialization.
- No deployment or platform registration has happened yet.

## September 13, 2026 — First implementation verified

### Completed

- Created the Fastify service with GET /health and POST /agent.
- Added exact-body HMAC verification and signed JSON responses, strict Gatekeeper validation, 16 KB body limits, and safe error codes.
- Implemented all Gatekeeper branches with exact integer arithmetic.
- Implemented local memory and Upstash Redis replay stores with ten-minute expiry and atomic duplicate handling. Conflicting retries return 409; storage failures return 503.
- Added normal, late, invalid-signature, and invalid-JSON behavior, including immediate handling of already-expired tasks without artificial delay.
- Implemented and tested VFY's pure strategy. Its HTTP adapter remains explicitly disabled with 501 until protocol confirmation.
- Added environment validation, local shutdown handling, Vercel configuration, Dockerfile, lockfile, and GitHub Actions checks.
- Created README.md, architecture.md (including diagrams), and decisions.md. Updated the hosting plan status.

### Verification evidence

- TypeScript type-check and compilation passed.
- Initial 18-test suite passed on local Node.js 24.8.0 and target Node.js 22.23.2.
- Added an independent RFC 4231 HMAC test vector; final 19-test suite passed on Node.js 22.23.2, with zero failures.
- Tests include every Gatekeeper branch, VFY strategy boundaries, malformed and unauthorized requests, oversized bodies, concurrent duplicate requests through two app instances sharing storage, cache expiration, Redis command semantics and failures, late-mode delay selection, and configuration validation.
- Redis tests use mocked HTTP responses; no live Redis account was used. Late-mode tests inject a clock wait substitute; they do not prove platform timeout behavior.
- Dependency install reported zero vulnerabilities. The host's default Node.js 24 produces an engine warning because deployment is pinned to 22; compatibility was separately checked on 22.
- The initial test launcher needed a sandbox-incompatible IPC socket. Switched to Node's test runner with the tsx import hook; checks now run without that socket.

### Still pending

1. Platform source or a complete VFY payload and exact hash serialization. Confirm Gatekeeper's full envelope and signature encoding too.
2. Live Redis integration and latency measurements.
3. Vercel build/deployment verification, public URL checks, and hosting-plan eligibility. No Vercel project has been created or changed.
4. Platform registration/secret configuration, preflight, Gatekeeper practice, 20-turn VFY practice, second-agent pairing, and a real failure-mode report.
5. Docker image build and hosted CI execution; files are prepared but these environments were not run.

The first implementation milestone is complete. The full product acceptance criteria are not yet met. Never treat local tests as evidence of a deployed platform connection.

## September 13, 2026 — Deployment purpose and readiness documented

- Added deployment.md explaining why this reference agent needs a public deployment, why it runs separately from the platform, the planned rollout, environment settings, and completion criteria.
- Linked the deployment guide from README.md.
- Explicitly distinguished a limited hosting/Gatekeeper test from full VFY readiness. The missing protocol integration and live verification remain pending.
- Documentation-only update; no application changes, deployments, or new test runs.


## September 13, 2026 — Remaining agent code completed

- Found and read the actual platform source in the-verifiable-games (revision 0efa2ec), without modifying it. Confirmed HMAC encoding and all request/reply shapes.
- Added signed registration preflight and removed the VFY-not-configured placeholder.
- Implemented VFY practice and competition schemas, decimal-safe strategy, bound placeholder hashes, competition UUID/timestamp metadata, and exact concurrent retry replay.
- Supported observed Gatekeeper practice metadata, proof_reused, and all richer round traps. Added atomic hashed proof ownership across rounds.
- Added test-only snapshots of the platform's validators, signature helper, resolver, and trap generator with source hashes.
- Added local demo and policy-commitment commands, real Redis/HTTP integration suites, and production-only compilation.
- Corrected Vercel detection by using a single server entrypoint; the factory is now src/application.ts. Added an explicit Fastify preset and static 30-second duration.
- Verified 38 application/contract tests, real local Redis transactions, real local HTTP failure cases, and a local Vercel builder output. The builder check runs in an isolated copy; an initial in-place builder attempt damaged temporary source copies, which were restored and rechecked before completion.
- Refreshed README, architecture.md, decisions.md, deployment.md, and the hosting-plan status. Added protocol.md and test-report.md.

### Remaining work is hosted rollout

No agent code placeholder remains. Deploy with real Redis settings, register the agent, verify preflight and practice, measure hosted latency, and record platform failure outcomes. The local platform's proof-status/display limitations are documented in protocol.md. Docker image execution remains unverified because the local daemon is stopped; hosted CI has not run. A separate remote Git repository has not been created.
