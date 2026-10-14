export type TokenStandard = 'erc20' | 'erc721' | 'erc1155';

export interface BalanceQuery {
  chainId: number;
  standard: TokenStandard;
  contract: string;
  owner: string;
  /** Required for ERC-1155, ignored otherwise. */
  tokenId?: string;
}

export interface ChainReader {
  readonly kind: 'mock' | 'rpc';
  balanceOf(query: BalanceQuery): Promise<bigint>;
  /** Smart-contract wallet signatures (ERC-1271/6492). Optional. */
  verifyContractSignature?(args: {
    chainId: number;
    address: `0x${string}`;
    message: string;
    signature: `0x${string}`;
  }): Promise<boolean>;
}

export class ChainUnavailableError extends Error {
  constructor(message = 'The blockchain service is temporarily unavailable.') {
    super(message);
  }
}
