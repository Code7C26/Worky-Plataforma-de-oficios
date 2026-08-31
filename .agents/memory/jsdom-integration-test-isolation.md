---
name: JSDOM integration test isolation
description: Isolation rule for React integration tests that replace browser globals.
---

When a React integration test swaps global window, document, and browser APIs, run that case in its own test process rather than sharing a module cache with another JSDOM instance.

**Why:** React and the testing library can retain references to the first DOM environment, causing later tests to render an empty body even when the same test passes in isolation.

**How to apply:** Put browser-global-heavy integration cases in separate test files and include each file in the package validation command.