---
name: Email verification after signup
description: Worky account creation skips email confirmation; users can verify their address later in account settings.
---

Create the account and session without requiring email verification, and leave `emailVerifiedAt` unset. Email verification remains available to an authenticated user from account settings, scoped to that account and its current email.

**Why:** Worky should let users create accounts even when email delivery or sender-domain verification is unavailable, while preserving a later way to confirm the contact address.

**How to apply:** Keep code request and confirmation in authenticated settings; bind challenges to the user ID and current email, and do not make signup or login depend on successful email delivery.