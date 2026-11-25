---
name: Location privacy and distance
description: Worky's fixed professional workshop address, private coordinates, and one-shot client location rules.
---

Professionals have a fixed workshop/base location captured during professional setup or profile updates. The exact street address, city, and province are public on the professional profile, as explicitly chosen by the user; the precise map coordinates remain private and are used only to calculate approximate client-to-workshop distance. Do not continuously track professionals.

Clients may grant one-time foreground location access while searching. Send those live coordinates only with the search request to calculate distance; do not persist them to the account or expose them to professionals.

**Why:** The user wants customers to see the distance to a professional's fixed place of work, while protecting precise map coordinates and avoiding persistent tracking.

**How to apply:** Require the fixed address when creating/updating a professional profile, validate coordinate bounds server-side, strip precise coordinates from API responses, and keep client location ephemeral.