/**
 * NEAR Wallet Selector v10 (official, near/wallet-selector), testnet only, with MyNearWallet (web,
 * redirect-based) and Meteor (extension). Nothing here ever sees a private key or a seed phrase.
 * The rest of the app only uses the `NearWallet` shape below, so it is testable without a browser wallet.
 */
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import { actionCreators } from "@near-js/transactions";
import { NETWORK_ID, isTestnetAccount } from "./config.ts";
import type { TxCall } from "./deposit.ts";
import type { TxOutcome } from "./outcome.ts";
import { WalletError, isRejection } from "./errors.ts";

export type SignResult = { hash: string; outcome?: TxOutcome } | { redirected: true };

export interface NearWallet {
  accountId: string | null;
  connect(): void;
  disconnect(): Promise<void>;
  signAndSend(call: TxCall): Promise<SignResult>;
  subscribe(cb: (accountId: string | null) => void): () => void;
}

export { WalletError } from "./errors.ts";

let singleton: Promise<NearWallet> | null = null;
export const getNearWallet = () => (singleton ??= create());

async function create(): Promise<NearWallet> {
  const selector: WalletSelector = await setupWalletSelector({
    network: NETWORK_ID,
    modules: [setupMyNearWallet(), setupMeteorWallet()],
  });
  const modal: WalletSelectorModal = setupModal(selector, {});
  const current = () => {
    const a = selector.store.getState().accounts.find((x) => x.active)?.accountId ?? null;
    return a && isTestnetAccount(a) ? a : null; // a mainnet account is never exposed to the app
  };
  return {
    get accountId() {
      return current();
    },
    connect: () => modal.show(),
    async disconnect() {
      if (selector.isSignedIn()) await (await selector.wallet()).signOut();
    },
    subscribe(cb) {
      const sub = selector.store.observable.subscribe(() => cb(current()));
      return () => sub.unsubscribe();
    },
    async signAndSend(call) {
      const accountId = current();
      if (!accountId) throw new WalletError("No testnet account connected", false);
      if (selector.options.network.networkId !== NETWORK_ID) throw new WalletError(`Wallet network is ${selector.options.network.networkId}, not testnet`, false);
      const wallet = await selector.wallet();
      let out: unknown;
      try {
        out = await wallet.signAndSendTransaction({
          signerId: accountId,
          receiverId: call.receiverId,
          actions: [actionCreators.functionCall(call.methodName, call.args, call.gas, call.deposit)],
        });
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        throw new WalletError(msg, isRejection(e));
      }
      const o = out as TxOutcome | undefined;
      if (!o) return { redirected: true }; // browser wallet: the page is leaving; the result comes back in the URL
      return { hash: o.transaction?.hash ?? (o as unknown as { transaction_outcome: { id: string } }).transaction_outcome.id, outcome: o };
    },
  };
}
