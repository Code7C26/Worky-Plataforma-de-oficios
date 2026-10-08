---
name: Own profile identity
description: Avoid confusing a professional profile ID with its owner's user ID.
---

Public professional routes may accept either a profile ID or a user ID, so numeric identifiers can collide and return another person's profile. The current account's own profile must be resolved through the authenticated self endpoint first, then any public detail lookup should use the returned profile ID.

**Why:** A user's ID can equal another professional profile's ID; preferring the profile-ID lookup silently showed the wrong account.

**How to apply:** For account-owned views and edits, use the authenticated `me` profile response. Keep ambiguous public lookup compatibility only for existing links, or introduce explicit route names if the API is redesigned.