---
name: Expo patch maturity window
description: Handling Expo SDK patch versions that are too newly published for the workspace package registry.
---

**Rule:** When Expo recommends patch versions that the registry refuses under its minimum-release-age policy, do not bypass that protection. For an SDK migration, the stable installed Expo package's official bundled compatibility map can provide a mature baseline via `EXPO_OFFLINE=1 pnpm exec expo install --fix`; pnpm must still enforce its release-age policy. If that baseline is unavailable, preserve the known-good lockfile.

**Why:** Expo's online compatibility recommendations can advance to newly published patches before the workspace permits them. The installed stable SDK also ships an official compatibility map that can align native modules without bypassing package protection.

**How to apply:** Run online diagnostics after installing any bundled baseline, disclose their remaining warnings rather than claiming a clean doctor result, and retry the online fix after releases mature. Do not add age exclusions or use an alternate registry.