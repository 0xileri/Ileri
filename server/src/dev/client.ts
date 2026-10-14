import type { FastifyInstance } from 'fastify';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

/**
 * Drives the API in-process with a real SIWE sign-in. Used by the seed script and
 * the test suite so both exercise the same code paths as the browser.
 */
export class ApiClient {
  cookie: string | null = null;
  address: string | null = null;

  constructor(private readonly app: FastifyInstance) {}

  static async signIn(app: FastifyInstance, privateKey: `0x${string}`, overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
    const client = new ApiClient(app);
    await client.signInWith(privateKey, overrides);
    return client;
  }

  async siweMessage(privateKey: `0x${string}`, overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
    const account = privateKeyToAccount(privateKey);
    const origin = new URL(this.app.ctx.config.appOrigins[0]!);
    const nonce = (await this.request('GET', '/api/auth/nonce')).body.nonce as string;
    const now = new Date();
    const message = createSiweMessage({
      address: account.address,
      chainId: 8453,
      domain: origin.host,
      uri: origin.origin,
      nonce,
      version: '1',
      issuedAt: now,
      expirationTime: new Date(now.getTime() + 5 * 60_000),
      statement: 'Sign in to Ileri.',
      ...overrides,
    });
    const signature = await account.signMessage({ message });
    return { message, signature, account };
  }

  async signInWith(privateKey: `0x${string}`, overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
    const { message, signature, account } = await this.siweMessage(privateKey, overrides);
    const res = await this.request('POST', '/api/auth/verify', { message, signature });
    if (res.status !== 200) throw new Error(`Sign-in failed: ${JSON.stringify(res.body)}`);
    this.address = account.address.toLowerCase();
    return res;
  }

  async linkWallet(privateKey: `0x${string}`) {
    const { message, signature } = await this.siweMessage(privateKey);
    return this.request('POST', '/api/auth/verify', { message, signature, mode: 'link' });
  }

  async request<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<ApiResponse<T>> {
    const res = await this.app.inject({
      method,
      url,
      payload: payload === undefined ? undefined : (payload as object),
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const c of cookies) {
      const pair = c.split(';')[0]!;
      if (pair.startsWith('ileri_session=')) this.cookie = pair.endsWith('=') ? null : pair;
    }
    let body: any = res.body;
    try {
      body = res.json();
    } catch {
      // Non-JSON responses (files) keep the raw body.
    }
    return { status: res.statusCode, body };
  }

  get<T = any>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = any>(url: string, payload: unknown = {}) {
    return this.request<T>('POST', url, payload);
  }
  put<T = any>(url: string, payload: unknown) {
    return this.request<T>('PUT', url, payload);
  }
  patch<T = any>(url: string, payload: unknown) {
    return this.request<T>('PATCH', url, payload);
  }
  delete<T = any>(url: string) {
    return this.request<T>('DELETE', url);
  }

  /** Like request, but throws with the API error message on non-2xx. */
  async ok<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<T> {
    const res = await this.request<T>(method, url, payload);
    if (res.status >= 300) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  }
}
