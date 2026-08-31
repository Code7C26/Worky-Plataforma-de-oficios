---
name: Direct image upload validation
description: Security boundary for image files uploaded through signed object-storage URLs.
---

Signed upload URLs only authorize writing an object; the request that creates the URL cannot establish that the uploaded bytes match the client-declared MIME type.

**Why:** A client can label arbitrary content as an image, so trusting the declaration before associating or serving the object leaves invalid content in user-visible records.

**How to apply:** For image-only flows, fetch the uploaded object server-side and fully decode it with the image library immediately before association. Keep the existing size and ownership/path checks, and leave non-image document flows separate.