---
name: Isolated API route test bundles
description: Preserve Pino worker paths in temporary esbuild bundles used for API route tests.
---

When an isolated esbuild test bundle imports API routes, keep `pino`, `pino-http`, and `thread-stream` external instead of bundling them.

**Why:** Bundling the logger can relocate the worker entry path into a temporary test directory, causing asynchronous missing-worker errors after every assertion has passed.

**How to apply:** Add these packages to the runner's external list whenever it bundles API route tests into a temporary directory.
