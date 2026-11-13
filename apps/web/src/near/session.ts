/** Removes Wallet Selector's own session keys (prefix `near-wallet-selector:`), nothing else. */
export function forgetSelectorSession(storage: Pick<Storage, "length" | "key" | "removeItem">): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith("near-wallet-selector:")) keys.push(k);
  }
  for (const k of keys) storage.removeItem(k);
  return keys;
}
