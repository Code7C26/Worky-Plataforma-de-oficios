---
name: Workspace package installs
description: Installing dependencies in artifact packages inside the pnpm monorepo.
---

**Rule:** Add dependencies to their artifact package with a workspace filter, such as `pnpm --filter @workspace/<slug> add ...`, rather than running an unscoped add from the workspace root.

**Why:** The managed language-package installer ran `pnpm add` at the workspace root and pnpm rejected the implicit root change with `ERR_PNPM_ADDING_TO_ROOT`; a filtered add succeeded.

**How to apply:** If managed package installation fails because it targeted the root, scope the package-manager command to the existing artifact package, then verify its manifest and lockfile and restart the relevant workflow.