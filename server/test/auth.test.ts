import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, makeApp, newKey, newUser } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp({ platformAdminWallets: [] });
});
afterAll(() => app.close());

describe('Sign-In with Ethereum', () => {
  it('creates an account and session for a new wallet', async () => {
    const { key, address } = newKey();
    const client = await ApiClient.signIn(app, key);
    const me = await client.ok('GET', '/api/me');
    expect(me.user.displayName).toMatch(/^Member /);
    expect(me.wallets.map((w: { address: string }) => w.address)).toEqual([address]);
  });

  it('signs an existing wallet into the same account', async () => {
    const { key } = newKey();
    const first = await ApiClient.signIn(app, key);
    const second = await ApiClient.signIn(app, key);
    expect((await first.ok('GET', '/api/me')).user.id).toBe((await second.ok('GET', '/api/me')).user.id);
  });

  it('rejects a replayed message (nonce is single use)', async () => {
    const { key } = newKey();
    const client = new ApiClient(app);
    const { message, signature } = await client.siweMessage(key);
    expect((await client.post('/api/auth/verify', { message, signature })).status).toBe(200);
    const replay = await new ApiClient(app).post('/api/auth/verify', { message, signature });
    expect(replay.status).toBe(401);
    expect(replay.body.error.message).toMatch(/already used/);
  });

  it('rejects a message bound to another domain', async () => {
    const { key } = newKey();
    const client = new ApiClient(app);
    const { message, signature } = await client.siweMessage(key, { domain: 'evil.example', uri: 'https://evil.example' });
    const res = await client.post('/api/auth/verify', { message, signature });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/different site/);
  });

  it('rejects expired and over-long messages', async () => {
    const { key } = newKey();
    const client = new ApiClient(app);
    const past = new Date(Date.now() - 5 * 60_000);
    const expired = await client.siweMessage(key, { issuedAt: past, expirationTime: new Date(Date.now() - 1000) });
    expect((await client.post('/api/auth/verify', expired)).status).toBe(401);
    const tooLong = await client.siweMessage(key, { expirationTime: new Date(Date.now() + 3 * 3600_000) });
    expect((await client.post('/api/auth/verify', tooLong)).status).toBe(401);
  });

  it('rejects a signature from a different wallet', async () => {
    const a = newKey();
    const b = newKey();
    const client = new ApiClient(app);
    const { message } = await client.siweMessage(a.key);
    const { signature } = await client.siweMessage(b.key);
    const res = await client.post('/api/auth/verify', { message, signature });
    expect(res.status).toBe(401);
  });

  it('rejects unknown nonces', async () => {
    const { key } = newKey();
    const client = new ApiClient(app);
    const { message, signature } = await client.siweMessage(key, { nonce: 'abcdef0123456789abcdef0123456789' });
    expect((await client.post('/api/auth/verify', { message, signature })).status).toBe(401);
  });

  it('links a second wallet and refuses wallets owned by someone else', async () => {
    const user = await newUser(app);
    const other = await newUser(app);
    const extra = newKey();
    expect((await user.linkWallet(extra.key)).status).toBe(200);
    const me = await user.ok('GET', '/api/me');
    expect(me.wallets).toHaveLength(2);
    const taken = await user.linkWallet(other.key);
    expect(taken.status).toBe(409);
  });

  it('will not remove the last wallet', async () => {
    const user = await newUser(app);
    const me = await user.ok('GET', '/api/me');
    const res = await user.delete(`/api/me/wallets/${me.wallets[0].id}`);
    expect(res.status).toBe(400);
  });

  it('logs out and blocks cross-origin writes', async () => {
    const user = await newUser(app);
    await user.ok('POST', '/api/auth/logout');
    expect((await user.get('/api/me')).body.user).toBeNull();
    const res = await app.inject({ method: 'POST', url: '/api/communities', headers: { origin: 'https://evil.example' }, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});
