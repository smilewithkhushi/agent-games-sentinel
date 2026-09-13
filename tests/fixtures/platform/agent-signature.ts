// Platform contract snapshot: lib/agent-signature.ts, revision 0efa2ec. Test-only.
import { createHmac, timingSafeEqual } from "crypto";

export function signAgentMessage(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function hasValidAgentSignature(secret: string, body: string, signature: string | null) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signAgentMessage(secret, body), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
