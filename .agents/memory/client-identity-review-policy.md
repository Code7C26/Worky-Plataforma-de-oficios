---
name: Client identity review policy
description: Worky's selected customer identity verification and retention rules.
---

Customer identity verification is optional and reviewed manually by an authorized Worky administrator. Collect only a DNI image and selfie; do not send them to an external identity provider or use automated face matching. Customers keep normal access while pending or rejected, and may resubmit after rejection. Only approved clients receive a verification seal in professional-facing views. Delete the submitted images when the decision is resolved.

**Why:** The user explicitly chose manual review instead of a provider, requested deletion after the case is resolved, and wants verified customers to be visibly more trustworthy to professionals without restricting unverified customers.

**How to apply:** Keep the process optional, private, and server-authorized. Never expose identity images, document numbers, or private paths in public or worker-facing responses; preserve only the decision, review date, and necessary audit record after cleanup.
