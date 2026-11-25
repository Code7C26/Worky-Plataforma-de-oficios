---
name: Email verification after signup
description: Worky requires email confirmation before issuing a session or granting protected access.
---

An account record may be created before email confirmation, but do not issue a session or allow protected API access until the current email is verified. Send registration, account-verification, and password-recovery messages through the connected Gmail sender. Keep verification routes available to unverified users and bind account-setting challenges to the account and its current email.

For mobile login, request an email code only the first time a Worky installation is used for that account. Persist an opaque installation ID, store only its server-side hash as trusted, and skip repeat codes for that same installation. Reinstalling or clearing app data creates a new installation and requires verification again. This does not replace signup email verification.

**Why:** The user explicitly chose Gmail instead of requiring a DNS-managed Resend sender, requires confirmation before entering Worky, and later requested one-time mobile verification per new device rather than on every login.

**How to apply:** Signup sends a code but no session; login and protected APIs reject unverified accounts. Mobile device confirmation issues the first session for a new installation and remembers that installation. Keep codes, tokens, and credentials out of logs and persisted registration drafts.