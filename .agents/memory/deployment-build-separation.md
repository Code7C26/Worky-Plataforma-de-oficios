---
name: Deployment build separation
description: Why Worky publication preparation is separate from the full validation workflow
---

The publication pre-build should prepare generated clients and validate artifact configuration, while the artifact production builds compile the web and API outputs. It should not run visual regression or other browser-based validation.

**Why:** Visual baselines can intentionally fail when the interface changes or when references are stale; coupling them to publishing prevents a valid production build from being released.

**How to apply:** Keep browser and visual checks in the validation workflow, and use a focused root publication-preparation command before the artifact-specific production builds.