---
name: Visual regression route mocks
description: Route-specific response shapes required by Worky’s visual audit mocks.
---

The visual regression mock must distinguish detail endpoints from collection endpoints before matching the broader collection path.

**Why:** A profile detail route can contain the same collection segment as the list route; matching the list first returns the wrong JSON shape and causes runtime errors during the audit.

**How to apply:** When adding or changing a mocked API route, match the most specific path and expected response shape first, then add the generic collection fallback.