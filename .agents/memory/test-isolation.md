---
name: Test isolation for audit histories
description: Integration tests using audit rows must remain safe to rerun after an interrupted cleanup.
---

Audit records can outlive the domain row they describe when a test fails during teardown, so integration tests that assert histories should isolate the newly created entity before exercising it and remove its audit rows during teardown.

**Why:** Audit rows may be intentionally retained without their original job, and reused identifiers can make a later test see stale history.

**How to apply:** When testing entity-scoped histories, clear only the relevant audit entity and identifier after creating the fresh fixture, then clean audit rows before deleting referenced users.