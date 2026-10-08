---
name: Role-scoped conversations
description: Product boundary between shared notifications and role-specific chat inboxes
---

Worky keeps notifications shared at the account level, while the conversation inbox is scoped to the active role: client conversations show jobs where the account is the client, and professional conversations show jobs where it is the professional. Client and Partner are modes of one account, not separate identities; switching must preserve the Partner profile and its history.

**Why:** The same account can switch between hiring and offering services without fragmenting its professional reputation or losing work. Mixing both chat contexts makes the inbox ambiguous, while notifications should remain a single account-wide stream.

**How to apply:** Change only the active role; preserve the existing professional profile and associated records. When switching to Partner, route the user to complete or review that profile. Preserve the role filter when changing conversation-list queries or cache keys. Do not apply it to `/notificaciones`; that feed remains shared.