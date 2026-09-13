# Decisions

Updated September 13, 2026 after inspecting the actual platform source. Earlier protocol assumptions have now been resolved; these are the current decisions.

## D001 — Keep TypeScript, Node.js 22, and Fastify

The stack remains the one selected with the user. Node supplies cryptography and tests. Zod validates requests strictly without stripping unknown fields or coercing request values. No model, LangChain, frontend, or platform database connection is necessary.

## D002 — Separate Vercel project with one detectable entrypoint

Use the Fastify preset explicitly. src/server.ts is the sole recognized entrypoint, with a Fastify type import and a static 30-second maxDuration. The server factory is src/application.ts, preventing accidental selection of a non-listening factory as the entrypoint. A local Vercel Fastify builder check is part of the verification report. Docker remains optional portability packaging; production compilation includes only server source.

## D003 — Redis is mandatory on Vercel

Instance memory cannot preserve retries across server copies. Redis replies expire after 600 seconds. Atomic SET NX selects one winner during concurrent VFY requests; everyone returns the stored UUID, timestamp, body, and signature. Keys include separate agent, environment/mode, game-family, and secret-derived namespaces. A cache outage returns 503 rather than silently falling back to memory. The HTTPS REST adapter rejects redirects and limits each request to two seconds.

## D004 — Use the inspected platform protocol

The local platform at revision 0efa2ec confirmed bare-hex HMAC encoding and supplied the missing schemas. Requests verify exact bytes before UTF-8 decoding and parsing. Missing or invalid signatures return 401. Supported authenticated requests produce signed replies. Errors use stable codes without raw payloads or backend exception details. Preflight is a signed POST flow, distinct from GET /health.

## D005 — Separate VFY practice and competition response shapes

This supersedes the earlier disabled-VFY decision. Practice's strict platform schema forbids agentTimestamp and idempotencyKey, while competition requires both. The agent returns the appropriate shape for each mode. Practice omits a strategy commitment, so its placeholder hash uses the reference policy commitment. Competition binds the supplied commitment. Transport nonces and delivery times are excluded from replay fingerprints because the platform regenerates them during delivery retries.

## D006 — Define the placeholder convention explicitly

The platform checks publicInputsHash syntax and circuit registration but does not implement canonical hash recomputation or real verification. Use SHA-256 over the compact JSON array `[matchId, turn, action.type, amountOrNull, lowercaseCommitment]`. This is a documented integration-test convention, not an assertion about a future zk circuit. Keep circuit version reference-test-v1. A command prints the exact policy and registration hash; no automatic registration or proof-verification claim is made.

## D007 — Support actual Gatekeeper traps as well as the brief

The platform sends proof_reused during practice and richer round inputs without proof_valid. Add strict schemas and checks for those observed variants, preserving the original reference schema. Use BigInt for Gatekeeper amounts and scaled integer arithmetic for VFY decimal balances. Local tests evaluate all generated platform traps across R01–R04.

## D008 — Atomic hashed proof ownership across rounds

Gatekeeper's round generator reuses prior-round proof_tx values. Keep only hashed proof references and hashed owning task keys in dedicated agent storage. A Lua transaction chooses the decision and records proof ownership together, so concurrent requests or a lost response cannot both approve different tasks using the same proof. Owner records outlive the ten-minute response cache and remain until the test namespace is retired. Local memory is bounded at 10,000 records per map and fails safely when full; it is not suitable for multi-instance or restart-safe rounds. This extends the initial short-lived-cache-only design to support observed platform round behavior, without storing raw participant requests.

## D009 — Failure modes stay private and deliberate

normal, late, invalid_signature, and invalid_json are environment settings. Invalid signatures flip one nibble of the correct signature, guaranteeing a mismatch. Late mode waits at least 16 seconds, capped at 25 seconds when a longer delay is configured. Expired requests skip intentional waits. Unavailability is a hosting-level experiment; the application rejects unavailable as a runtime setting. Fault modes have separate caches.

## D010 — Code completion and hosted acceptance are different milestones

The reference-agent implementation is complete against the inspected local platform contracts. Hosted preflight, live Upstash transport, Vercel cold-start latency, queue/match behavior, and hosted failure reports still need verification after deployment. No test should describe a local resolver simulation as a live practice session. Test-only platform snapshots record source hashes and do not import platform database code at runtime.

## D011 — Record platform proof-status limitations

The platform's practice action stores pending proof status but returns verified in its UI result. Competition enters proof_pending and requires the platform's test/operator lifecycle to continue. The agent does not claim to fix either platform behavior and does not generate a real proof. These observations are documented in protocol.md; platform source was not modified.

## References

- Local platform sources and snapshot hashes: tests/fixtures/platform/sources.json and protocol.md.
- Fastify on Vercel: https://vercel.com/docs/frameworks/backend/fastify
- Raw body parsing: https://fastify.dev/docs/latest/Reference/ContentTypeParser/
- Redis atomic writes: https://upstash.com/docs/redis/sdks/ts/commands/string/set
