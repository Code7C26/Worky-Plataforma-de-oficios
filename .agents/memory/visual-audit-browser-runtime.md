---
name: Visual audit browser runtime
description: Environment requirements for reproducible Playwright layout checks in this workspace
---

The visual audit runs Chromium headlessly and depends on Playwright plus explicit Nix graphics/audio libraries; keep those dependencies declared when moving or recreating the workspace.

**Why:** The workspace does not provide a browser runtime by default, and Chromium fails before tests begin when its shared libraries are absent.

**How to apply:** When adding or moving browser-based checks, use the project package declaration and `.replit` Nix package list as the reproducible source of runtime dependencies.

Playwright user-agent and viewport emulation renders React Native Web, not native iOS or Android chrome; it cannot validate real status bars, notches, or native safe-area insets.

**Why:** Browser screenshots can confirm responsive content geometry, but their platform labels do not activate the native OS layout code.

**How to apply:** Describe these checks as browser emulation and keep physical-device or native-simulator validation separate when status-bar and cutout behavior matters.

A standalone Android APK is useful for comparing a failure with Expo Go, but it
does not provide evidence about native iOS status bars or safe areas.

**Why:** The operating system and native host both change in that comparison;
successful Android behavior cannot establish whether an iOS issue is fixed.

**How to apply:** Record standalone Android results separately and keep native
iOS verification explicitly unconfirmed until evidence from iOS is available.