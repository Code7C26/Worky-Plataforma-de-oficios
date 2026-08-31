---
name: Visual audit browser runtime
description: Environment requirements for reproducible Playwright layout checks in this workspace
---

The visual audit runs Chromium headlessly and depends on Playwright plus explicit Nix graphics/audio libraries; keep those dependencies declared when moving or recreating the workspace.

**Why:** The workspace does not provide a browser runtime by default, and Chromium fails before tests begin when its shared libraries are absent.

**How to apply:** When adding or moving browser-based checks, use the project package declaration and `.replit` Nix package list as the reproducible source of runtime dependencies.