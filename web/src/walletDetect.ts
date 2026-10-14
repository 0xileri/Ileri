/** Cheap check that doesn't pull in the signing library. */
export function hasInjectedWallet(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum);
}
