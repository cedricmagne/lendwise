# PostHog post-wizard report

The wizard has completed a full PostHog integration for Lendwise. It installed `posthog-js` and `posthog-node`, initialized the client via `instrumentation-client.ts` (the recommended Next.js 15.3+ approach), added a reverse proxy in `next.config.ts` for EU ingestion, created a server-side client in `src/lib/posthog-server.ts`, and instrumented 13 events across 9 files covering wallet connection, optimizer usage, product exploration, and server-side API tracking. Users are identified by their wallet address (EVM or Stellar) at connection time.

| Event | Description | File |
|---|---|---|
| `wallet_connected` | User selects EVM or Stellar network family and initiates wallet connection | `src/components/wallet/NetworkFamilySelectorDialog.tsx` |
| `wallet_disconnected` | User disconnects their active wallet from the app | `src/components/user/UserMenu.tsx` |
| `currency_changed` | User changes the base display currency in the user menu | `src/components/user/UserMenu.tsx` |
| `supply_optimizer_run` | User runs the supply yield optimizer with a given strategy, horizon, and capital | `src/components/optimizer/SupplyingOptimizerButton.tsx` |
| `supply_optimizer_applied` | User accepts and applies the supply optimizer allocation result | `src/components/optimizer/SupplyingOptimizerButton.tsx` |
| `borrow_optimizer_run` | User runs the borrow optimizer with a selected mode, amount, and horizon | `src/components/optimizer/BorrowingOptimizerButton.tsx` |
| `borrow_optimizer_applied` | User accepts and applies the borrow optimizer allocation result | `src/components/optimizer/BorrowingOptimizerButton.tsx` |
| `product_details_viewed` | User opens the detail drawer for a specific supply or borrow market | `src/components/products/ProductDetailDrawer.tsx` |
| `supply_table_filter_applied` | User applies a protocol, network, or asset filter on the supply table | `src/components/products/SupplyTableClient.tsx` |
| `borrow_table_filter_applied` | User applies a protocol, network, or asset filter on the borrow table | `src/components/products/BorrowTableClient.tsx` |
| `landing_cta_clicked` | User clicks the "Get Started Free" CTA on the landing page | `src/components/landing/CTASection.tsx` |
| `optimizer_api_called` | Server-side: optimizer API proxy successfully forwarded a request | `src/app/api/optimizer/route.ts` |

User identification (`posthog.identify()`) is called in:
- `src/contexts/WalletWatcherContext.tsx` — EVM wallet connect (with ENS name if resolved)
- `src/contexts/StellarWalletContext.tsx` — Stellar wallet connect

## Next steps

We've built a dashboard and five insights in PostHog to monitor key user behavior:

- **Dashboard:** [Analytics basics (wizard)](https://eu.posthog.com/project/214004/dashboard/787512)
- [Wallet Connections](https://eu.posthog.com/project/214004/insights/UJDASOYv) — Daily unique users who connected a wallet
- [Optimizer Usage — Supply vs Borrow](https://eu.posthog.com/project/214004/insights/WouUCxF1) — Supply and borrow optimizer run trends
- [Supply Optimizer Conversion Funnel](https://eu.posthog.com/project/214004/insights/ZOjUxrWh) — Wallet connect → optimizer run → allocation applied
- [Product Details Viewed](https://eu.posthog.com/project/214004/insights/uxnMB1vh) — Market detail drawer open frequency
- [Table Filter Engagement](https://eu.posthog.com/project/214004/insights/C5Iy7Gx4) — Supply and borrow table filter usage

## Verify before merging

- [ ] Run a full production build (`pnpm build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` to `.env.example` and any bootstrap scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] Confirm the returning-visitor path also calls `identify` — currently `WalletWatcherContext` only identifies on `addWalletToStore` for new wallets. For wallets already in the store (returning users), you may want to call `posthog.identify()` in the `useEffect` that syncs the active wallet, so returning sessions are not left on anonymous distinct IDs.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
