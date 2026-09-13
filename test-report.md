# Test report

Date: September 13, 2026. Scope: the reference-agent code in this repository and test-only snapshots of local Agent Games source revision 0efa2ec.

## Results

| Check | Result | What it establishes |
|---|---|---|
| TypeScript type-check and production compilation | Passed | Application and tests type-check; server source compiles |
| Application/contract tests | 38 passed, including a Node.js 22 run | Authentication, strict schemas, decisions, retries, modes, and platform response compatibility |
| Real local Redis tests | 4 passed (parent plus three subtests) | Atomic SET NX, expiry, proof-ownership Lua, and replay across app instances |
| Real local HTTP tests | 4 passed | Network replies, signed preflight, VFY, bad signatures/JSON, actual timeout, and stopped server |
| Local demo | Passed | Preflight, Gatekeeper, VFY practice, and VFY competition return signed answers |
| Commitment command | Passed | Emits deterministic test policy registration values |
| Local Vercel Fastify builder | Passed | Detected src/server.ts; produced src/server.js, nodejs22.x, Fastify 5.12.4, maxDuration 30 |
| Dependency lock consistency | Passed | Root dependencies match package-lock.json |
| Docker image build | Not run | Docker daemon is not running locally |
| Hosted CI | Not run | Workflow is prepared; no remote execution triggered |
| Hosted Vercel/Upstash and platform acceptance | Not run | No hosted deployment, credentials, or registration was used |

The Vercel builder check used the installed CLI's Fastify builder in an isolated temporary directory with already-installed dependencies. It produced a function containing 551 files. It was not a Vercel cloud deployment and did not exercise live routing, TLS, account settings, or managed Redis.

## Coverage that matters

- HMAC checks include an independent RFC 4231 SHA-256 vector, exact-byte changes, wrong/missing signatures, and invalid UTF-8.
- Request checks reject unsupported types/versions, extra fields, bad identifiers, out-of-range turns, invalid balances, malformed JSON, and bodies above 16 KB.
- Gatekeeper tests cover the original rules, exact large integers, the real practice reused-proof flag, and all 44 generated traps across R01–R04.
- VFY tests validate both reply shapes using snapshots of the platform's strict response schemas. They exercise action thresholds with decimal balances, turn binding, deterministic placeholder hashes, and stable timestamp/UUID replay across concurrent app instances.
- Three local 20-turn practice simulations use the platform's resolver, against HOLD, FORTIFY, and EXTRACT reference opponents. These are local simulations, not hosted practice sessions.
- Competition Gatekeeper proof reuse is tested across rounds, concurrent tasks, and expired response records. The proof claim and selected reply are written atomically.
- Redis tests start a fresh local Redis server and issue real commands through a redis-cli bridge at the REST adapter boundary. They do not verify Upstash HTTPS/authentication or availability.

## Local failure report

| Behavior | Observed result |
|---|---|
| Normal | Signed valid JSON over local HTTP; stable replay |
| Missing request signature | HTTP 401 |
| Invalid response signature | HTTP 200 with a signature that verification rejects |
| Invalid JSON | HTTP 200 with intentionally malformed, signed text |
| Late | A real client with a 15-second deadline timed out; mode waits at least 16 seconds |
| Unavailable | After closing the local server, delivery failed |
| Cache unavailable | HTTP 503; no unsafe fallback to local memory |

Hosted queue handling, task history, match status, proof status, cold starts, and deployment outages remain to be observed after rollout. See deployment.md for that checklist.
