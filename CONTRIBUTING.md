# Contributing to Lendwise

Thanks for your interest in contributing! Lendwise aggregates and compares lending rates
across DeFi protocols, and every contribution — a protocol adapter, a bug report, a token
icon, a docs fix — makes the data better for everyone.

## Ways to contribute

| I want to...                       | Start here                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Add a new lending protocol         | [Adding a protocol adapter](#adding-a-protocol-adapter) — the highest-impact contribution            |
| Report wrong data or a broken page | [Bug report](https://github.com/lendwise-fi/lendwise/issues/new?template=bug_report.yml)             |
| Request a protocol integration     | [Protocol request](https://github.com/lendwise-fi/lendwise/issues/new?template=protocol_request.yml) |
| Suggest a feature                  | [Feature request](https://github.com/lendwise-fi/lendwise/issues/new?template=feature_request.yml)   |
| Ask a question                     | [GitHub Discussions](https://github.com/lendwise-fi/lendwise/discussions)                            |
| Make a first small PR              | [Your first PR in 15 minutes](#your-first-pr-in-15-minutes)                                          |

## Development setup

**Prerequisites:** Node.js 24, [pnpm](https://pnpm.io) 11.

```bash
git clone https://github.com/lendwise-fi/lendwise
cd lendwise
pnpm install
cp .env.example .env.local   # see below for which keys you actually need
pnpm dev                     # → http://localhost:3000
```

Not every env var is required for local work:

| Variable                     | Needed for                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | Anything that reads/writes APY history (Neon Postgres)                                        |
| `THEGRAPH_API_KEY`           | `pnpm codegen` and the Compound V3 adapter ([free key](https://thegraph.com/studio/apikeys/)) |
| `NEXT_PUBLIC_INFURA_API_KEY` | On-chain reads (wallet positions)                                                             |
| Everything else              | Optional locally — rate limiting and analytics no-op when unset                               |

Adapter work only touches GraphQL APIs and subgraphs — you can build and test an adapter
with just `THEGRAPH_API_KEY`, no database needed.

## Quality bar

The project has no code-review bottleneck other than these — all enforced in CI:

```bash
pnpm codegen        # regenerate GraphQL types (needed before typecheck/test)
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit (strict mode)
pnpm test           # vitest
pnpm format         # prettier --write
```

House rules:

- **TypeScript strict, no `any`.**
- **Functional only — no classes.**
- **`Promise.allSettled`** wherever multiple sources are aggregated: one failure never
  blocks the others.
- **Rates are stored as APY.** Convert APR before emitting: `(1 + APR/365)^365 - 1`
  (helpers in `src/lib/utils.ts`).
- **Never parse a `productId`** — it is an opaque key. Provider/chain/asset live as typed
  columns on `products`; resolve by JOIN.
- **Filter chains by `chain_id`, never by chain name** — names are inconsistent across
  adapters; only the numeric id is canonical.

## Adding a protocol adapter

This is the contribution Lendwise is designed around. An adapter is a small, self-contained
module (~5 files) that transforms a protocol's data source — GraphQL API, subgraph, or RPC —
into the Lendwise data model. No database migration, no pipeline changes.

**The full guide lives at [`src/lib/protocols/README.md`](src/lib/protocols/README.md)** —
architecture, the `YieldAdapter` contract, conventions, and war stories. The short version:

1. **Create `src/lib/protocols/{name}/{version}/`** with an `index.ts` exporting an adapter
   built with `defineYieldAdapter()`:

   ```ts
   export const adapter = defineYieldAdapter({
     id: 'acme_v2',
     name: 'Acme v2',
     provider: 'acme',
     version: 'v2',
     chains: { 1: { slug: CHAIN_SLUG_MAP[1] } },
     getProducts: fetchAcmeProducts, // full market catalogue
     getApySpot: fetchAcmeApySpot, // one rate snapshot per product
     // getApyHistory: optional — reconcile falls back to donor hours without it
   })
   ```

2. **Register it** in both registries (the compiler enforces they move together):
   - `src/config/protocols-meta.ts` — client-safe display metadata
   - `src/config/protocols-server.ts` — server-only dynamic import

3. **Prove it** with the live test harness:

   ```bash
   pnpm adapter:test acme_v2
   ```

   It runs `getProducts` + `getApySpot` for real, validates every payload against the strict
   schema, checks the two calls enumerate the same productId set, and prints a
   human-review summary (markets per chain, APY min/median/max, TVL). **Paste that summary
   in your PR** — it's how we review adapters.

Look at [`src/lib/protocols/morpho/v1/`](src/lib/protocols/morpho/v1/) for a complete
reference implementation.

## Your first PR in 15 minutes

Good entry points that don't require understanding the whole pipeline:

- **Token icons** — add an SVG to `public/icons/native/{SYMBOL}.svg` for an asset currently
  falling back to CoinGecko.
- **Docs** — fix a typo, clarify a setup step, improve an explanation in `docs/`.
- **Issues labeled** [`good first issue`](https://github.com/lendwise-fi/lendwise/labels/good%20first%20issue).

## Pull request process

1. Fork, create a branch from `main`.
2. Commit using [Conventional Commits](https://www.conventionalcommits.org/) style
   (`fix:`, `feat:`, `chore:`, ...) — that's what the history uses.
3. Make sure the [quality bar](#quality-bar) passes locally.
4. Open a PR — the template will walk you through the checklist. CI must be green.

Small, focused PRs get reviewed fast. If you're planning something large, open an issue or
a Discussion first so we can align before you invest the time.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
