---
name: PNG visual comparison formats
description: Playwright screenshots in this workspace may be RGB PNGs rather than RGBA
---

Visual regression tooling must support both RGB and RGBA 8-bit PNG screenshots, including PNG row filters, instead of assuming a four-byte pixel format.

**Why:** Chromium's screenshot encoder can emit RGB PNGs, so an RGBA-only comparator reports every baseline as unreadable.

**How to apply:** When changing the visual comparator or browser version, keep decoding and diff generation format-independent for RGB/RGBA PNGs.