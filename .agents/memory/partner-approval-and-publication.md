---
name: Partner approval and publication
description: Worky separates identity-document approval, partner profile publication, and account-level suspension.
---

The professional signup flow is: create an account → verify the email → wait for an administrator to review the uploaded documents and enable the professional profile. A pending professional must not appear publicly, receive direct hiring requests, or accept jobs. Rejected or re-uploaded verification documents require renewed review and revoke publication.

**Why:** The user explicitly requires email verification and administrator-reviewed documentation before professional activity. Pending professional approval must not suspend the account's client role.

**How to apply:** Keep account status, document-review status, and Partner publication as independent controls. Do not auto-enable a profile merely because all documents were approved.

A professional licence (matrícula) attachment is optional according to the trade. If submitted, it requires administrative approval alongside the mandatory front/back DNI and criminal-record documents before final enablement.

**Why:** The user explicitly chose optional matrícula rather than requiring it from every Partner.

**How to apply:** Missing matrícula alone must not block a non-licensed trade; a pending or rejected attached matrícula must block enablement. Keep approved files visible with the applicant until the final administrative decision.

Do not ask for a second upload of documents already saved during signup. The pending screen should request only missing or rejected files; received files are status-only while awaiting the final administrator enablement. Existing pending profiles must not gain professional functionality through an editing-route exception.

**Why:** The user reiterated that documents are supplied during registration and that having uploaded them does not authorize professional use.

**How to apply:** Use persisted document records, refresh them after signup setup, keep missing-profile onboarding available, and gate professional operations in both the web and API until enabled. Client mode remains usable.
