# NEAR Hackathon 2026 — Checklist de conformité SOL2NEAR

> Source : règlement officiel **https://nearhackathon.com/HACKATHON.md**, lu le **2026-11-11 ~21:50 UTC**
> (fichier sans numéro de version ; le règlement dit lui-même que les dates et règles peuvent changer
> et qu'il faut **le relire avant de soumettre**). Les références `Q-xxx` renvoient à sa FAQ.
>
> Règles internes, qui s'ajoutent au règlement : TESTNET uniquement ; **aucun déploiement, push, passage
> en public, signature, post ou soumission sans l'accord explicite du lead.**

Légende : ☐ à faire · ☑ fait (avec preuve) · ⚠ point d'attention

---

## 1. Dates (UTC) — source : tableau Facts

| Événement | Date |
|---|---|
| Début du hackathon / ouverture des soumissions | 2026-11-01T00:00:00Z |
| **Fin du développement et des soumissions** | **2026-11-14T23:59:00Z** (15/11 00:59 à Paris) |
| Début du jugement | 2026-11-16T00:00:00Z |
| Résultats au plus tard | 2026-11-18T23:59:00Z |
| Démo hébergée à maintenir en ligne | au moins jusqu'au 2026-11-18, idéalement jusqu'au 2026-11-25 (Q-012) |

- Hors de la fenêtre, l'API de soumission renvoie 403.
- **Deadline interne : soumission prête le 14/11 à 20:00 UTC** (marge de 4 h).

## 2. Tracks

| id | Nom | Ce qui est jugé | Adéquation SOL2NEAR |
|---|---|---|---|
| `memecoins` | Memecoins With Mechanics | « Judged on the mechanic, not the chart » ; treasuries with rules | **Track principal** : Treasury 90/8/2 à règles immuables, FUEL débloqué uniquement par Proof of Liquidity |
| `defi` | Unstoppable DeFi | vaults, trading et règlement cross-chain via NEAR Intents | **Track complémentaire** : vault et LP AMM, route Solana → NEAR |

- Plusieurs tracks sont autorisés dans le tableau `tracks` (« every track the project fits »), mais **une seule soumission par projet**.
- Les protocoles cités par les tracks sont des « hints and wishes, not requirements » (Q-011) : un contrat NEAR qui correspond au track suffit.
- ⚠ Pour `defi`, ne pas prétendre que nous « réglons via NEAR Intents » : la démo utilise **Tidepool** (voir §6). Formulation honnête : « architecture compatible 1Click, démontrée sur une sandbox communautaire ».

## 3. Dépôt GitHub, README, LICENSE

- [x] Dépôt **public** avant 2026-11-14T23:59Z, et public pendant tout le jugement (Q-014). Vérifié le 2026-11-11 : `github.com/nielslecodeur/SOL2NEAR` est `public` (API GitHub).
- [x] Le dépôt public contient le code final (`main` à jour le 13/11) ; chaque push passe par l'accord du lead.
- [x] Fichier `LICENSE` : MIT (« Any. MIT is fine. »).
- [ ] README écrit pour une IA **et** un humain (Q-017 : Claude Code et Codex font le screening, avec reproductibilité et vérification des fonctionnalités). Il doit contenir :
  - [ ] ce qu'est le produit, le problème, comment l'essayer ;
  - [ ] des étapes **« action → résultat attendu »** exécutables par un juge (commande, puis sortie attendue) ;
  - [ ] pour chaque fonctionnalité annoncée, son statut (réel testnet / unitaire seulement / non fait) et son lien de preuve ;
  - [ ] les sections « Libraries & templates », « AI assistance », « Prior work », « Testnet / Tidepool disclaimer ».
- [ ] Prior work (Q-001/Q-003) : **aucun code antérieur**. Le dépôt a été créé le 2026-11-11, dans la fenêtre. Poser le tag `hackathon-submission` sur le commit soumis.
- [ ] Aucun secret ni donnée personnelle dans Git (le règlement l'exige aussi des agents) : scan avant chaque push (commandes en §9).

## 4. Déclarations obligatoires (Q-005 : « List in README »)

| Catégorie | À déclarer |
|---|---|
| Bibliothèques Rust | `near-sdk` 5.30.1 (feature `unit-testing` en dev), `near-contract-standards` 5.30.1 (implémentation NEP-141/145 de FUEL) |
| Bibliothèques web | React 18.3.1, Vite 5.4.11, @vitejs/plugin-react 4.3.4 ; wallet NEAR : NEAR Wallet Selector 10.1.4 (core, modal-ui, my-near-wallet, meteor-wallet), `@near-js/transactions` 2.5.1 ; cross-chain : `@solana/web3.js` 1.98.4, `@solana/spl-token` 0.4.14 |
| Outils de build | cargo-near 0.22.0, wasm-opt (via cargo-near), near-cli-rs 0.31.1, pnpm 10, TypeScript 5.6.3 |
| Services externes | Tidepool (sandbox communautaire), Ref/Rhea exchange testnet `ref-finance-101.testnet`, NEAR testnet RPC |
| Templates / boilerplate | aucun |
| Code généré par IA | code et docs rédigés avec **Claude Code (Anthropic)** sous la direction de l'auteur (projet solo depuis le 2026-11-13), relus et testés, y compris `packages/crosschain` |
| Docs de conception | spec V3 et workflow écrits par l'équipe (`docs/`) |

## 5. Preuves de fonctionnement réel

Règle : **aucune fonctionnalité n'est annoncée sans preuve vérifiable**. Un test unitaire ne prouve pas une intégration on-chain.

| Fonctionnalité annoncée | Preuve exigée | Statut |
|---|---|---|
| Logique Treasury (90/8/2, états, garde-fous) | `cargo test` → `34 passed` | ☑ unitaire |
| Build officiel | `cargo near build` + SHA-256 | ☑ `35e9a79a…8168` |
| Route Solana Devnet → NEAR testnet | tx Solana + statut Tidepool `SUCCESS` + tx NEAR | ☑ G7 (13/11) : Solana `bGUicpgy…887R` → Tidepool `SUCCESS` → NEAR `J58H2uyu…RFqf` (1,9948 USDC) ; G8 (réconciliation bout en bout jusqu'au FUEL) ☐ |
| Dépôt NEP-141 dans Treasury | tx `ft_transfer_call` + `get_deposit` | ☑ C1 `AsD2o2aV…ZWzw` |
| Pool Ref créé | tx `add_simple_pool` + `get_pool` | ☑ A8 `BXcJeRyX…7f7B`, pool 2951 |
| LP réelles détenues par Treasury | tx `add_liquidity` + `get_pool_shares(Treasury) > 0` | ☑ C2 `4F2wXqzm…SSHA`, 165 640 253 516 145 704 019 022 parts |
| Proof of Liquidity | tx `verify_liquidity` + event `proof_of_liquidity` | ☑ C2 (event) + C3 `8DCCtF7y…MrkA` |
| FUEL : règles (supply, PoL, saisons, burn, claims) | `cargo test -p sol2near-fuel` → 31 passed ; walkthrough `demo_walkthrough -- --nocapture` | ☑ unitaire (VM mockée) |
| FUEL : build | cargo-near + SHA-256 | ☑ `scripts/build-wasm.sh` |
| FUEL : admission d'une vraie position | tx `register_position` + event `position_admitted` | ☑ C4 `CoAgrgQE…Lk6o` |
| FUEL : clôture de saison et claim | tx `close_season` + `claim` + event `reward_claimed` | ☑ C5 `DUuoq2XZ…haH9`, C6 `6g13fiwv…hXxu`, double claim refusé C7 `J8UEKyZy…AoWHi` |
| Frontend | `pnpm --filter @sol2near/web build` ; les données démo portent le bandeau SIMULATED | ☑ build ; ☑ données testnet réelles (vérifié dans Chrome le 13/11) ; ☐ transfert cross-chain réel |

Chaque preuve va dans le README avec un lien explorer (`testnet.nearblocks.io`, `explorer.solana.com/?cluster=devnet`). Si une étape n'est pas prouvée le jour J, le README et la vidéo disent **« non démontré »**.

## 6. Tidepool ≠ NEAR Intents officiel

- Le règlement indique qu'**il n'existe pas de testnet NEAR Intents** et qu'aucun n'est prévu (Q-007). Il recommande mainnet avec des comptes de dev séparés, de petits montants et des devis `dry: true`.
- Tidepool est un **service communautaire**, explicitement non affilié à NEAR, Defuse ou 1Click. Il est compatible avec l'API 1Click mais **n'est pas NEAR Intents** : maker unique, adresses de dépôt custodiales, relayers de confiance, pas de SLA (`docs/FEASIBILITY.md` §2.1).
- Les projets testnet-only sont **éligibles à tous les tracks** (Q-010) et la démo locale est acceptée (Q-012).
- **Formulation imposée** (README, vidéo, post X) : « Testnet demo using Tidepool, a community-built 1Click-compatible sandbox — not the official NEAR Intents service. Production would target the official 1Click API. »
- ⚠ Une démo mainnet NEAR Intents réelle sortirait de notre règle « testnet uniquement ». Elle ne se fera que sur décision explicite du lead, avec des comptes et des montants dédiés.

## 7. Frais : toujours issus des devis

- [x] Aucun frais de bridge, de swap ou de protocole n'est codé en dur dans `contracts/` ni dans `packages/` (vérifié le 2026-11-11 par grep : seuls existent les poids 90/8/2 et les garde-fous de slippage fournis par l'appelant).
- [ ] L'UI affiche les frais calculés à partir du **devis réel** : `amountIn − amountOut` et `minAmountOut` de `POST /v0/quote`, et `get_return` / `predict_add_simple_liquidity` sur Ref.
- [ ] Ne jamais réutiliser en production un chiffre observé une fois (exemple : 1 USDC → 0,9974, soit ≈ 0,26 %, le 2026-11-11). Ces chiffres ne servent que d'exemples datés dans la doc.
- ⚠ Pour info, sur 1Click mainnet sans JWT, le règlement mentionne des frais de 0,2 % (Q-006). Les frais Tidepool sont différents : seul le devis fait foi.
- [ ] Les frais du pool Ref (`total_fee`) se lisent via `get_pool` ; le chiffre « ~80 % des frais aux LP » est une doc Rhea à citer, pas une constante.

## 8. Démo, post X, soumission

**Vidéo et démo**
- [ ] Vidéo (aucune durée imposée ; visée ≤ 3 min, storyboard de la spec §13) montrant de vraies transactions et leurs hashes.
- [ ] Une démo hébergée est un plus, pas une obligation. Si elle existe, la garder en ligne jusqu'au 25/11.

**Post X** (publié par **un humain** ; l'agent peut seulement en rédiger le texte)
- [ ] Indiquer que le projet a été « built at NEAR HACKATHON ».
- [ ] Mentionner **@NEARProtocol** et **#NEARHackathon** (optionnel : @NearLegion, @NearBuilders).
- [ ] Joindre la vidéo, ou à défaut des captures. Les captures ne suffisent pas si la démo ne peut pas être ouverte (Q-012).
- [ ] L'URL du post sert de `demoUrl`.

**Soumission** (un seul envoi : `POST https://nearhackathon.com/api/applications` ou le formulaire `https://nearhackathon.com/#apply`)

| Champ | Valeur | Fourni par |
|---|---|---|
| `requestId` | UUID généré **une fois**, réutilisé en cas de retry | agent |
| `projectName` | « SOL2NEAR » (2 à 80 car.) | lead à confirmer |
| `leadName` | — | **lead** |
| `email` | — (2 soumissions max par e-mail) | **lead** |
| `size` | `1` (projet solo depuis le 13/11) | lead à confirmer |
| `tracks` | `["memecoins","defi"]` | lead à confirmer |
| `nearAddress` | compte **mainnet** de paiement, créé par l'équipe | **lead** |
| `projectUrl` | `https://github.com/nielslecodeur/SOL2NEAR` (un dépôt ne peut être soumis qu'une fois) | lead à confirmer |
| `demoUrl` | URL du post X | **lead** |
| `idea` | 20 à 2000 car. : problème, produit, rôle de NEAR | agent rédige, lead valide |
| `consent` | `true` seulement après accord du lead sur la notice de contact | **lead** |
| `website` | **ne pas envoyer** (piège anti-spam) | — |

- Aucune valeur placeholder ni inventée. Le payload n'est pas commité (il contient des données personnelles).
- Codes de retour : 201 = OK ; 400 = corriger avec le même `requestId` ; 403 = ne pas réessayer ; 409 = dépôt ou e-mail déjà utilisé ; 503 = retry avec le même `requestId`.
- Modifications après envoi : https://nearhackathon.com/request-changes (aucun second envoi).

## 9. Contrôle final du règlement (à faire le 14/11, avant soumission)

1. [x] **Relire la version live** (13/11 ~14:00 UTC, SHA-256 `6dd0c1ff…868d` : dates, champs, tracks et statuts identiques ; Q-001 autorise le code depuis l'annonce du 19/10 ; Q-015 : 2 projets max par personne, chacun cité dans l'autre README) de https://nearhackathon.com/HACKATHON.md et la comparer à cette checklist (dates, champs, Q-xxx). Mettre à jour ce fichier si quelque chose a changé.
2. [x] (13/11 13:59 UTC : dans la fenêtre, dépôt `public`) Vérifier la fenêtre (`now < 2026-11-14T23:59:00Z`) et que le dépôt est public : `GET https://api.github.com/repos/nielslecodeur/SOL2NEAR` → `"visibility":"public"`.
3. [x] (13/11 : seuls des faux positifs, le texte des règles ; aucune donnée perso) Faire le scan des secrets et données personnelles sur ce qui sera poussé :
   `git diff origin/main..HEAD | grep -iE 'ed25519:[1-9A-HJ-NP-Za-km-z]{80,}|secret_key|private_key|mnemonic'` → doit être vide ;
   `git ls-tree -r --name-only HEAD | grep -iE '\.env|credential|keypair|id\.json'` → doit être vide.
4. [x] (13/11 sur un clone propre : TS 6+21+6 pass, cargo Treasury 34 + FUEL 31 pass ; sur Windows, garder `target` hors du dossier Temp car MSBuild y refuse aws-lc-sys) Faire tourner les étapes « action → résultat » du README sur une copie propre (`git clone` → build → tests) et vérifier les sorties.
5. [x] Vérifier chaque lien de preuve du README (13/11 : les 12 tx confirmées par RPC, A8–B2 via archival ; C7 échoue avec `ERR_ALREADY_CLAIMED` comme prévu).
6. [ ] Tenir le tableau §5 à jour : rien n'est marqué ☑ sans preuve.
7. [x] Déclarations §4 présentes dans le README (bibliothèques Solana ajoutées le 13/11).
8. [ ] Disclaimer Tidepool §6 présent dans le README (☑), la vidéo et le post X (☐).
9. [ ] Post X publié par un humain, URL récupérée.
10. [ ] Le lead valide le **payload exact** de soumission, puis envoi **unique**. Conserver la réponse 201, sans la commiter.
11. [ ] Taguer `hackathon-submission` sur le commit soumis (le push du tag demande aussi un accord).
