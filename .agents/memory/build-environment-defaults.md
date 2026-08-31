---
name: Build environment defaults
description: Artifact service environment variables are not injected into recursive root builds.
---

When a Vite artifact requires PORT or BASE_PATH, keep matching non-production defaults in its config alongside the service values.

**Why:** Managed artifact workflows inject these variables at runtime, but `pnpm -r run build` invokes package builds without service configuration.

**How to apply:** Preserve explicit environment overrides for runtime and publication, while using the artifact's declared port and base path as local build defaults.