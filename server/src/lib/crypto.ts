import crypto from 'node:crypto';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hmac(secret: string, value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const BASE32 = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Short, unguessable, URL-friendly id (about 100 bits). */
export function publicId(prefix: string, length = 20): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += BASE32[b % BASE32.length];
  return `${prefix}_${out}`;
}
