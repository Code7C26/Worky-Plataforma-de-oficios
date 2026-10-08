---
name: Production email sender
description: Resend test-domain restrictions and privacy-safe diagnosis of verification delivery failures.
---

Resend's default resend.dev sender is test-only and can deliver only to the email associated with the Resend account. Sending verification codes to other users requires a sender on a domain verified in Resend.

**Why:** Worky's production verification requests returned generic 503 responses while the sender setting was absent. Resend's documented test-domain restriction makes that fallback unsuitable for public registration, even when the API credential exists.

**How to apply:** Check the production sender configuration before treating verification delivery as functional. Keep provider status and fixed failure categories in diagnostics, not raw provider bodies, recipient addresses, codes, or credentials. Mocked delivery tests validate the flow but do not prove real email delivery.
