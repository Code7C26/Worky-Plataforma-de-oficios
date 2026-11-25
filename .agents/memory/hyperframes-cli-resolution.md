---
name: HyperFrames CLI resolution
description: Avoid npm executable lookup conflicts in generated HyperFrames projects.
---

In a generated HyperFrames project directory, the project package itself is named `hyperframes` but does not expose the CLI binary. Running unqualified `npx hyperframes ...` there can fail with “could not determine executable to run.”

**Why:** npm can resolve the local project package before the registry CLI package.

**How to apply:** use the scaffold's version-qualified command (`npx --yes hyperframes@<version> ...`) inside the project, or run the CLI from the workspace root and pass the project directory explicitly.
