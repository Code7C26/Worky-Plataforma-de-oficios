---
name: Artifact configuration validation
description: Workspace validation scripts run with the filtered package as their working directory.
---
Scripts invoked through `pnpm --filter <package> exec` must resolve workspace-relative files from the script location or an explicit workspace root, not from the current working directory.

**Why:** Filtered pnpm commands execute inside the selected package, while the files being checked may live elsewhere in the monorepo.

**How to apply:** Derive the repository root from the script module location before reading cross-package configuration files.