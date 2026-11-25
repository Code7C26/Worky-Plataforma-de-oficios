---
name: Primary admin delegation
description: Worky's rule for the primary administrator and delegated admin roles.
---

Only the configured primary Worky admin may grant or revoke admin roles. A delegated admin can manage platform resources but cannot manage the admin roster or remove the primary admin. The primary account must be activated through the email-code flow, and an existing account must provide its current password.

**Why:** the user chose owner-only delegation and required email ownership proof and current-password confirmation for existing accounts.

**How to apply:** enforce this policy in API handlers, not only in the Admin UI; keep the primary email in Replit Secrets rather than source files or repository configuration.
