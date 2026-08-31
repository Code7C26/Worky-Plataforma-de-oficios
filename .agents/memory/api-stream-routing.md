---
name: API stream routing
description: Artifact routing rule for Worky's authenticated notification stream
---

Authenticated notification streams must be routed through the API artifact. Do not also list the stream path on the web artifact, because the more-specific web route can send it to Vite and return a 404 instead of reaching Express.

**Why:** The browser's polling endpoint continued to work while the SSE connection failed, making the problem look like a frontend notification issue.

**How to apply:** Keep API paths under the API service route prefix and reserve the web artifact's path list for frontend pages and assets; verify the stream with an authenticated browser request after routing changes.