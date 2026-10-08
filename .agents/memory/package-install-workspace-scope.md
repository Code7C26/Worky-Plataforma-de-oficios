---
name: Workspace-scoped package installs
description: Avoid adding dependencies to the wrong package in the pnpm monorepo
---

The package-install integration runs `pnpm add` at the workspace root and may reject package additions with `ERR_PNPM_ADDING_TO_ROOT`; it does not provide a workspace filter.

**Why:** A dependency needed by one artifact should not become a root dependency or alter unrelated packages.

**How to apply:** Before adding a package, check whether it is already available through an existing workspace dependency. If it must be added, use a package-scoped installation path rather than retrying the root install or silently moving the dependency to the root.