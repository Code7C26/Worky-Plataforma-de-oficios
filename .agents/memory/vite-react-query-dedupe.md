---
name: Vite React Query deduplication
description: Diagnose a missing QueryClient error when Vite bundles a pnpm workspace app and a generated React Query client.
---

When an app renders `QueryClientProvider` but production hooks throw `No QueryClient set`, check for duplicate `@tanstack/react-query` resolutions across the app and workspace client package. Different React peer contexts can create separate QueryClient context singletons even at the same React Query version. Add `@tanstack/react-query` to Vite's `resolve.dedupe` alongside React and React DOM, then verify the production build in a browser.

**Why:** In this workspace, the app and generated API client resolved React Query with different React peer versions, so the provider and hooks used different contexts. Development appeared healthy, while the published bundle crashed at startup.

**How to apply:** Use this when the QueryClient provider is visibly above the affected route and React Query hooks still report no provider. Confirm package resolution paths first; then deduplicate and test the built bundle, not only the Vite dev server.
