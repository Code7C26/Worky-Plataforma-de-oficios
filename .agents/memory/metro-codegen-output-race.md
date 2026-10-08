---
name: Metro and generated API code
description: Avoid Metro resolution failures while Orval regenerates the shared React Query client.
---

Run OpenAPI codegen to completion before starting or restarting Metro. Orval cleans the generated client output directory before writing the new files, so a running bundler can observe the temporary gap and fail to resolve `generated/api`.

**Why:** During concurrent generation, Metro surfaced a missing-module compile error even though codegen later completed successfully; restarting Expo after generation restored iOS bundling.

**How to apply:** After OpenAPI edits, finish codegen and client build first, then restart the Expo workflow and reload Expo Go or the preview.