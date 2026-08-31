---
name: API contract validation
description: Compatibility note for this workspace's generated Zod validators.
---
The installed generated Zod runtime is not compatible with OpenAPI integer output (`z.int()`); numeric identifiers and counters must use OpenAPI `number` until the workspace upgrades its Zod/codegen combination.

**Why:** Code generation succeeds, but the workspace library typecheck fails when generated schemas call an unavailable `z.int()` method.

**How to apply:** When adding or editing numeric fields in the OpenAPI contract, prefer `number` and rerun codegen plus `pnpm run typecheck:libs`.