---
name: Production email sender
description: Worky verification and password-recovery emails use the connected Gmail account.
---

All Worky email-verification codes and password-recovery messages use the project-connected Gmail integration. The user confirmed the verification flow delivered and accepted a code in the Worky web preview. Password recovery is covered end-to-end by a Gmail-mocked API test, but live recovery delivery and production delivery have not been tested. Resend is no longer used for these flows.

**Why:** The user has no domain with editable DNS and explicitly asked to use connected Gmail for both verification and account recovery.

**How to apply:** Keep all Worky verification and recovery email on the connected Gmail API unless the user changes this choice. Do not treat the successful preview verification or mocked recovery test as proof of published delivery. Log only fixed failure categories and HTTP status; never log provider bodies, recipients, codes, reset links, or credentials.
