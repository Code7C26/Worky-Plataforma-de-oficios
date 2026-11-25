---
name: React type isolation
description: Preventing web TypeScript conflicts when Expo and web use different React declaration versions.
---

Keep each frontend's TypeScript resolution of React declarations local to that frontend when the web and Expo applications use different React versions.

**Why:** An Expo SDK upgrade can change the React declaration version selected for transitive UI packages. Vite runtime deduplication does not affect TypeScript; incompatible unique-symbol types in React refs can then fail the web check even though the web runtime is unchanged.

**How to apply:** After a mobile SDK upgrade, also check web types. If declarations diverge, isolate React type resolution in the affected frontend's compiler configuration rather than changing component props or upgrading unrelated app runtimes.
