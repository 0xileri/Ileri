import crypto from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import type { AppContext } from '../context';
import { authNonces } from '../db/schema';
import { AppError } from '../lib/errors';


const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;
const MAX_VALIDITY_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

const reject = (message: string) => new AppError(401, 'siwe_invalid', message);

export async function issueNonce(ctx: AppContext): Promise<string> {
  // Hex is alphanumeric, as EIP-4361 requires.
  const nonce = crypto.randomBytes(16).toString('hex');
  await ctx.db.insert(authNonces).values({ nonce, expiresAt: new Date(Date.now() + NONCE_TTL_MS) });
  return nonce;
}

/**
 * Verifies a Sign-In with Ethereum message: domain and URI binding, freshness,
 * expiry, signature, and finally single use of the server-issued nonce.
 */
export async function verifySiwe(
  ctx: AppContext,
  input: { message: string; signature: string },
): Promise<{ address: string; chainId: number }> {
  if (input.message.length > 4000) throw reject('Sign-in message is too long.');
  let fields: ReturnType<typeof parseSiweMessage>;
  try {
    fields = parseSiweMessage(input.message);
  } catch {
    throw reject('Sign-in message could not be read.');
  }
  const { address, domain, uri, nonce, version, chainId, issuedAt, expirationTime, notBefore } = fields;
  if (!address || !isAddress(address) || !domain || !uri || !nonce || version !== '1' || !chainId) {
    throw reject('Sign-in message is missing required fields.');
  }

  const allowedHosts = new Set(ctx.config.appOrigins.map((o) => new URL(o).host));
  if (!allowedHosts.has(domain)) throw reject('Sign-in message was created for a different site.');
  let uriOrigin: string;
  try {
    uriOrigin = new URL(uri).origin;
  } catch {
    throw reject('Sign-in message URI is invalid.');
  }
  if (!ctx.config.appOrigins.includes(uriOrigin) || new URL(uri).host !== domain) {
    throw reject('Sign-in message URI does not match this site.');
  }

  const now = Date.now();
  if (!issuedAt || !expirationTime) throw reject('Sign-in message must include issue and expiration times.');
  if (issuedAt.getTime() > now + CLOCK_SKEW_MS || now - issuedAt.getTime() > MAX_MESSAGE_AGE_MS) {
    throw reject('Sign-in message is too old. Please try again.');
  }
  if (expirationTime.getTime() <= now) throw reject('Sign-in message has expired. Please try again.');
  if (expirationTime.getTime() - issuedAt.getTime() > MAX_VALIDITY_MS) {
    throw reject('Sign-in message is valid for too long.');
  }
  if (notBefore && notBefore.getTime() > now + CLOCK_SKEW_MS) throw reject('Sign-in message is not valid yet.');

  if (!/^0x[0-9a-fA-F]+$/.test(input.signature)) throw reject('Signature is malformed.');
  const signature = input.signature as `0x${string}`;
  const checksummed = getAddress(address);
  let valid = false;
  try {
    valid = await verifyMessage({ address: checksummed, message: input.message, signature });
  } catch {
    valid = false;
  }
  if (!valid && ctx.chain.verifyContractSignature) {
    try {
      valid = await ctx.chain.verifyContractSignature({ chainId, address: checksummed, message: input.message, signature });
    } catch {
      valid = false;
    }
  }
  if (!valid) throw reject('Signature does not match the wallet address.');

  // Consume the nonce last and atomically, so a replayed message always fails.
  const consumed = await ctx.db
    .update(authNonces)
    .set({ usedAt: new Date() })
    .where(and(eq(authNonces.nonce, nonce), isNull(authNonces.usedAt), gt(authNonces.expiresAt, new Date())))
    .returning({ nonce: authNonces.nonce });
  if (consumed.length === 0) throw reject('This sign-in request has expired or was already used. Please try again.');

  return { address: checksummed.toLowerCase(), chainId };
}
