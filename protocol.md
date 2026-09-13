# Agent protocol and platform compatibility

The implementation now follows the local Agent Games source at revision `0efa2ec`, found in `/Users/khushipanwar/Desktop/the-verifiable-games`. The platform repository was read, not modified. Test-only snapshots record source file hashes in `tests/fixtures/platform/sources.json`; no platform application or database is a runtime dependency.

## Authentication

Send UTF-8 JSON to `POST /agent` with `Content-Type: application/json`. Compute HMAC-SHA256 over the exact body bytes using the shared registration secret, then put its bare hexadecimal encoding in `x-agent-games-signature`. Successful replies use the same format over the exact response text. This matches the platform's `lib/agent-signature.ts`.

The 16 KB limit applies before parsing. Requests with bad signatures receive 401. Authenticated malformed JSON receives 400. Valid JSON with unknown fields or unsupported versions receives 400. Conflicting task inputs under one replay key receive 409. Storage failures receive 503. Error bodies use stable codes; they are not game responses and are not signed.

## Supported request families

| Request | Source of truth | Reply |
|---|---|---|
| Signed preflight | `lib/agent-preflight.ts` | `{"ok":true,"protocolVersion":"v1"}` |
| Gatekeeper practice | `app/actions/dispatch-practice-task.ts` | decision and reason_code |
| Gatekeeper competition rounds | `lib/gatekeeper/round-dispatch.ts`, `lib/gatekeeper/traps.ts` | decision and reason_code |
| VFY practice | `app/actions/dispatch-vfy-practice.ts` | matchId, turn, action, policyProof |
| VFY competition in a test environment | `lib/steal-the-vfy/turn-delivery.ts`, `lib/steal-the-vfy/match-engine.ts` | practice fields plus agentTimestamp and idempotencyKey |

`GET /health` is an unauthenticated liveness check. It does not replace signed preflight.

## Gatekeeper details

The original reference payload in `info/about.md` remains supported. Optional envelope fields `mode` and `issued_at` support real platform delivery. Practice can include the boolean `proof_reused`, which is rejected with PROOF_REUSED when true.

Competition round inputs omit `proof_valid` and supply recipient, condition_recipient, expiry_block, current_block, amount, max_transfer, and proof_tx. This is a separate strict schema, not permissive acceptance of arbitrary fields. The reference agent checks key substitution, balance, expiry, recipient matching, transfer limits, and previously accepted proof references. It does not cryptographically verify proof_tx.

For competition reuse detection, the cache atomically records a hashed proof reference's first owning task along with the decision. A different task using that proof is rejected. The owner record persists across rounds; exact response records expire after ten minutes. Redis owner records remain until the test database/namespace is retired. Local memory loses them on process restart. Never reuse a namespace for a different participant. This small test ledger adds no platform database access.

## VFY request example

```json
{
  "protocolVersion": "v1",
  "eventId": "steal-the-vfy",
  "mode": "competition",
  "matchId": "00000000-0000-4000-8000-000000000001",
  "turn": 1,
  "issuedAt": "2026-09-13T00:00:00.000Z",
  "deadlineAt": "2026-09-13T00:00:15.000Z",
  "state": {
    "selfBalance": "100",
    "opponentBalance": "100",
    "selfFortifiedUntilTurn": null,
    "opponentFortifiedUntilTurn": null
  },
  "strategyCommitment": { "hash": "0x3d18c4397aada482554bed8434aa6b02224c97e079491da39933a19082a2c88b" },
  "resolverVersion": "v1-draft",
  "nonce": "00000000-0000-4000-8000-000000000002"
}
```

Practice sets mode to `practice`, omits strategyCommitment, and adds `state.priorTurnHash` (initially `0x0`, later a record ID). These differences match the actual dispatchers. Balances are nonnegative decimal strings and are compared exactly. Turns are integers from 1 through 20; identifiers/nonces are UUIDs.

Competition responses include a generated UUID and timestamp. Practice responses omit them because the platform's strict practice schema rejects those additional fields. Retries reuse the original body, timestamp, UUID, and signature. Changed nonce, issuedAt, or deadline does not make a new decision. Changes to state or commitment under the same match/turn cause 409. Practice and competition have separate replay namespaces.

## Placeholder hash convention

There is no canonical cryptographic hash algorithm enforced by the inspected platform acceptance code: it checks the hash format and the registered circuit version, then leaves proof validation pending. We define the following deterministic convention for this test agent:

1. Serialize a JSON array with no added whitespace: `[matchId, turn, action.type, amountOrNull, commitmentHash.toLowerCase()]`.
2. amountOrNull is 5 for EXTRACT, otherwise null.
3. Hash the UTF-8 bytes with SHA-256; return `0x` followed by lowercase hexadecimal.

This is a reference-test convention, not a claim of compatibility with a future proof circuit. Competition uses the received strategyCommitment hash. Practice sends no commitment, so it uses this agent's deterministic reference policy commitment.

Run `npm run commitment` to print the policy, commitment hash, `reference-policy-v1` policy version, and `reference-test-v1` circuit version. Register those exact values before opening a test competition match. The commitment is SHA-256 over the ordered JSON policy emitted by the implementation. The agent binds the supplied competition commitment into its hash; it does not independently verify the platform's commitment registry.

## Platform caveats discovered during review

The practice dispatcher stores proofStatus `pending` but returns `verified` in its UI result. The agent cannot fix that platform-side display discrepancy and never claims its metadata is a verified proof. Competition resolution sets the match to `proof_pending`; continuing such matches requires the platform's non-production operator/proof lifecycle. No platform files were changed as part of this agent task.

These are local-source compatibility checks. The deployed platform may run another revision; confirm the same protocol during hosted preflight and practice.
