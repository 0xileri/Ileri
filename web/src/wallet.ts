import { toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

export interface Signer {
  address: `0x${string}`;
  chainId: number;
  label: string;
  signMessage(message: string): Promise<`0x${string}`>;
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<any>;
}

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

/** Browser extension or in-app wallet (MetaMask, Rabby, Coinbase Wallet, mobile wallet browsers). */
export async function injectedSigner(): Promise<Signer> {
  const provider = window.ethereum;
  if (!provider) throw new Error('No browser wallet found. Install one, or open this page in your wallet app.');
  const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' });
  const address = accounts[0] as `0x${string}` | undefined;
  if (!address) throw new Error('The wallet did not share an account.');
  const chainHex: string = await provider.request({ method: 'eth_chainId' });
  return {
    address,
    chainId: Number.parseInt(chainHex, 16) || 1,
    label: 'Browser wallet',
    signMessage: (message) => provider.request({ method: 'personal_sign', params: [toHex(message), address] }),
  };
}

/** Local key signer for development accounts and throwaway test wallets. */
export function keySigner(privateKey: `0x${string}`, label: string): Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    chainId: 8453,
    label,
    signMessage: (message) => account.signMessage({ message }),
  };
}

const BURNER_KEY = 'ileri.burnerKey';

export function burnerSigner(fresh = false): Signer {
  let key: `0x${string}` | null = null;
  try {
    key = fresh ? null : (localStorage.getItem(BURNER_KEY) as `0x${string}` | null);
  } catch {
    key = null;
  }
  if (!key) {
    key = generatePrivateKey();
    try {
      localStorage.setItem(BURNER_KEY, key);
    } catch {
      // Private mode: the burner lasts for this page only.
    }
  }
  return keySigner(key, 'Test wallet');
}

export function buildSiweMessage(signer: Signer, nonce: string, statement: string): string {
  const now = new Date();
  return createSiweMessage({
    address: signer.address,
    chainId: signer.chainId,
    domain: window.location.host,
    uri: window.location.origin,
    nonce,
    version: '1',
    statement,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 10 * 60_000),
  });
}
