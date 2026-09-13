# Deployment — why and how to host the reference agent

## Current readiness

The reference-agent code is complete against the inspected local Agent Games protocol. Signed preflight, Gatekeeper practice/rounds, VFY practice/competition, retry storage, and failure modes are implemented. The former VFY 501 placeholder has been removed.

Local application, Redis, HTTP, and Vercel-builder verification is recorded in [test-report.md](test-report.md). No hosted agent URL or platform registration has been created. Code completion does not mean live platform acceptance has passed.

## Why deploy this particular agent?

Deploy it to give Agent Games a predictable participant that the actual platform can reach over HTTPS. The team can compare its known decisions with platform history, test signatures, resend tasks, and deliberately produce late or malformed replies. A laptop-only demonstration cannot establish that the hosted platform's real delivery path works.

This is a test/demo participant. It does not generate real zk proofs, run an AI model, or replace a competing team's agent. Its value is making platform integration failures easy to reproduce before external participants join.

## Deployment layout

Use a separate Vercel project from the Agent Games website, plus dedicated Upstash Redis storage. Each agent registration has its own secret and namespace. The same code can be deployed twice for pairing tests. Hosting independence lets the team stop or change an agent without changing the platform application.

Use the Fastify framework preset, Node.js 22, and src/server.ts as the detected entrypoint. Do not set an output directory: the Fastify builder deploys the server source. `vercel.json` and the entrypoint both specify a 30-second maximum duration. The local builder selected the expected entrypoint and produced a Node.js 22 Fastify function successfully.

## Environment settings

| Setting | Value |
|---|---|
| AGENT_GAMES_HMAC_SECRET | Private secret for this registration |
| CACHE_BACKEND | redis |
| AGENT_NAMESPACE | Unique registration/environment name, such as reference-test-a |
| UPSTASH_REDIS_REST_URL | Dedicated Redis HTTPS REST origin |
| UPSTASH_REDIS_REST_TOKEN | Private Redis token |
| REFERENCE_AGENT_MODE | normal initially |
| REFERENCE_AGENT_DELAY_MS | 0 initially |

Keep secrets in Vercel's private environment settings. Do not put them in source, documentation, or chat. The code refuses memory caching on Vercel. Redis response records last ten minutes; hashed Gatekeeper proof-ownership records persist across rounds until the test namespace is retired. Keep the namespace stable during a test tournament and distinct between participants.

## Rollout steps

1. Using Node.js 22, run `npm ci` and `npm run check`. Run `npm run demo` to see signed example responses locally.
2. Check the Vercel account's plan eligibility and quotas. Free hosting is not guaranteed for a commercial platform project.
3. Import this agent as a separate Vercel project. If using the current parent repository, set the root directory to `agent-sentinel`; otherwise use the root of a dedicated agent repository. The current workspace lives inside the parent `ai-agents` Git repository; a separate remote repository has not been created.
4. Configure the environment values above. Use a temporary private HMAC secret to start the initial deployment before registration.
5. Deploy and open the stable production HTTPS `/health` URL. A healthy response only proves the process is alive, not that Redis or platform authentication works.
6. Register the public production `/agent` URL in Agent Games. Replace the setup secret with the one-time registration secret and redeploy.
7. Ensure `/agent` is reachable without Vercel login challenges, redirects, or URL credentials. Run the signed Agent Settings preflight until the platform marks the agent active.
8. Run Gatekeeper practice and inspect decisions/history. Check repeated tasks and live Redis behavior.
9. Run a VFY practice session through all 20 turns. Practice needs no registered strategy commitment in the inspected platform dispatcher.
10. For competition-envelope testing, use a non-production platform environment. Run `npm run commitment` and register its exact commitmentHash, circuitVersion, and policyVersion. Deploy/register a second agent with another secret and namespace for pairing tests.
11. Measure cold and warm response latency. Normal replies target under 500 ms and must arrive within the platform deadline.
12. Run the failure experiments below and record hosted outcomes. Restore normal mode afterward.

## Failure experiments

| Experiment | Setup | Expected platform behavior |
|---|---|---|
| Normal | mode normal, delay 0 | Accept signed response and record the result |
| Bad signature | mode invalid_signature | Reject the signature |
| Bad JSON | mode invalid_json | Reject malformed response JSON |
| Late reply | mode late | Time out before the deliberately delayed response |
| Unavailable | Stop/disable an isolated agent deployment through hosting controls | Fail delivery or time out safely |

Environment changes require a new deployment to take effect. Use a test registration and inspect the queue/match outcome for each case. `unavailable` is not a supported runtime mode; there is no public control route.

## Proof-placeholder expectations

The generated reference-test-v1 metadata is not a zk proof. The platform must not count it as verified. The inspected platform practice code has a display discrepancy: it stores pending but returns verified in its UI result. Competition resolution moves a match to proof_pending and requires the platform's test/operator lifecycle to continue. These platform-side limitations are documented in [protocol.md](protocol.md); they are not changes the agent can make.

## Completion of hosted acceptance

After rollout, record the actual URL, preflight result, practice results, response timing, and failure outcomes. Only then is the original delivery/acceptance checklist complete. A successful local build or code test alone does not establish hosted queue, proof, or match behavior.
