---
name: JSDOM integration test isolation
description: Isolation rule for React integration tests that replace browser globals.
---

When a React integration test swaps global window, document, and browser APIs, run that case in its own test process rather than sharing a module cache with another JSDOM instance. For linked workspace hooks, direct tsx imports can bypass Vite's `resolve.dedupe` and load React Query with a different React peer than the renderer. Load the app through Vite SSR or test it in a real browser so the app's resolver remains active. Avoid `--preserve-symlinks` as a workaround; it can break pnpm's transitive package resolution.

**Why:** React and the testing library can retain references to the first DOM environment, causing later tests to render an empty body even when the same test passes in isolation. Separately, a React Query hook loaded with a different React peer from the renderer throws an invalid-hook error even when the JSDOM test already runs alone.

**How to apply:** Put browser-global-heavy integration cases in separate test files and include each file in package validation. For invalid-hook failures, compare renderer and hook resolution first; prefer Vite SSR or Playwright over changing DOM cleanup or package versions when the mismatch comes from linked workspace resolution. Avoid relying on global DOM constructors such as `Node` in these tests; use the JSDOM window's constructor or call `.contains()` with a type cast.