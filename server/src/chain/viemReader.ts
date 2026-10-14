import { createPublicClient, http, parseAbi, type Chain, type PublicClient } from 'viem';
import { arbitrum, base, baseSepolia, mainnet, optimism, polygon, sepolia } from 'viem/chains';
import type { BalanceQuery, ChainReader } from './types';
import { ChainUnavailableError } from './types';

const KNOWN_CHAINS: Record<number, Chain> = Object.fromEntries(
  [mainnet, base, optimism, arbitrum, polygon, sepolia, baseSepolia].map((c) => [c.id, c]),
);

const balanceAbi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
]);

export class ViemChainReader implements ChainReader {
  readonly kind = 'rpc' as const;
  private clients = new Map<number, PublicClient>();

  constructor(rpcUrls: Record<number, string>, timeoutMs: number) {
    for (const [id, url] of Object.entries(rpcUrls)) {
      const chainId = Number(id);
      this.clients.set(
        chainId,
        createPublicClient({ chain: KNOWN_CHAINS[chainId], transport: http(url, { timeout: timeoutMs, retryCount: 1 }) }),
      );
    }
  }

  private client(chainId: number): PublicClient {
    const client = this.clients.get(chainId);
    if (!client) throw new ChainUnavailableError(`Chain ${chainId} is not configured.`);
    return client;
  }

  async balanceOf(q: BalanceQuery): Promise<bigint> {
    const client = this.client(q.chainId);
    const address = q.contract as `0x${string}`;
    const owner = q.owner as `0x${string}`;
    if (q.standard === 'erc1155') {
      return client.readContract({
        address,
        abi: balanceAbi,
        functionName: 'balanceOf',
        args: [owner, BigInt(q.tokenId ?? '0')],
      });
    }
    return client.readContract({ address, abi: balanceAbi, functionName: 'balanceOf', args: [owner] });
  }

  async verifyContractSignature(args: {
    chainId: number;
    address: `0x${string}`;
    message: string;
    signature: `0x${string}`;
  }): Promise<boolean> {
    const client = this.clients.get(args.chainId);
    if (!client) return false;
    return client.verifyMessage({ address: args.address, message: args.message, signature: args.signature });
  }
}
