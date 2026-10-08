---
name: Partner approval and publication
description: Worky separates identity-document approval, partner profile publication, and account-level suspension.
---

New Partner profiles must remain unpublished until an administrator approves the required verification documents and explicitly enables the profile. Public directory, detail, and reputation endpoints should require an active account, a verified profile, and profile enablement. Rejected or re-uploaded verification documents revoke verification and disable publication.

**Why:** The user asked for administrator review and explicit Partner enablement, while account signup is intentionally allowed before email verification. Using account suspension to hide a Partner would also disable the person's client role.

**How to apply:** Keep account status, document-review status, and Partner publication as independent controls. Do not auto-enable a profile merely because all documents were approved.
