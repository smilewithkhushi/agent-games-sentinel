import { CIRCUIT_VERSION, POLICY_JSON, STRATEGY_COMMITMENT } from '../src/games.js';
console.log(JSON.stringify({ circuitVersion: CIRCUIT_VERSION, policyVersion: 'reference-policy-v1', commitmentHash: STRATEGY_COMMITMENT, policy: JSON.parse(POLICY_JSON), warning: 'Integration-test metadata only. This is not a zk proof.' }, null, 2));
