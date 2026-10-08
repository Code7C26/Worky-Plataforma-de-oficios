---
name: Admin manager hosting
description: Hosting boundary for Worky's administrative console.
---

The user chose to host the Worky management system in a separate Replit project with its own domain, not as an artifact or route in the marketplace project. The new console should consume the existing Worky API rather than duplicate marketplace data or its database.

**Why:** Replit publishes all artifacts in one project under the same domain and publishing lifecycle; the user confirmed an independent Repl after learning this limitation.

**How to apply:** Build the console only after the destination Repl is open as the active workspace. Configure its frontend to use the published Worky API, and verify that authentication, CORS, and admin-only authorization work across the two origins.
