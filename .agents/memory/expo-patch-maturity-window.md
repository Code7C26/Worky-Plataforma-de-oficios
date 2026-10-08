---
name: Expo patch maturity window
description: Handling Expo SDK patch versions that are too newly published for the workspace package registry.
---

**Rule:** When Expo recommends patch versions that the registry refuses under its minimum-release-age policy, do not bypass that protection. Keep the installed lockfile, fix independent config and code issues, and retry the official Expo version fix after the releases mature.

**Why:** `expo install --fix` delegates to the workspace package manager, which may intentionally block a version Expo has just published. Forcing an alternate registry or excluding the age policy would bypass the environment's dependency protection.

**How to apply:** If `expo-doctor` reports only new patch mismatches and installation fails on release age, record the remaining mismatch and recheck before native publishing.