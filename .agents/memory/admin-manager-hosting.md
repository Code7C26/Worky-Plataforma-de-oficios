---
name: Admin manager hosting
description: Hosting boundary for Worky's administrative console.
---

The user decided the Worky administration console should live in the existing marketplace web app at `/admin`, not in a separate Replit project or domain.

**Why:** The user changed the earlier hosting decision and explicitly said they no longer want a separate Admin site/domain.

**How to apply:** Keep Admin UI and navigation in the Worky marketplace artifact. Preserve `/admin` access control and server-side admin authorization; do not create a separate Admin artifact or domain unless the user changes this decision again.

The Admin console should appear as its own full-page workspace with only its own navigation, not nested inside the marketplace sidebar and header.

**Why:** The user explicitly chose the standalone console presentation over the duplicated navigation shown in their comparison screenshots.

On marketplace routes, administrative permission must not become a marketplace view: show Client or Professional and omit administration navigation and role labels. An administrator with a professional profile can select either marketplace view without losing server-side admin permission.

**Why:** The user explicitly wants ordinary Worky usage on `/home`, reserving the administrative experience for direct `/admin` access.

**How to apply:** Separate the selected marketplace view from the server account's authorization role; never demote or overwrite an admin account just to change its visible marketplace mode.
