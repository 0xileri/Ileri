import type { AppContext } from '../context';
import { hmac, safeEqual } from '../lib/crypto';

const DEFAULT_TTL_SECONDS = 15 * 60;

/** Short-lived link to a private file. Issued only after an access check. */
export function signedMediaUrl(ctx: AppContext, mediaId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(ctx.config.secret, `media:${mediaId}:${exp}`);
  return `/media/${mediaId}?exp=${exp}&sig=${sig}`;
}

export function verifyMediaSignature(ctx: AppContext, mediaId: string, exp: string, sig: string): boolean {
  const expiry = Number.parseInt(exp, 10);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(hmac(ctx.config.secret, `media:${mediaId}:${expiry}`), sig);
}
