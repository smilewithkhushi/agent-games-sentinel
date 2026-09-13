import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const sign = (body: string | Buffer, secret: string) => createHmac('sha256', secret).update(body).digest('hex');
// Wire encoding confirmed in Agent Games lib/agent-signature.ts: bare 64-character hex.
export function verify(body: Buffer, signature: unknown, secret: string): boolean {
  if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(sign(body, secret), 'hex'), Buffer.from(signature, 'hex'));
}
