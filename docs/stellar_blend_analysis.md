# Rapport de Faisabilité : Intégration de Blend Protocol (Stellar) dans Lendwise

Ce document présente l'analyse de faisabilité technique pour intégrer le protocole DeFi **Blend** de la blockchain **Stellar** (non-EVM) dans Lendwise. Il évalue l'exploitabilité des mécanismes actuels de connexion de wallet et de récupération des APY (via GraphQL).

---

## 📋 Synthèse Générale

L'intégration de Blend (Stellar) est **techniquement réalisable**, mais elle requiert de **nouveaux modules spécifiques** plutôt que de réutiliser directement le code existant. 
- Les outils de wallet actuels (**Wagmi/RainbowKit**) sont exclusivement EVM et ne peuvent pas communiquer avec Stellar.
- La récupération d'APY actuelle repose sur des subgraphs **GraphQL**, alors que Blend/Stellar utilise un **SDK JS / API REST**.
- L'architecture de Lendwise (basée sur un registre de protocoles et des adaptateurs isolés) est cependant **suffisamment modulaire** pour accueillir cette intégration sans casser le fonctionnement de l'EVM.

---

## 1. 🔑 Analyse de la Connexion Wallet

### 🚫 Limites de l'existant
L'application utilise actuellement **Wagmi** et **RainbowKit** pour la gestion de portefeuille :
1. **Types EVM Stricts** : Le type d'adresse utilisé dans l'application est `Address` de `viem`, qui impose le format hexadécimal `0x${string}`. Les adresses Stellar (ex: `GB3...` ou `C...` pour les contrats) provoqueront des erreurs de typage et de validation.
2. **Protocole de communication** : Le multi-wallet manager (`src/hooks/useMultiWalletManager.ts` et `src/contexts/WalletWatcherContext.tsx`) écoute les événements de fournisseurs injectés comme `window.ethereum` et instancie des clients via `viem.custom()`. Les wallets Stellar (Freighter, Albedo, xBull, Lobstr) n'utilisent pas ce standard.

### 💡 Solution & Adaptabilité
Pour intégrer les portefeuilles Stellar, nous devons concevoir une **coexistence multi-écosystèmes** :

- **Unifier le Store Zustand** :
  Le store `src/stores/walletStore.ts` possède déjà un champ `isBitcoin: boolean`. C'est une excellente base qui montre que le store a été pensé pour être multi-chaînes. Nous devrons ajouter un champ `isStellar: boolean` ou un champ `chainFamily: 'evm' | 'stellar' | 'bitcoin'`.
- **Intégration de Stellar Wallets Kit** :
  Installer la bibliothèque standard de l'écosystème Stellar : `@creit-tech/stellar-wallets-kit` ou `@stellar/wallet-sdk`.
- **Création d'un Context Parallèle** :
  Créer un `StellarWeb3Context.tsx` fonctionnant à côté de `WagmiProvider` pour gérer l'état de connexion de la clé publique Stellar et mettre à jour le `walletStore` unifié.

```mermaid
graph TD
    SubGraph[App Providers]
    Wagmi[WagmiProvider (EVM)] --> UnifiedStore[(Zustand WalletStore)]
    StellarKit[StellarWalletsKitProvider (Stellar)] --> UnifiedStore
    
    UnifiedStore --> UI[UI / Dashboard]
```

---

## 2. 📊 Récupération des APY & Données Protocoles

### 🚫 Limites de l'existant (GraphQL/Subgraphs)
Le système actuel synchronise les APY en requêtant les subgraphs de "The Graph" via un client GraphQL générique basé sur `@urql/core` (`src/lib/protocols/shared/graphql-client.ts`).
1. **Pas de Subgraph Blend** : La blockchain Stellar n'utilise pas l'infrastructure standardisé des subgraphs EVM. Bien qu'il existe des indexeurs tiers (ex: Bitquery) offrant du GraphQL pour Stellar, Blend Protocol ne fournit pas de subgraph officiel.
2. **SDK et API REST natifs** : L'écosystème Blend utilise principalement le SDK JS officiel `@blend-capital/blend-sdk-js` pour lire les états directement depuis les contrats Soroban (simulations RPC) et calculer les APY dynamiques, ou requêter leur API REST officielle.

### 💡 Solution & Adaptabilité
L'outil GraphQL actuel n'est **pas exploitable** pour Blend. En revanche, le **système de synchronisation de Lendwise** est très bien conçu pour cette transition :

- **Le Registre de Protocoles est Flexible** :
  Lendwise utilise un système d'adaptateurs découplés (`src/app/actions/products-sync.actions.ts`). La fonction `syncProducts()` appelle dynamiquement la fonction de récupération propre à chaque protocole (`fetchAaveV3Products`, `fetchCompoundV3Products`).
- **Nouveau Fetcher Non-GraphQL** :
  Nous pouvons créer un adaptateur `src/lib/protocols/blend` sans utiliser `createGraphQLClient`. Ce module exploitera l'API REST de Blend ou `@blend-capital/blend-sdk-js` pour récupérer les APY de supply et de borrow, puis renverra les données normalisées sous forme de `SupplyProduct` et `BorrowProduct` attendues par la base de données PostgreSQL de Lendwise.

---

## 🛠️ Plan d'Architecture Proposé

Pour ajouter Blend sans impacter les protocoles EVM existants, voici les étapes d'intégration recommandées :

```
src/
├── config/
│   └── protocols.ts                 # Enregistrer 'blend' dans les protocoles supportés
└── lib/
    └── protocols/
        └── blend/
            ├── index.ts             # Adaptateur principal (récupère positions)
            ├── config.ts            # Configuration des RPC Soroban/API Blend
            └── services/
                └── blend-api.ts     # Client REST/SDK pour récupérer les APY spot
```

### Étape 1 : Modification des Types et du Core Store
1. Étendre le type `Protocol` dans `src/types/supplying.ts` :
   ```typescript
   export type Protocol = 'aave' | 'compound' | 'morpho' | 'blend'
   ```
2. Ajouter le support des adresses Stellar dans `walletStore.ts` (en assouplissant la contrainte du type `Address` de `viem` dans les zones multi-chaînes).

### Étape 2 : Création de l'Adaptateur Blend
1. Créer `src/lib/protocols/blend/services/blend-api.ts` pour fetcher les taux :
   ```typescript
   // fetchBlendSpotApy interroge l'API REST de Blend ou simule des calls Soroban via stellar-sdk
   export async function fetchBlendSpotApy(): Promise<SpotPayload[]> {
     const response = await fetch('https://api.blend.capital/v1/pools') // Exemple d'endpoint REST Blend
     const data = await response.json()
     // Mapper les données vers SpotPayload
   }
   ```
2. Implémenter l'adaptateur dans `src/lib/protocols/blend/index.ts` qui se conforme à l'interface `DataAdapter`.

---

## 📝 Conclusion et Recommandation

| Module | Exploitable ? | Solution d'intégration | Effort requis |
| :--- | :--- | :--- | :--- |
| **Connexion Wallet** | **Non** (EVM unique) | Ajouter `@creit-tech/stellar-wallets-kit` + Context dédié Stellar | Moyen ⚡ |
| **Requêtes APY (GraphQL)** | **Non** (Pas de Subgraph) | Écrire un fetcher dans l'adaptateur Blend via leur API REST ou SDK Soroban | Moyen ⚡ |
| **Architecture / Ingestion**| **Oui** (Très modulaire) | Enregistrer le nouvel adaptateur dans le registre central | Faible ✅ |

**Recommandation** : Procéder à l'intégration en créant un adaptateur spécifique pour Blend dans `src/lib/protocols/blend` qui contourne GraphQL au profit d'appels HTTP classiques sur l'API REST de Blend, tout en ajoutant la dépendance `@creit-tech/stellar-wallets-kit` pour le frontend.
