---
name: Live location privacy
description: Durable decisions for continuously tracking professional locations without exposing exact coordinates.
---

Use browser geolocation only for an authenticated professional with a professional profile. Combine `watchPosition` with a low-frequency heartbeat because browsers may not emit a new position when the person is stationary. Pause the watcher while offline and clean it up on session or component teardown.

**Why:** Public professional responses must never expose exact coordinates; the server needs the private coordinates only to calculate approximate distance. A timestamped heartbeat also makes stale-location handling possible later.

**How to apply:** Keep location updates behind an authenticated endpoint, validate longitude/latitude bounds server-side, and preserve non-coordinate profile location fields when updating the JSON location object.