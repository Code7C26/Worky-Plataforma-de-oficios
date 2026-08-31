---
name: Profile photo delivery
description: How Worky serves profile photos displayed by browser image elements.
---

Profile photos displayed through an `<img>` element cannot rely on an Authorization Bearer header. They need a dedicated public read path that only serves object paths currently registered as user profile photos; private documents and uploads must remain behind authenticated routes.

**Why:** Browsers do not attach the app's API token to image `src` requests, which makes an otherwise valid private storage endpoint render fallback initials.

**How to apply:** Keep the public photo route narrowly scoped to `users.fotoObjectPath`, use a cacheable image response, and keep verification documents on the authenticated object route.