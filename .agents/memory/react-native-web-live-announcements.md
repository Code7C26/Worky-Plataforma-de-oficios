---
name: React Native Web live announcements
description: Browser-level verification of accessible announcement markup and server-confirmed UI timing.
---

For React Native Web accessibility, assert the rendered DOM and timing in a real browser rather than relying only on unit tests. Hold mutation responses so pending UI can be distinguished from confirmed success, and mock any newly enabled role-specific queries with data shapes their screens consume.

**Why:** Accessibility props are translated by the platform renderer, and changing roles can activate other screens and queries before the local status message updates.

**How to apply:** For web live-region or role-switch tests, exercise the actual route, delay the server response, and check role, `aria-live`, exact copy, focus identity, and failure behavior.