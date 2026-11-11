# packages/crosschain — owned by the cross-chain developer (B1)

Reserved for the teammate (branch `feat/crosschain`). The lead does not write code here.

- Brief: `docs/SOL2NEAR_V3_Workflow_Equipe_Prompt_B1.md` (prompt B1).
- Proposed public interface to implement: `packages/shared/src/crosschain.ts` (`CrosschainClient`).
  Refine it in `docs/crosschain/INTERFACE.md` if the real API requires it.
- Verified Tidepool facts (2026-11-11): `docs/FEASIBILITY.md` §2.1 — notably, settlement on NEAR is a
  plain `ft_transfer` to `nearRecipient`, so the recipient must be the **user's** NEAR account.
- Deliverable: `docs/crosschain/CROSSCHAIN_HANDOFF.md`.
