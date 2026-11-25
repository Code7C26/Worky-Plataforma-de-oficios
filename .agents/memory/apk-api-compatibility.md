---
name: APK and published API compatibility
description: A healthy API is not proof that it supports the authentication contract bundled in an APK.
---

Before distributing an Android APK, verify that the published API exposes the authentication operations required by that bundle and that production has their supporting schema. A successful generic health check is insufficient.

**Why:** the APK and API can be built or published at different times; a healthy older API can return route-level 404 responses to the newer mobile client.

**How to apply:** safely probe the mobile login operations with invalid empty JSON before delivery, expecting application validation rather than HTML 404. Do not fall back to legacy password-only login to bypass new-device verification. Obtain explicit approval before production publication or schema changes.
