# SOL2NEAR — Rapport de faisabilité

> Rédigé le 2026-11-11 vers 20:10 UTC. Deadline hackathon : **2026-11-14 23:59 UTC**.
> **TESTNET / DEVNET UNIQUEMENT.** Aucune transaction n'a été signée, aucun compte créé, aucun déploiement effectué.
> Toutes les vérifications on-chain ci-dessous sont des appels RPC en lecture seule (`view_account`, `call_function`) sur `https://rpc.testnet.near.org`, et des appels HTTP Tidepool `GET` ou `POST /v0/quote` avec `dry: true` (pas d'adresse de dépôt générée).

Légende : ✅ **Vérifié** (observé moi-même, preuve citée) · 📄 **Documenté** (lu dans une doc, pas testé) · ❓ **Hypothèse** (non vérifiée, à tester).

---

## 0. Pipeline visé

```
Solana Devnet                Tidepool sandbox (1Click-compatible)           NEAR Testnet
─────────────                ─────────────────────────────────────           ────────────
USDC SPL (mint 7paf…r4Xr) ──► deposit address (custodial, dérivée du quote)
                              relayer → verifier.tidepool-sandbox.testnet
                              maker swap → ft_withdraw ──ft_transfer──► USDC NEP-141 usdc.tidepool-sandbox.testnet
                                                                              │
                                                                              ▼
                                                        Treasury (Rust) : split 90 / 8 / 2
                                                                              │ (bucket LP)
                                                                              ▼
                                                        ref-finance-101.testnet : simple pool USDC(tp)/wNEAR(tp)
                                                                              │ parts LP (MFT ":<pool_id>") détenues par Treasury
                                                                              ▼
                                                        FUEL (NEP-141) minté contre preuve de liquidité
```

---

## 1. Environnement local (inspecté)

| Outil | État | Note |
|---|---|---|
| OS | Windows 11 Home 10.0.26300 | Shell PowerShell 5.1 + Git Bash |
| WSL | Ubuntu (WSL2), **arrêté** | Disponible si une chaîne Linux est nécessaire (cargo-near) |
| Node / npm / pnpm | v24.12.0 / 11.6.2 / 10.34.9 | OK pour monorepo pnpm |
| Rust / cargo | 1.98.0 (stable, msvc) | Targets installées : `wasm32-unknown-unknown`, `wasm32v1-none` |
| `cargo near` | ❌ **absent** | À installer (G0) |
| `near` (near-cli-rs) | ❌ **absent** | À installer (G0). Doc : `irm https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.ps1 \| iex` |
| `solana` CLI | ❌ absent | Pas indispensable si l'équipier utilise `@solana/web3.js` + wallet devnet |
| Git | 2.52.0, repo `origin` = github.com/nielslecodeur/SOL2NEAR, 1 commit | `gh` CLI absent |

Aucun fichier de clés lu ni affiché.

---

## 2. Faits vérifiés (avec preuves)

### 2.1 Tidepool — route Solana Devnet → NEAR Testnet

| # | Fait | Statut | Preuve |
|---|---|---|---|
| T1 | API publique sans clé, base `https://www.usetidepool.tech/v0/...` | ✅ | `GET /v0/tokens` → HTTP 200, 31 tokens |
| T2 | `GET /v0/health` → `ok: true`, `network: "testnet"`, verifier `verifier.tidepool-sandbox.testnet` (defuse v0.4.5, sha256 `a1afab98…b547`), maker `maker.tidepool-sandbox.testnet` | ✅ | health à 20:07 UTC |
| T3 | Bridge Solana : `sol.ok: true`, cluster devnet, relayer `BEijzwSQ…St55Q` (6.75 SOL), treasury USDC ≈ 199 921, cap SOL natif 0.005 | ✅ | health |
| T4 | USDC Solana devnet : `nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet`, mint `7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr`, 6 décimales | ✅ | `/v0/tokens` + `ft_metadata` on-chain : "Tidepool Testnet USDC on Solana Devnet (bridged, no value)" |
| T5 | USDC NEAR : `usdc.tidepool-sandbox.testnet`, NEP-141 réel, 6 déc., name "Tidepool Testnet USDC (no value)", `storage_balance_bounds` = 0.00125 NEAR (min = max) | ✅ | RPC `ft_metadata`, `storage_balance_bounds` |
| T6 | **Dry quote OK** : 1 USDC SPL (`1000000`) → `nep141:usdc.tidepool-sandbox.testnet`, `amountOut 997400` (0.9974), `minAmountOut 987426` (slippage 100 bps), `timeEstimate 60` s, signé ed25519 | ✅ | `POST /v0/quote` `dry:true`, correlationId `e1b46370-990b-4c9b-ae72-a2223607d2be` |
| T7 | Dry quote USDC SPL → `nep141:wnear.tidepool-sandbox.testnet` aussi OK (0.2675 wNEAR pour 1 USDC) | ✅ | correlationId `47686fcc-…` |
| T8 | Le dry quote **ne valide pas l'existence** du compte NEAR destinataire (un compte inexistant est accepté) | ✅ | quote A (`sol2near-probe-xyz.testnet`) |
| T9 | **Mode de livraison réel sur NEAR** : le verifier fait `ft_withdraw` puis **`ft_transfer` simple** (pas `ft_transfer_call`) vers le destinataire | ✅ | tx `2bDGk6PuAYsrhXTt9RGnX84Yh2op4otR5aYvybYS92Am` : receipt `verifier → usdc.tidepool-sandbox.testnet ft_transfer {receiver_id, amount, memo:null}` + `ft_resolve_withdraw is_call:false` |
| T10 | Trafic réel : 701 swaps au total, 462 SUCCESS, 26 REFUNDED, 3 FAILED, 198 expirés ; derniers SUCCESS du jour (ETH→USDC, ETH→wNEAR) | ✅ | health `swaps`, `recent` |
| T11 | Faucet **site-only** (`POST /v0/faucet` direct → 403 `site_only`) ; Solana : 100 USDC + 100 USDT SPL, ATA créé par Tidepool ; NEAR mode wallet : compte **existant et âgé d'au moins 3 h**, 1 claim / adresse / 7 jours | 📄 | /docs/guides/faucet (limite IP contradictoire dans la doc : « 6/IP/heure » vs « 2/IP/3 h ») |
| T12 | Trust model : adresses de dépôt **custodiales** (clés dérivées côté serveur), maker unique, état = fichier JSON sur un serveur, **pas de SLA** | 📄 | /docs/resources/trust-model |
| T13 | `customRecipientMsg` (→ `ft_transfer_call`) existe dans le schéma mais est marqué « HIGHLY EXPERIMENTAL » ; aucun exemple live | 📄 | /docs/api-reference/get-quote |
| T14 | Statuts : PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, INCOMPLETE_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED ; polling recommandé toutes les 2 à 5 s ; deadline d'un live quote entre 60 s et 24 h | 📄 | /docs/api-reference/get-execution-status, get-quote |

### 2.2 Ref / Rhea — AMM testnet

| # | Fait | Statut | Preuve |
|---|---|---|---|
| R1 | Exchange testnet = `ref-finance-101.testnet`, **version 1.9.19**, `state: "Running"`, owner `reflabs.sputnikv2.testnet` (DAO), 4 guardians, `wnear_id: wrap.testnet`, 2 951 pools | ✅ | RPC `metadata` |
| R2 | Création de pool **sans permission** et tokens **non whitelistés acceptés** dans un pool (ex. pools 2948 à 2950 `*.roastake-dev-mta.testnet`, absents de la whitelist) | ✅ | `get_pools` + `get_whitelisted_tokens` |
| R3 | **Aucun token Tidepool** (`*.tidepool-sandbox.testnet`, `*.tp-omft.testnet`) n'est whitelisté, et **aucun pool existant** n'en contient | ✅ | scan complet des 2 951 pools |
| R4 | `ref-finance-101.testnet` **n'a pas de storage** sur `usdc.tidepool-sandbox.testnet` ni sur le token SOL-USDC bridgé (`storage_balance_of` → `null`) | ✅ | RPC |
| R5 | `storage_balance_bounds` exchange : min **0.00102 NEAR** ; un dépôt inférieur → panic `E17: deposit less than min storage` | ✅ | RPC |
| R6 | Parts LP = **MFT** `":<pool_id>"`, `mft_metadata` : spec `mft-1.0.0`, **24 décimales** ; `mft_balance_of`, `mft_total_supply`, `get_pool_shares` disponibles en vue | ✅ | RPC sur pool 0 |
| R7 | Existence et garde des méthodes de mutation sur le wasm déployé (sondées en mode vue, sans signature) : | ✅ | voir tableau §4 |
| R8 | `predict_add_simple_liquidity(pool_id, amounts)` → `{need_amounts, mint_shares}` disponible : on peut calculer le ratio exact **avant** `add_liquidity` | ✅ | RPC pool 0 |
| R9 | Le dépôt public `github.com/ref-finance/ref-contracts` renvoie **404** (introuvable ou privé) : **pas de source lisible** pour v1.9.19 | ✅ | `git ls-remote` → "Repository not found" |
| R10 | Le doc `ref-exchange.md` est ancien (`ValidAccountId`, `add_liquidity` sans `min_amounts`) ; il ne correspond pas exactement au wasm actuel | ✅ | comparaison avec R7 |
| R11 | Le typage tiers `sleet-js/ref-exchange-contract-type-for-near-kit` donne `add_liquidity(pool_id, amounts, min_amounts?) → U128` et `add_simple_pool(tokens, fee) → U64` | 📄 | non officiel, cohérent avec R7 |
| R12 | Postfixes auto-whitelistés sur Ref testnet : `.tkns.testnet`, `.portalpad1.testnet`, `meme-cooking.testnet`, `.tkndev.testnet` | ✅ | `metadata.auto_whitelisted_postfix` |
| R13 | L'API NearBlocks testnet (`api-testnet.nearblocks.io/v1/...`) renvoie **HTTP 410** : on ne peut pas s'en servir pour indexer | ✅ | curl |

### 2.3 NEAR (docs.near.org)

| # | Fait | Statut |
|---|---|---|
| N1 | Les appels cross-contract sont **asynchrones et indépendants** : pas de rollback de l'appelant si l'appelé échoue ; le callback s'exécute toujours (`PromiseResult::Failed`) et seul son propre état est annulé s'il panique | 📄 docs.near.org/smart-contracts/anatomy/crosscontract |
| N2 | `ft_transfer` / `ft_transfer_call` exigent **exactement 1 yoctoNEAR** ; `ft_on_transfer` doit renvoyer le montant **non utilisé** (remboursé via `ft_resolve_transfer`) | 📄 primitives/ft/standard |
| N3 | Coût du storage : 1E19 yocto/octet (1 NEAR / 100 kB) | 📄 protocol/storage/storage-staking |
| N4 | Gas : la doc actuelle indique un **maximum de 1 PGas (1 000 Tgas)** par transaction. Le chiffre de « 300 Tgas » n'apparaît plus. **Décision : rester ≤ 300 Tgas par appel** par prudence | 📄 protocol/transactions/gas |
| N5 | `https://rpc.testnet.near.org` répond (utilisé pour tous les tests) ; RPC publics alternatifs : `near-testnet.drpc.org`, `testnet-rpc.intea.rs` ; explorer `testnet.nearblocks.io` | ✅ / 📄 |
| N6 | Faucet NEAR testnet : `near create-account <id> --useFaucet` | 📄 |

### 2.4 Track hackathon (11 — Memecoins With Mechanics)

- 📄 « Build memecoins where the meme does something: supply that reacts to the community, **treasuries with rules** … Judges score the mechanic, and the price chart doesn't count. »
- 📄 Exigences de l'exemple de prompt : mécanique **dans le contrat** (« not in a backend somebody could switch off »), **paramètres fixés au lancement et lisibles, sans clé admin pour les changer**, limites anti-sybil écrites dans le README, une page avec l'état et le log des mints/burns, et une simulation sur 60 jours.
- 📄 Jury incluant des IA (Claude Code, Codex) → README avec des étapes « do X, see Y ».
- ⚠️ **« FUEL » et « Proof of Liquidity » ne sont définis nulle part** dans le track ni dans le README du repo d'exemples. Ce sont **nos** concepts : on les définit au §5, et il ne faut jamais les présenter comme un standard externe.
- 📄 Les règles officielles vivent dans `https://nearhackathon.com/HACKATHON.md` (non lu ; à lire avant soumission).

---

## 3. Hypothèses non vérifiées (à transformer en faits)

| # | Hypothèse | Comment la vérifier | Gate |
|---|---|---|---|
| H1 | Un live bridge USDC SPL → NEAR arrive en SUCCESS (~60 s) vers **notre** compte | 1 transfert réel de 1 USDC de test (avec ton accord) | G1 |
| H2 | Tidepool fait lui-même le `storage_deposit` du destinataire (« Tidepool registers storage for you ») | Ne pas en dépendre : on enregistre Treasury nous-mêmes (0.00125 NEAR) | G1 |
| H3 | `add_simple_pool` coûte un dépôt de storage d'environ 0.01 à 0.1 NEAR, l'excédent étant remboursé | 1er appel réel avec 0.1 NEAR attaché ; lire le reçu | G2 |
| H4 | `add_liquidity` (≥ 1 yocto, cf. E35) facture le storage LP sur le dépôt attaché ou sur le storage du compte | Appel réel avec 0.01 NEAR, comparer `storage_balance_of` avant et après | G2 |
| H5 | `ft_on_transfer` de Ref avec `msg: ""` crédite `get_deposits(sender)` si le sender est enregistré et a fait `register_tokens` ; sinon il panique et `ft_resolve_transfer` rembourse | Test réel, d'abord sans `register_tokens` (attendu : remboursement), puis avec | G2 |
| H6 | `wnear.tidepool-sandbox.testnet` n'a pas non plus de storage pour Ref (vérifié uniquement pour USDC) | 1 appel vue | G0 |
| H7 | `customRecipientMsg` déclenche bien un `ft_transfer_call` vers Treasury | Test optionnel, avec un petit montant | G3 (bonus) |
| H8 | Rust 1.98 + near-sdk 5.x + cargo-near produisent un wasm accepté par nearcore testnet (les Rust récents émettent des features wasm comme bulk-memory ; `wasm32v1-none` est installé, peut-être pour ça) | Build et deploy d'un contrat « hello » sur un sous-compte testnet | G0/G1 |
| H9 | near-workspaces peut importer `ref-finance-101.testnet` en sandbox pour les tests d'intégration (`import_contract`) | Test local | G3 |
| H10 | La répartition 90/8/2 = 90 % LP / 8 % réserve / 2 % ops-FUEL | **À confirmer par toi** (non bloquant : paramètres en bps fixés à l'init) | G3 |

---

## 4. Séquence exacte pour créer et détenir les LP (Treasury = détenteur)

Comptes : `T` = Treasury (contrat), `REF` = `ref-finance-101.testnet`, `USDC` = `usdc.tidepool-sandbox.testnet`, `WNEAR` = `wnear.tidepool-sandbox.testnet`.

### 4.1 Méthodes sondées sur le wasm déployé (v1.9.19)

| Méthode | Garde observée (appel vue) | Conclusion |
|---|---|---|
| `storage_deposit(account_id?, registration_only?)` | `E17: deposit less than min storage` | payable, min 0.00102 NEAR |
| `register_tokens(token_ids)` | « Requires attached deposit of exactly 1 yoctoNEAR » | **1 yocto** |
| `unregister_tokens(token_ids)` | 1 yocto exact | — |
| `add_simple_pool(tokens, fee)` | a dépassé les asserts jusqu'à `storage_write` | aucun assert de dépôt **avant** l'écriture ; storage facturé après (H3) |
| `add_liquidity(pool_id, amounts, min_amounts?)` | `E35: requires attached deposit of at least 1 yoctoNEAR` (lib.rs:390) | **≥ 1 yocto** (H4 pour le montant réel) |
| `remove_liquidity(pool_id, shares, min_amounts)` | 1 yocto exact | — |
| `withdraw(token_id, amount, …)` | 1 yocto exact | — |
| `mft_register(token_id, account_id)` | atteint `storage_write` | payable, existe |
| `mft_transfer` / `mft_transfer_call` | 1 yocto exact | existent |
| `ft_on_transfer` | atteint `predecessor_account_id` | existe |
| `storage_withdraw` | 1 yocto exact | — |

### 4.2 Séquence one-time (bootstrap, faite une fois par compte ou contrat)

| # | Appel | Signataire / caller | Dépôt | Gas (❓ estimation) | Dépendance |
|---|---|---|---|---|---|
| B1 | `USDC.storage_deposit({account_id: T})` | n'importe qui | 0.00125 NEAR | 10 Tgas | avant toute réception Tidepool |
| B2 | `WNEAR.storage_deposit({account_id: T})` | n'importe qui | 0.00125 NEAR | 10 Tgas | — |
| B3 | `USDC.storage_deposit({account_id: REF})` | n'importe qui | 0.00125 NEAR | 10 Tgas | **R4 : obligatoire**, sinon `ft_transfer_call` vers REF échoue |
| B4 | `WNEAR.storage_deposit({account_id: REF})` | n'importe qui | 0.00125 NEAR | 10 Tgas | H6 |
| B5 | `REF.storage_deposit({account_id: T, registration_only: false})` | T ou un tiers | ≥ 0.00102, prévoir **0.1 NEAR** | 10 Tgas | avant tout dépôt dans REF |
| B6 | `REF.register_tokens({token_ids:[USDC, WNEAR]})` | **T** (predecessor = T) | 1 yocto | 10 Tgas | R3 : tokens non whitelistés |
| B7 | `REF.add_simple_pool({tokens:[USDC, WNEAR], fee: 30})` → `pool_id` | T ou un compte d'admin de lancement | ❓ 0.1 NEAR (H3) | 30 Tgas | une seule fois ; `pool_id` figé dans l'init de Treasury |
| B8 | Seed initial : B9 + B10 + B11 avec des tokens du faucet NEAR (100 USDC + 40 wNEAR) | T | — | — | fixe le prix initial (≈ 3.72 USDC/wNEAR, prix Tidepool) |

### 4.3 Séquence par dépôt (bucket LP)

| # | Appel | Caller | Dépôt | Gas (❓) | Échec → effet |
|---|---|---|---|---|---|
| D1 | `REF.predict_add_simple_liquidity(pool_id, [usdc_amt, max_wnear])` (vue, faite off-chain par le keeper ou le front) | — | — | — | aucun |
| D2 | `USDC.ft_transfer_call({receiver_id: REF, amount: usdc_amt, msg: ""})` | T | 1 yocto | 60 Tgas | `ft_on_transfer` panique → `ft_resolve_transfer` **rembourse T** : fonds sûrs |
| D3 | `WNEAR.ft_transfer_call({receiver_id: REF, amount: wnear_amt, msg: ""})` | T | 1 yocto | 60 Tgas | idem |
| D4 | `REF.add_liquidity({pool_id, amounts:[usdc_amt, wnear_amt], min_amounts:[…]})` | T | ≥ 1 yocto, prévoir 0.01 NEAR (H4) | 30 Tgas | les fonds **restent dans `get_deposits(T)`** chez REF (pas perdus, mais immobilisés) ; reprise par un nouvel `add_liquidity` ou par `withdraw` |
| D5 | `REF.get_pool_shares({pool_id, account_id: T})` (appel cross-contract d'une vue) | T | 0 | 5 Tgas | aucun |
| D6 | Callback `T.on_shares_checked(prev_shares)` `#[private]` : `minted = now - prev`, puis mint FUEL | T | — | 15 Tgas | si le callback panique, seul son état est annulé : LP créé mais FUEL non minté → **réconcilier** avec `verify_liquidity()` |

Requêtes de lecture LP (front et preuve) : `REF.get_pool_shares(pool_id, T)`, `REF.mft_balance_of(":<pool_id>", T)`, `REF.get_pool_total_shares(pool_id)`, `REF.get_pool(pool_id)`, `REF.get_deposits(T)`.

### 4.4 Risques asynchrones identifiés

1. **Pas d'atomicité D2 → D4.** Chaque appel est un reçu séparé : un état intermédiaire (tokens déposés chez REF, pas encore de LP) est normal. Il faut modéliser Treasury comme une **machine à états idempotente** (`Pending → InRef → LpMinted → FuelMinted`) avec une étape `resume()`. Pas de grande chaîne de promesses unique.
2. **Réentrance logique.** Entre D2 et D6, un autre appel peut modifier les parts de T. Mesurer `minted` par delta est faux si deux dépôts se chevauchent. **Décision : un seul job LP à la fois** (lock `lp_in_flight: bool`, libéré dans le callback, y compris en cas d'échec).
3. **Le callback doit libérer le lock même si D4 échoue** (`#[callback_result]`). Réserver du gas pour le callback (`with_static_gas`).
4. **Réception Tidepool = `ft_transfer` simple (T9).** Treasury n'est **pas notifié** et ne sait pas **qui** a envoyé. Voir la décision D-1.
5. **Prix manipulable dans un petit pool.** `min_amounts` doit venir de `predict_add_simple_liquidity` (D1), avec une tolérance ; sinon `add_liquidity` panique et les fonds restent chez REF (récupérables).
6. **Gouvernance Ref.** Les guardians ou le DAO peuvent passer l'exchange en `Paused`. Hors de notre contrôle ; à surveiller par `metadata.state` avant la démo.
7. **Storage de T.** Chaque registration (B1 à B5) consomme le storage de T ; le contrat lui-même (~300 à 400 kB ❓) immobilise environ 3 à 4 NEAR. Prévoir **≥ 10 NEAR testnet** sur T.

---

## 5. Décisions de conception

- **D-1 — Attribution des dépôts (vient de T9).** Option retenue **A (trustless)** : Tidepool livre au **compte NEAR de l'utilisateur** (`recipient = user.testnet`), puis le front déclenche `USDC.ft_transfer_call({receiver_id: T, msg: "{\"action\":\"deposit\"}"})`. Treasury reçoit `ft_on_transfer(sender_id, amount, msg)` : l'attribution est faite par le protocole, sans oracle. Coût : une signature NEAR de plus pour l'utilisateur.
  Option **B (bonus)** : `recipient = T`, puis `sync()` réconcilie via `ft_balance_of(T)`, mais sans attribution individuelle ; ou bien `customRecipientMsg` (H7, expérimental). Option B en démo secondaire uniquement.
- **D-2 — `ft_on_transfer` de Treasury renvoie `0` immédiatement** (il accepte tout) et ne fait **aucun appel Ref dans ce reçu**. Il enregistre le dépôt et applique le split 90/8/2 dans un **ledger interne** (en bps, fixés à l'init, immuables). La mise en LP passe par une étape séparée `deploy_liquidity()`, appelable par n'importe qui (keeper permissionless). Cela évite les remboursements partiels complexes via `ft_resolve_transfer`.
> **Mise à jour 2026-11-11 (alignement spec V3)** : D-3, D-4 et D-5 ci-dessous sont **remplacées** par la spec V3 :
> FUEL est un **contrat séparé à supply fixe** (1 000 000, réserve PoL préémise, pas de mint) ;
> les LP sont **creator-owned**, détenues par Treasury et **retirables par le créateur après le lock** (`withdraw_lp`) ;
> le côté wNEAR est obtenu par **swap partiel** dans le pool (pas de réserve wNEAR pré-financée).
> Implémentation : `docs/ARCHITECTURE.md`. Nouvelle hypothèse **H11** : `swap` de Ref accepte 1 yocto attaché (à vérifier en G2).

- **D-3 (remplacée) — FUEL = le contrat Treasury lui-même implémente NEP-141 + NEP-145.** Le mint est alors **synchrone et local**, sans saut asynchrone vers un autre contrat. Seul le callback D6 peut minter.
- **D-4 (remplacée en partie : le retrait créateur après lock existe) — Proof of Liquidity (définition SOL2NEAR, pas un standard)** : FUEL n'est minté qu'à hauteur des parts LP **effectivement mesurées** par delta de `get_pool_shares(pool_id, T)` sur Ref. Treasury **n'expose aucune méthode `remove_liquidity` ni `mft_transfer`**, donc la liquidité est verrouillée par le code. `verify_liquidity()` (public) relit les parts on-chain, compare avec `recorded_shares`, émet un event `EVENT_JSON` `{standard:"sol2near", event:"proof_of_liquidity", pool_id, shares, block_height}`. La vue `proof_of_liquidity()` renvoie le dernier snapshot.
- **D-5 (paire conservée, mode V1 remplacé par le swap partiel) — Paire du pool : USDC(tp)/wNEAR(tp).** Les deux viennent de Tidepool, avec les mêmes prix maker. Le côté wNEAR est fourni en **V1** par une réserve wNEAR pré-financée de Treasury (faucet) au ratio de `predict_add_simple_liquidity` : pas de swap, moins d'étapes async. En **V2**, zap (swap de la moitié des USDC dans le pool) si le temps le permet.
- **D-6 — Paramètres immuables** (`lp_bps`, `reserve_bps`, `ops_bps`, `pool_id`, `ref_id`, `usdc_id`, `wnear_id`), fixés dans `new()`, sans méthode admin. La suppression de la full-access key après déploiement est irréversible : **seulement sur décision explicite de ta part**.
- **D-7 — ≤ 300 Tgas par transaction, une étape = une transaction**, avec gas statique explicite par appel. Le front et le keeper orchestrent.
- **D-8 — Pas d'indexer externe** (R13) : le front lit l'état via les vues RPC et les logs `EVENT_JSON` de nos propres txs.

---

## 6. Blockers

### P0 — à lever avant d'écrire la logique LP

| # | Blocker | Mitigation | Gate |
|---|---|---|---|
| P0-1 | Source Ref v1.9.19 **introuvable** (R9) : le coût exact du storage de `add_simple_pool` / `add_liquidity` est inconnu | Séquence **manuelle via CLI** depuis un compte de test (B5 à B7, D2 à D5) avant de coder ; noter les montants réels | G2 |
| P0-2 | Toolchain incomplète (cargo-near, near-cli absents) + compatibilité wasm de Rust 1.98 non prouvée (H8) | Installer, puis build et deploy d'un « hello » sur un sous-compte testnet | G0/G1 |
| P0-3 | Bridge **live** jamais exécuté par nous (H1) : seul le dry quote est prouvé | 1 bridge de 1 USDC de test vers un compte NEAR à nous (équipier) | G1 |
| P0-4 | Tidepool = opérateur unique, sans SLA (T12) : la route peut tomber pendant la démo | Plan B-1 + capture vidéo du flux réel dès G1 | G1 |

### P1

| # | Blocker | Mitigation |
|---|---|---|
| P1-1 | Tokens Tidepool non whitelistés (R3) | `register_tokens` par T (B6), 1 yocto |
| P1-2 | Ref non enregistré sur les tokens Tidepool (R4) | B3/B4, 0.00125 NEAR chacun |
| P1-3 | Aucun pool existant (R3) : c'est **notre** pool, avec notre prix initial et notre seule liquidité | À dire clairement dans le README ; seed avec le faucet |
| P1-4 | Faucet NEAR wallet : compte âgé d'au moins 3 h, 1 claim / 7 jours (T11) | **Créer les comptes testnet dès aujourd'hui** |
| P1-5 | Il faut du SOL devnet pour les frais côté équipier (le faucet Tidepool n'en donne pas) | faucet.solana.com tôt ; peu de txs nécessaires |
| P1-6 | Reset possible du devnet Solana (soldes perdus) | Garder les hashes de tx comme preuves |
| P1-7 | Règles officielles (`HACKATHON.md`) non lues | À lire avant G4 |
| P1-8 | Signification exacte de 90/8/2 (H10) | Paramétrable ; à confirmer avant G3 |

### P2

- `customRecipientMsg` expérimental (H7) ; vérification des signatures de quote avec la clé Tidepool `ed25519:U1Mu4u1n…` (la clé par défaut du SDK 1Click ne vérifiera pas).
- La doc indique 1 PGas max/tx alors que la pratique connue est 300 Tgas : on reste sous 300 (D-7).
- Pause éventuelle de Ref par la gouvernance (§4.4-6).
- Contradiction sur les limites IP du faucet dans la doc Tidepool.
- Postfix `meme-cooking.testnet` auto-whitelisté sur Ref (R12) : piste possible pour FUEL, pas nécessaire.

---

## 7. Plan B (honnête)

| Scénario | Fallback | Ce qu'on dit au jury |
|---|---|---|
| **B-1** Tidepool indisponible le jour J | L'utilisateur part d'USDC `usdc.tidepool-sandbox.testnet` obtenu au **faucet NEAR** (même contrat, même token) : Treasury, LP et FUEL sont inchangés | « Le leg Solana a été exécuté le JJ/MM : voir tx Solana `…` et NEAR `…` (liens explorer). Aujourd'hui le relayer est down, donc on part du token NEAR. » Jamais de faux statut |
| **B-2** `add_simple_pool` / `add_liquidity` se comportent autrement que prévu ou Ref est en pause | (a) Treasury garde les fonds **déposés dans Ref** (`get_deposits`) et la preuve porte sur les dépôts, pas sur les LP ; (b) dernier recours : petit AMM x·y=k maison, **explicitement présenté comme tel** | « Pas de pool Ref : notre AMM de démonstration, voici pourquoi. » |
| **B-3** Chaîne async trop fragile | Déjà couvert par la machine à états D-2/D-7 : chaque étape est rejouable à la main | — |
| **B-4** Retard global | Couper V2 (zap), l'option B de D-1 et les extras du front ; garder FUEL + PoL + 1 bridge réel | — |

---

## 8. Checklist des gates

**G0 — Environnement et faits (aujourd'hui, 11/11)**
- [x] Inspection locale, lecture des docs, health/tokens/dry quotes Tidepool, sondage Ref en lecture seule
- [x] `near-cli-rs` **0.31.1** installé (npm `near-cli-rs@latest`) — 2026-11-11
- [ ] `cargo-near` (`cargo install --locked cargo-near`) — version à consigner
- [x] H6 vérifié : `wnear.tidepool-sandbox.testnet.storage_balance_of(ref-finance-101.testnet)` → `null` (B4 obligatoire)
- [x] Comptes testnet créés le 2026-11-11 (~20:20 UTC), clés dans le Gestionnaire d'identification Windows (keychain near-cli) :
  - `sol2near-dev.testnet` — faucet, 10 NEAR — tx `6rTeGovQsifvy7Rjgi2y6HoceSDecmvEYcfPso5Q82wB`
  - `treasury.sol2near-dev.testnet` — 5 NEAR depuis `sol2near-dev` — tx `bi1cErW2hCZfXVxRjt9PDrU3L7QxGHnv99D6hxBeCma`
  - ⏱ faucet Tidepool NEAR (compte âgé de ≥ 3 h) utilisable à partir de **~23:20 UTC le 11/11**
- [ ] Équipier : wallet Solana devnet + du SOL devnet + claim faucet SPL USDC
- [ ] Monorepo squelette (après ton feu vert pour coder)

**G1 — Prouver les deux briques indépendamment (12/11)**
- [ ] Build et deploy d'un contrat « hello » (H8) → hash de tx
- [ ] Équipier : faucet SPL USDC → live quote → dépôt → `SUCCESS` vers `sol2near-dev.testnet` (H1) → hashes Solana et NEAR consignés
- [ ] Vérifier si Tidepool a payé le storage du destinataire (H2)

**G2 — Séquence Ref manuelle (12/11)**
- [ ] B3 à B7 et D2 à D5 en CLI depuis `sol2near-dev.testnet` avec des tokens du faucet NEAR
- [ ] `pool_id` créé, `get_pool_shares > 0`, montants réels de storage notés (H3, H4, H5)
- [ ] Test d'échec volontaire : `ft_transfer_call` sans `register_tokens` → remboursement observé

**G3 — Treasury + FUEL + PoL (13/11)**
- [ ] Contrat : `ft_on_transfer` + ledger 90/8/2 + `deploy_liquidity` + callback + mint FUEL + `verify_liquidity`
- [ ] Tests unitaires + intégration (near-workspaces, H9) ; deploy testnet ; 1 cycle complet
- [ ] Simulation de supply FUEL sur 60 jours (exigence du track)

**G4 — Bout en bout et soumission (14/11, avant 20:00 UTC pour garder une marge)**
- [ ] Démo Solana → Tidepool → user → Treasury → LP → FUEL, avec tous les hashes affichés dans le front
- [ ] README « do X, see Y », limites anti-sybil, trust model Tidepool, plan B déclaré
- [ ] Vidéo, lecture de HACKATHON.md, soumission

---

## 9. Structure du monorepo proposée

```
SOL2NEAR/
├─ FEASIBILITY.md
├─ README.md
├─ package.json / pnpm-workspace.yaml   # pnpm workspaces
├─ Cargo.toml                            # workspace Rust (contracts/*)
├─ contracts/
│  └─ treasury/                          # [TOI] Rust near-sdk : Treasury + FUEL NEP-141/145 + PoL
│     ├─ src/{lib.rs, ft.rs, ledger.rs, ref_ext.rs, pol.rs, events.rs}
│     └─ tests/                          # near-workspaces (import ref-finance-101.testnet)
├─ packages/
│  ├─ shared/                            # [TOI, PR équipier OK] constantes + types partagés
│  │  └─ src/{assets.ts, accounts.ts, types.ts}
│  ├─ crosschain/                        # [ÉQUIPIER] Tidepool + Solana Devnet — seul module à parler à Tidepool/Solana
│  │  └─ src/{tidepool.ts, solana.ts, index.ts}
│  └─ near-client/                       # [TOI] appels Treasury + vues Ref (near-api-js)
├─ apps/
│  └─ web/                               # [TOI] frontend (wallet selector NEAR + wallet Solana devnet)
├─ sim/                                  # [TOI] simulation FUEL 60 jours
└─ scripts/
   ├─ testnet-bootstrap.md               # B1..B7 en commandes CLI, exécutées manuellement
   └─ probes/                            # vues read-only (sans clé)
```

Règle d'ownership : l'équipier ne modifie que `packages/crosschain/**` (et propose des changements à `packages/shared` par PR). Ni `crosschain` ni `apps/web` ne détiennent de clé privée : les signatures passent toujours par les wallets du navigateur.

## 10. Contrat d'interface public — `packages/crosschain` (à figer avant de coder)

```ts
// packages/shared/src/assets.ts  (valeurs VÉRIFIÉES le 2026-11-11)
export const TIDEPOOL_BASE = "https://www.usetidepool.tech";
export const ASSET_SOL_USDC = "nep141:sol-d48c1adc423a64867ac91ed2e1c0df76da323235.tp-omft.testnet";
export const SOL_USDC_MINT  = "7pafEGXSmR35rLKNaD6inpfLYuEnRX9DyBc1c7M8r4Xr"; // 6 décimales
export const ASSET_NEAR_USDC = "nep141:usdc.tidepool-sandbox.testnet";        // 6 décimales

// packages/crosschain/src/index.ts  — surface publique UNIQUE
export type BridgeStatus =
  | "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "INCOMPLETE_DEPOSIT"
  | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export interface QuoteParams {
  amountBaseUnits: string;      // entier, 6 décimales (ex. "1000000" = 1 USDC)
  solanaRefundAddress: string;  // base58 (wallet devnet de l'utilisateur)
  nearRecipient: string;        // "<user>.testnet"  (décision D-1 option A)
  slippageBps?: number;         // défaut 100
  deadlineMinutes?: number;     // défaut 30, borné [1, 1440]
}

export interface BridgeQuote {
  correlationId: string;
  amountIn: string; amountOut: string; minAmountOut: string;
  timeEstimateSec: number;
  depositAddress?: string;      // présent seulement si dry=false
  deadline?: string;
  signature: string;            // ed25519 Tidepool (non vérifiée par défaut)
}

export interface BridgeResult {
  status: BridgeStatus;
  depositAddress: string;
  amountOut?: string;
  solanaTxHashes: string[];     // swapDetails.originChainTxHashes
  nearTxHashes: string[];       // swapDetails.nearTxHashes + destinationChainTxHashes
  refundReason?: string;
}

export interface Crosschain {
  health(): Promise<{ ok: boolean; solOk: boolean }>;                     // GET /v0/health
  quote(p: QuoteParams, opts: { dry: boolean }): Promise<BridgeQuote>;    // POST /v0/quote
  buildSplDeposit(q: BridgeQuote, payer: string): Promise<Uint8Array>;    // tx non signée → wallet
  submitDeposit(txHash: string, depositAddress: string): Promise<void>;   // POST /v0/deposit/submit (optionnel)
  watch(depositAddress: string, onUpdate: (r: BridgeResult) => void,
        opts?: { intervalMs?: number; signal?: AbortSignal }): Promise<BridgeResult>; // GET /v0/status, 2–5 s, s'arrête sur SUCCESS/REFUNDED/FAILED
}
```

Garanties attendues de l'équipier : aucune clé dans le code, `dry: true` par défaut, aucun appel à un endpoint non documenté, erreurs HTTP Tidepool remontées telles quelles (`{status, message}`).
Ce que `crosschain` ne fait **jamais** : appeler Treasury ou Ref. La frontière est `BridgeResult.status === "SUCCESS"`, après quoi `apps/web` déclenche le `ft_transfer_call` vers Treasury (D-1).

## 11. Verdict

### **GO-WITH-FALLBACK**

- **Pour** : la route Solana Devnet → NEAR est **en ligne et quotable maintenant** (health ok, dry quote 1 USDC → 0.9974 USDC, livraison NEP-141 observée on-chain via `ft_transfer`). Ref testnet v1.9.19 est **Running**, toutes les méthodes nécessaires existent sur le wasm déployé, la création de pool est permissionless et accepte des tokens non whitelistés, et les parts LP sont lisibles (MFT 24 déc., `get_pool_shares`, `predict_add_simple_liquidity`). Rien de ce qui est nécessaire n'est hypothétique au niveau de l'existence des briques.
- **Pourquoi pas GO pur** : (1) la source Ref est introuvable, donc les coûts de storage de `add_simple_pool` / `add_liquidity` restent à mesurer (P0-1) ; (2) aucun bridge live exécuté par nous (P0-3) ; (3) toolchain NEAR absente et compatibilité wasm de Rust 1.98 non prouvée (P0-2) ; (4) Tidepool est un service communautaire sans SLA (P0-4).
- **Condition de bascule** : si G1 + G2 ne passent pas d'ici le **12/11 23:59 UTC**, activer B-1 et/ou B-2 et le déclarer dans le README.
