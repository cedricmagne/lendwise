# Refactor architecture protocoles — Yield Adapters

**Date:** 2026-07-15
**Statut:** design validé section par section, en attente de relecture finale

---

## 1. Contexte et problème

L'architecture actuelle de `src/lib/protocols/` impose deux voies d'accès aux données
par protocole (`offchain/` = API GraphQL du protocole, `onchain/` = subgraph The Graph).
En pratique **une seule voie est utilisée par protocole** :

| Protocole   | Voie réelle                          | État de l'autre voie                        |
| ----------- | ------------------------------------ | ------------------------------------------- |
| Aave v3     | offchain (api.v3.aave.com)           | `onchain/` — **0 import, code mort**        |
| Morpho v1   | offchain (api.morpho.org)            | `onchain/` — import commenté, **code mort** |
| Compound v3 | onchain (subgraphs, Messari/Spencer) | pas d'offchain (pas d'API GraphQL)          |

De plus, **deux systèmes parallèles** coexistent :

1. **Pipeline** (le vrai flux de données) : `fetchXApySpot` / `fetchXProducts` /
   `fetchXHistory` — fonctions exportées, câblées à la main dans 4 call sites
   (`PROTOCOL_TASKS` dans `apy-snapshots.actions.ts`, `products-sync.actions.ts`,
   `heal/route.ts`, `cron/sync-history/route.ts`).
2. **`ProtocolAdapter`** (positions wallet + rates UI) : registre + `VersionAdapter` +
   `DataSourceConfig {positions, stats, rates}` — abstraction lourde où chaque
   protocole branche **le même adapter** dans tous les slots. `getMarketStats`
   n'a aucun consommateur réel.

Objectif : **un seul adapter par protocole**, contrat défini par Lendwise, extensible
par la communauté sur le modèle DefiLlama yield-server
(<https://github.com/DefiLlama/yield-server>).

## 2. Décisions actées

| Question                       | Décision                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Granularité de l'unité de base | **Par protocole+version** (`aave_v3`, `morpho_v1`…). L'adapter gère toutes ses chains via sa config ; overrides par chain possibles en interne (cas Compound). |
| Périmètre du contrat           | **Pipeline seul** : `getProducts` / `getApySpot` / `getApyHistory`. Les positions wallet et rates UI restent un système séparé (simplifié — voir §7).          |
| Propriété du transport         | **L'adapter possède son transport** (modèle DefiLlama). Fonction async libre ; le core fournit un toolkit optionnel et valide la sortie.                       |
| Modèle de contribution         | **PR in-repo** : un dossier `src/lib/protocols/{name}/{version}/` + une ligne de registry. CI exécute l'adapter et valide le format.                           |
| Legacy                         | **Nettoyage à fond** : suppression des `onchain/` morts, de la machinerie `DataSourceConfig`/`VersionAdapter`, réduction des positions à une interface simple. |

## 3. Contrat `YieldAdapter`

Le modèle de données Lendwise **est** l'interface : les types de sortie sont les types
DB existants (`SpotPayload`, `SupplyProduct`, `BorrowProduct`, `HistoryDataPoint`).
L'adapter transforme sa source (API, subgraph, RPC, REST — son choix) vers ces types.

```ts
// src/lib/protocols/core/types.ts

/** Config chain minimale. Champs libres propres à l'adapter autorisés. */
export interface AdapterChain {
  /** Slug canonique du productId — doit matcher CHAIN_SLUG_MAP. */
  slug: string
  /** Extras libres de l'adapter (subgraphUrl, marketName, …). */
  [key: string]: unknown
}

export interface FetchOpts {
  /** Filtre par chain_id canonique. Remplace l'ancien chainFilter?: string (nom). */
  chainIds?: number[]
}

export interface HistoryParams {
  startTimestamp: number // unix seconds
  endTimestamp: number // unix seconds
  interval: 'HOUR' | 'DAY'
  chainIds?: number[]
  onProgress?: (msg: string) => void
}

export interface YieldAdapter {
  /** Unique. = clé registry = protocol_name en DB. Ex: 'aave_v3'. */
  id: string
  /** Nom affichable. Ex: 'Aave v3'. */
  name: string
  /** Groupe les versions. Ex: 'aave'. = colonne provider. */
  provider: string
  /** Ex: 'v3'. */
  version: string
  /** chainId → config chain. Source de vérité des chains supportées. */
  chains: Record<number, AdapterChain>
  /** Floors d'ingestion — l'unique filtre irréversible (inchangé). */
  ingestion?: IngestionFloors

  /** Catalogue statique des produits (sync horaire). */
  getProducts(opts?: FetchOpts): Promise<(SupplyProduct | BorrowProduct)[]>
  /** Snapshots APY spot (collecteur 10 min). */
  getApySpot(opts?: FetchOpts): Promise<SpotPayload[]>
  /**
   * Historique pour heal/backfill. OPTIONNEL — un protocole sans source
   * historique (Compound) l'omet ; le heal job le saute (donor-based fallback).
   */
  getApyHistory?(params: HistoryParams): Promise<HistoryDataPoint[]>
}
```

Points clés :

- `AdapterChain` **léger** — fini le spread du viem `Chain` complet dans la config.
  Un adapter qui fait du RPC importe viem lui-même.
- `chainIds?: number[]` remplace `chainFilter?: string` qui matchait sur `c.name` —
  conforme à la règle « filter/group by chain_id, never chain_name ».
- Params history **unifiés**. Aujourd'hui Morpho prend `{interval, startTimestamp,
endTimestamp}` et Aave `{window: 'LAST_WEEK'}` : Aave mappera en interne la plage
  demandée vers le plus petit `window` qui la couvre.
- `defineYieldAdapter()` (dans `core/define.ts`) = fonction identity typée, pour
  l'inférence et un point d'ancrage documentation/validation.
- `HistoryDataPoint` déménage de `aave/v3/apy-history.ts` vers `core/types.ts`
  (c'est un type de contrat, pas un détail Aave).

### Invariant products/spot

`getProducts` et `getApySpot` DOIVENT énumérer le **même ensemble de productIds**
(leçon de `aave/v3/listing.ts` : le drift a produit ~18 500 lignes orphelines/semaine).
Convention : un `listing.ts` par adapter, seule source du prédicat. **Mécanisé** par
le harness CI (§6) pour tous les protocoles — plus seulement Aave.

## 4. Registry

Séparé en deux fichiers car l'UI (client components) consomme les métadonnées mais ne
peut pas dynamic-importer un adapter serveur :

```ts
// src/config/protocols-meta.ts — importable côté client, zéro dépendance serveur
export const PROTOCOLS_META = {
  aave_v3: { displayName: 'Aave', versionName: 'Aave v3', provider: 'aave' },
  morpho_v1: {
    displayName: 'Morpho',
    versionName: 'Morpho v1',
    provider: 'morpho',
  },
  compound_v3: {
    displayName: 'Compound',
    versionName: 'Compound v3',
    provider: 'compound',
  },
} as const

export type ProtocolName = keyof typeof PROTOCOLS_META
```

```ts
// src/config/protocols-server.ts — loaders dynamiques, serveur uniquement
export const YIELD_ADAPTERS: Record<ProtocolName, () => Promise<YieldAdapter>> =
  {
    aave_v3: () => import('@/lib/protocols/aave/v3').then((m) => m.adapter),
    morpho_v1: () => import('@/lib/protocols/morpho/v1').then((m) => m.adapter),
    compound_v3: () =>
      import('@/lib/protocols/compound/v3').then((m) => m.adapter),
  }

export const APP_ADAPTERS: Partial<
  Record<ProtocolName, () => Promise<AppAdapter>>
> = {
  // positions wallet + rates UI — optionnel par protocole (§7)
}
```

- Dynamic import conservé — Next.js ne bundle l'adapter que dans les routes qui
  l'utilisent.
- `ProtocolName` dérivé des clés de `PROTOCOLS_META` (fini le type croisé
  `PROTOCOL_REGISTRY[K]['config']`).
- Ajout d'un protocole = 1 dossier + 1 entrée meta + 1 loader. Désactivation =
  commenter les entrées (comportement actuel conservé).
- Le typage `Record<ProtocolName, …>` garantit à la compilation que chaque meta a
  son loader yield (pas besoin de check CI séparé).
- Helpers actuels (`getProtocolConfig`, `getProtocolGlobalNameById`,
  `getProtocolVersionNameById`, `getProtocolIds`) remplacés par des lookups directs
  sur `PROTOCOLS_META` / l'adapter chargé.

## 5. Layout cible

```
src/lib/protocols/
  core/                        # Lendwise-owned — le « framework »
    types.ts                   # YieldAdapter, AppAdapter, AdapterChain, FetchOpts,
                               #   HistoryParams, HistoryDataPoint, IngestionFloors
                               #   (déménagé depuis config/protocols.ts, doc comment inclus)
    define.ts                  # defineYieldAdapter()
    validation.ts              # schémas zod : SpotPayload, SupplyProduct, BorrowProduct
    toolkit/
      graphql-client.ts        # ex shared/graphql-client.ts
      batch.ts                 # ex shared/batch.ts
      merkl.ts                 # fetchMerklIncentives extrait de aave/v3/apy-spot.ts
      chain-slugs.ts           # CHAIN_SLUG_MAP (ex protocols/chain-slugs.ts)
  aave/
    v3/
      index.ts                 # export const adapter = defineYieldAdapter({ … })
      config.ts                # chains: { 1: { slug: 'ethereum' }, … }
      listing.ts               # prédicat d'énumération (inchangé)
      products.ts              # getProducts
      apy-spot.ts              # getApySpot
      apy-history.ts           # getApyHistory
      positions.ts             # AppAdapter (ex offchain/ positions + market-rates)
      queries.ts               # ex offchain/queries.ts
      generated/               # ex offchain/generated/ (codegen inchangé, chemin mis à jour)
      utils.ts                 # buildProductId etc. (inchangé)
  morpho/v1/                   # même structure
  compound/v3/                 # même structure ; garde ses overrides par chain
                               #   ({chainName}/ + registerChain) en interne —
                               #   détail d'implémentation invisible du contrat
scripts/
  adapter-test.ts              # harness CI — pnpm adapter:test <id>
```

Le contenu de `offchain/` remonte d'un niveau (il n'y a plus qu'une voie, le nom ne
signifie plus rien). `shared/` devient `core/toolkit/` : le toolkit est **optionnel**
— un adapter peut l'ignorer totalement et faire ses fetchs comme il veut.

### Extraction Merkl

`fetchMerklIncentives` (~70 lignes dans `aave/v3/apy-spot.ts`) part dans
`core/toolkit/merkl.ts`, paramétré (`name=aave` → paramètre). Justification : Merkl
sert plusieurs protocoles (le fix « merkl avve apy » et
`scripts/clean-merkl-market-misattribution.ts` montrent que c'est déjà un sujet
transverse). Le mapping `AAVE_MARKET_TO_MERKL_SLUG` reste chez Aave.

## 6. Validation et harness CI

### Schémas zod (`core/validation.ts`)

- `SpotPayload` : productId non vide, `kind ∈ {supply, borrow}`, APY numériques finis
  et bornés (ex. `|apy| < 10` soit 1000 % — filet anti reward-spike), `chainId` présent
  dans `adapter.chains`, `rewardItems` bien formés.
- `SupplyProduct`/`BorrowProduct` : mêmes vérifications + cohérence
  provider/version avec l'adapter.

**Deux usages, deux sévérités :**

1. **Runtime (ingestion)** : validation _soft_ dans `collectApySpot` et
   products-sync — payload invalide → log + skip du payload, jamais de crash du
   slot (préserve la sémantique `Promise.allSettled`).
2. **CI (harness)** : validation _stricte_ — tout échec fait échouer le run.

### Harness (`pnpm adapter:test <id>`)

1. Charge l'adapter via `YIELD_ADAPTERS`.
2. Exécute `getProducts()` + `getApySpot()` en réel (réseau requis).
3. Valide chaque payload (zod strict).
4. **Diffe les sets de productIds** products vs spot → échec si drift.
5. Affiche un tableau récapitulatif : nombre de produits par chain × kind,
   APY min/max/médian, TVL totale — revue humaine facile des PRs communautaires
   (même esprit que le `npm run test --adapter=X` de DefiLlama).

`getApyHistory` n'est pas exécuté par le harness (plages temporelles trop variables)
— sa présence et sa signature sont vérifiées par le typage.

## 7. `AppAdapter` — positions wallet + rates UI

Remplace toute la machinerie `ProtocolAdapter`/`VersionAdapter`/`DataSourceConfig` :

```ts
// core/types.ts
export interface AppAdapter {
  getUserSupplyPositions(p: { addresses: Address[] }): Promise<SupplyPosition[]>
  getUserBorrowPositions(p: { addresses: Address[] }): Promise<BorrowPosition[]>
  getMarketSupplyHistoryRates(p: RateParams): Promise<MarketRate[]>
  getMarketBorrowHistoryRates(p: RateParams): Promise<MarketRate[]>
}
// RateParams = { poolId, chainId, tokenId, interval, fromTimestamp } (inchangé)
```

- Registry `APP_ADAPTERS` séparé, **optionnel par protocole** — un contributeur
  yield n'a pas à fournir les positions ; un protocole peut être pipeline-only.
- Implémentations actuelles conservées telles quelles (elles marchent), seulement
  re-exposées sous cette interface plate dans `{protocol}/{version}/positions.ts`.
- Le paramètre `version?: string` des méthodes disparaît : la version est dans la
  clé du registry (`aave_v3`), plus dans un argument.

## 8. Call sites réécrits

| Call site                                 | Avant                                                                                 | Après                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `app/actions/apy-snapshots.actions.ts`    | `PROTOCOL_TASKS` câblé main                                                           | itère `YIELD_ADAPTERS` → `adapter.getApySpot()`                                                       |
| `app/actions/products-sync.actions.ts`    | 2e record câblé main                                                                  | `adapter.getProducts()`                                                                               |
| `app/api/yield/apy/heal/route.ts`         | imports directs `fetchAaveHistory`/`fetchMorphoHistory` + `detectProtocol(productId)` | `adapter.getApyHistory?.(params)` ; gaps groupés par provider **via JOIN products** (voir ci-dessous) |
| `app/api/cron/sync-history/route.ts`      | `syncAaveHistory` direct                                                              | via registry                                                                                          |
| `app/actions/user-*-positions.actions.ts` | `getProtocolAdapter` + versions                                                       | itère `APP_ADAPTERS`                                                                                  |
| `app/actions/market-rates.actions.ts`     | `getProtocolAdapter().getMarket…HistoryRates`                                         | `APP_ADAPTERS[id]`                                                                                    |
| `scripts/products-sync.ts`                | inchangé (passe par l'action)                                                         | inchangé                                                                                              |

`Promise.allSettled` conservé partout — une source en échec ne bloque pas les autres.

### Correction heal — `detectProtocol`

`heal/route.ts` fait aujourd'hui `detectProtocol(entry.productId)` — un **parse du
productId**, violation directe de la règle DB « never parse productId ». Les gaps
proviennent de `pipeline_reports` ; le heal résoudra le provider par JOIN sur
`products` (colonne `provider` typée et indexée) au moment de fetcher les entries,
puis mappera provider → adapter id via `PROTOCOLS_META`.

## 9. Suppressions

| Élément                                                                                                                           | Raison                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `aave/v3/onchain/` (tout le dossier, 13 sous-dossiers chains + generated)                                                         | 0 import                                              |
| `morpho/v1/onchain/` (tout le dossier)                                                                                            | seul import commenté                                  |
| `protocols/utils.ts` : `createProtocolAdapter`, `createVersionAdapter`                                                            | remplacés par `defineYieldAdapter` + registries       |
| `protocols/types.ts` : `DataAdapter`, `DataSourceConfig`, `VersionAdapter`, `ProtocolMethods`, `dataSourceType`, `DataSourceType` | abstraction sans second cas d'usage                   |
| `hooks/useMarketStats.ts` + `getMarketStats` partout                                                                              | 0 consommateur réel                                   |
| `subgraphUrl` / `clientPath` dans configs aave + morpho                                                                           | ne servaient qu'aux onchain morts                     |
| Spread viem `Chain` dans `ProtocolChain` / `ProtocolConfig`                                                                       | remplacé par `AdapterChain` léger                     |
| `config/protocols.ts` (l'actuel)                                                                                                  | éclaté en `protocols-meta.ts` + `protocols-server.ts` |

Vérification avant chaque suppression : `grep` des imports + `pnpm typecheck` +
`pnpm build`. Le codegen (`codegen.ts`) doit être mis à jour pour les chemins
`generated/` déplacés et purgé des cibles onchain aave/morpho supprimées.

## 10. Plan de migration — 4 PRs

1. **PR 1 — Core + contrat.** Crée `core/` (types, define, validation, toolkit par
   déplacement de `shared/`), `protocols-meta.ts`, `protocols-server.ts`. Rien de
   cassé : les anciens chemins restent (ré-exports temporaires depuis `shared/`).
2. **PR 2 — Migration des 3 adapters + call sites pipeline.** Chaque protocole
   expose `adapter = defineYieldAdapter({…})` ; `offchain/` remonte d'un niveau ;
   collector, products-sync, heal, sync-history passent par le registry. Codegen
   mis à jour. Fix `chainIds` + fix heal `detectProtocol`.
3. **PR 3 — AppAdapter + suppression legacy.** `positions.ts` par protocole,
   actions positions/market-rates réécrites, suppression de tout le §9.
4. **PR 4 — Harness CI + doc contributeur.** `scripts/adapter-test.ts`,
   `pnpm adapter:test`, réécriture de `src/lib/protocols/README.md` en guide
   « How to add a protocol » (contrat, layout, conventions, checklist PR).

Chaque PR : `pnpm typecheck && pnpm lint && pnpm build` verts + run manuel de
`collectApySpot` (protocole par protocole) comparé au comportement avant refactor
(mêmes counts de payloads, mêmes productIds).

## 11. Non-buts

- **Pas de changement de schéma DB** — productIds, tables, repositories intacts.
- **Pas de serveur HTTP externe** par yield-server (écarté — overkill).
- **Pas de refonte des implémentations** de fetch/transform existantes : elles
  déménagent et changent de signature, la logique métier (Merkl, incentives,
  listing, e^APR…) ne change pas.
- **Pas d'auto-discovery filesystem** des adapters — registry explicite (Next.js
  bundling + revue humaine des PRs communautaires).
- Le vrai « yield-server » extractible en package séparé : non-but aujourd'hui,
  mais le contrat n'importe rien du core app en dehors des types — l'extraction
  future reste possible.

## 12. Risques

| Risque                                                            | Mitigation                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Régression silencieuse du pipeline (counts/productIds différents) | Comparaison avant/après des counts et sets de productIds par protocole, par run manuel de `collectApySpot` sur chaque PR |
| Drift products/spot chez un futur contributeur                    | Harness CI (diff des sets, bloquant)                                                                                     |
| Payload communautaire malformé en prod                            | Validation zod runtime soft (skip + log)                                                                                 |
| Déplacement `generated/` casse le codegen                         | PR 2 inclut la mise à jour de `codegen.ts` ; `pnpm codegen:clean` + build en CI                                          |
| Oubli d'un consommateur des helpers supprimés                     | `pnpm typecheck` strict — tous les helpers sont typés, un import cassé ne compile pas                                    |

## 13. Critères de succès

1. Un protocole = un dossier ; `offchain/`/`onchain/` n'existent plus.
2. Ajouter un protocole = 1 dossier + 2 lignes de registry + harness vert —
   documenté dans le README contributeur.
3. Les 4 jobs pipeline (spot 10 min, products sync, daily, heal) tournent à
   l'identique (mêmes counts, mêmes productIds).
4. `grep -r "DataSourceConfig\|VersionAdapter\|dataSourceType" src/` → 0 résultat.
5. `pnpm adapter:test aave_v3|morpho_v1|compound_v3` passe pour les trois.
