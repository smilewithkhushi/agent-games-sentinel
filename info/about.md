# Reference Agent — Product Requirements Document

## 1. Plain-English summary

Build a small, independent web service that behaves like a participant’s AI agent on Agent Games. Its purpose is to let the platform team test the complete platform-to-agent connection before external teams join: public endpoint checks, shared-secret authentication, decisions, retries, timeouts, queue delivery, practice history, and Steal the VFY turn handling.

It is a **test and demo agent**, not a competitor and not a replacement for an actual AI agent. It should be deployable separately from the Agent Games platform and registered through the normal participant flow.

## 2. What it must prove

The reference agent must prove that the following already-built platform features work end to end:

1. The platform can safely call a public HTTPS endpoint.
2. The endpoint can verify that a request genuinely came from Agent Games.
3. The endpoint can make a deterministic decision and return valid signed JSON within the deadline.
4. The platform can store the response, show it in practice/history, and resolve a Steal the VFY turn.
5. Deliberate bad behaviors can be simulated: a late reply, invalid signature, invalid JSON, and unavailable endpoint.

## 3. Out of scope

Do not build these features in the reference agent yet:

- Real zkVerify proof generation or verification.
- A production model, autonomous strategy, user accounts, payments, or a dashboard.
- Storage of participant data or platform database access.
- Any ability to call Agent Games administrative APIs.

Steal the VFY turns can use protocol-valid placeholder proof metadata only for non-production integration tests. The platform leaves those turns as `proof_pending`; it must not treat the placeholder as a real cryptographic proof.

## 4. Required endpoint

Expose one endpoint:

```text
POST /agent
```

It must be public HTTPS on port 443, with no URL credentials and no redirects. It receives two request families on this one endpoint:

- Proof Gatekeeper tasks.
- Steal the VFY practice and competition turn envelopes.

The service should also expose an unauthenticated health endpoint for its own hosting provider:

```text
GET /health
```

Return a small JSON response such as `{ "ok": true }`. This health endpoint is not used as Agent Games authentication.

## 5. Shared-secret authentication

At setup, copy the one-time HMAC secret shown by Agent Games into the reference agent’s deployment environment as `AGENT_GAMES_HMAC_SECRET`.

For every `POST /agent` request:

1. Read the exact raw UTF-8 body before parsing it.
2. Compute `HMAC-SHA256(rawBody, AGENT_GAMES_HMAC_SECRET)`.
3. Compare it safely to the `x-agent-games-signature` request header.
4. Reject a missing or invalid signature with HTTP 401.
5. Create the response JSON.
6. Compute the same HMAC over the exact response JSON string.
7. Return it in `x-agent-games-signature`.

Never log, return, commit, or expose the secret. Use timing-safe signature comparison.

## 6. Behavior: Proof Gatekeeper

The request uses `type: "agent-games.proof-gatekeeper.v1"` and has these relevant fields:

```json
{
  "task_id": "practice_<uuid>",
  "deadline_at": "2026-09-10T00:00:15.000Z",
  "input": {
    "registered_vk": "0x...",
    "proof_vk": "0x...",
    "proof_valid": true,
    "minimum": "1000",
    "public_balance": "1460"
  }
}
```

Reference decision rules:

- Reject if `proof_valid` is false: `PROOF_INVALID`.
- Reject if `registered_vk` and `proof_vk` differ: `VK_SUBSTITUTION`.
- Reject if `public_balance` is less than `minimum`: `THRESHOLD_MISMATCH`.
- Otherwise approve: `CONDITION_VALID`.

Required response:

```json
{
  "decision": "APPROVE",
  "reason_code": "CONDITION_VALID"
}
```

`decision` must be exactly `APPROVE` or `REJECT`. `reason_code` must use uppercase letters, digits, underscores, colons, or hyphens and be 2–80 characters.

## 7. Behavior: Steal the VFY

The request has `eventId: "steal-the-vfy"`, a `matchId`, a `turn`, a deadline, current self/opponent balances, a strategy-commitment hash, and a random nonce.

Reference strategy — simple and deterministic:

- If the agent has fewer than 10 VFY, use `HOLD`.
- If the opponent has at least 15 VFY more than the agent, use `FORTIFY`.
- Otherwise use `EXTRACT` with amount `5`.

The response must echo exactly the received `matchId` and `turn`:

```json
{
  "matchId": "<received match ID>",
  "turn": 1,
  "action": { "type": "EXTRACT", "amount": 5 },
  "policyProof": {
    "circuitVersion": "reference-test-v1",
    "publicInputsHash": "0x<64 lowercase hexadecimal characters>"
  },
  "agentTimestamp": "2026-10-01T12:00:01.000Z",
  "idempotencyKey": "<new UUID>"
}
```

For integration tests only, derive `publicInputsHash` deterministically as a SHA-256 hash of the canonical match ID, turn, action, and commitment hash. It is **not a zk proof**. Before opening a test match, register the exact `reference-test-v1` circuit version with the matching strategy commitment in Agent Games.

## 8. Idempotency and deadlines

- Use `task_id` as the idempotency key for Gatekeeper tasks.
- Use the combination of `matchId` and `turn` as the idempotency key for VFY.
- Cache the already-generated response for at least 10 minutes. A network retry must return the same response body and signature rather than make a fresh decision.
- Respond well within 15 seconds; target under 500 ms for normal mode.
- If the deadline has already passed, return a valid response immediately for test observability, but expect Agent Games to reject it.

## 9. Test modes

Configure behavior only through server environment variables; never add an unauthenticated browser control panel.

| Variable | Normal default | Test use |
|---|---|---|
| `REFERENCE_AGENT_MODE` | `normal` | `late`, `invalid_signature`, `invalid_json`, `unavailable` |
| `REFERENCE_AGENT_DELAY_MS` | `0` | Controlled delay for timeout testing |
| `AGENT_GAMES_HMAC_SECRET` | required | The one-time secret from registered agent settings |
| `PORT` | provider default | HTTP listen port |

`late` may sleep longer than the platform deadline. `invalid_signature` returns valid JSON with the wrong signature. `invalid_json` intentionally returns malformed body. `unavailable` should be performed by stopping the deployed service, rather than adding a route that exposes an unsafe behavior.

## 10. Suggested simple tech stack

- **Node.js 22 LTS** and **TypeScript**.
- **Fastify** or **Express** for the tiny HTTP service. Fastify is preferred for built-in request-size limits and straightforward raw-body handling.
- Node’s built-in `crypto` for HMAC, SHA-256, UUIDs, and timing-safe comparison.
- An in-memory idempotency cache for development; Redis only if the test deployment will run multiple instances.
- Dockerfile, environment-variable validation, structured logs with secrets redacted, and a basic CI type-check/test job.

Avoid a database unless test results need to survive restarts. Agent Games is the source of truth for tasks, turns, and scores.

## 11. Security and reliability requirements

- Limit request bodies to 16 KB or less.
- Accept only `POST /agent` for agent work.
- Disable redirects from any outbound request; the reference agent should not need outbound network access.
- Validate JSON schemas strictly and reject unknown or malformed requests safely.
- Do not print raw requests if they could contain identifiers; use request IDs and safe summary fields in logs.
- Handle graceful shutdown so in-flight requests finish where possible.
- Return correct `Content-Type: application/json`.
- Include unit tests for valid HMAC, invalid HMAC, every Gatekeeper decision branch, VFY action selection, and idempotent replay.

## 12. Delivery checklist

The engineering team should deliver:

- A separate Git repository with readable setup instructions.
- `POST /agent` and `GET /health`.
- Dockerfile and `.env.example` without secrets.
- A deployed public HTTPS URL.
- A short test report showing normal, invalid-signature, invalid-JSON, late, and unavailable behaviors.
- Unit tests and a command that runs them locally.

## 13. Platform integration checklist

1. Deploy the reference agent independently.
2. Register its public `/agent` URL in Agent Games.
3. Save the displayed one-time HMAC secret in the reference agent environment.
4. Run Agent Settings preflight until the agent is `active`.
5. Test Proof Gatekeeper practice and inspect task history.
6. Test VFY practice through all 20 turns.
7. Create a second reference agent with a separate secret for a live VFY pairing test.
8. Use the operator turn-open flow only in a test environment; inspect the match room after both replies and after a forced timeout.

## 14. Acceptance criteria

The work is complete when a non-technical platform operator can register the deployed service as an agent, run preflight successfully, see correct Gatekeeper decisions, complete a 20-turn VFY practice session, and demonstrate that malformed, unsigned, late, and unavailable responses are safely rejected or time out without breaking the queue or match state.
