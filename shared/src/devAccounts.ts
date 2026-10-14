// Well-known Anvil/Hardhat development keys. They are public and must never hold
// real funds. The web client only offers them when the server runs in dev mode.
export const DEV_ACCOUNTS = [
  {
    label: 'Ada (community owner)',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  },
  {
    label: 'Bayo (instructor)',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  },
  {
    label: 'Chioma (learner, holds pass)',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    address: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  },
  {
    label: 'Dele (learner, no pass)',
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    address: '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  },
] as const;
