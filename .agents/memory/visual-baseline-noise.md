---
name: Visual baseline noise
description: How to interpret isolated one-pixel mismatches in the Worky visual audit
---

Exact pixel comparisons can occasionally report a single-pixel delta in different screenshots across consecutive runs, even when the UI has not changed. Capture-time animation state must be controlled at the screenshot boundary rather than tuned with a longer arbitrary sleep.

**Why:** Headless browser rendering can vary minimally between captures, and an in-progress entry animation can make a stable UI look different. A fixed delay can still race delayed or infinite animations.

**How to apply:** Prefer reduced motion plus Playwright's disabled-animation screenshot mode, after fonts and two render frames settle. Keep exact pixel comparison and rerun before updating baselines; do not hide real changes with a broad tolerance.

In this workspace, Chromium can vary by a small number of anti-aliased pixels in text and rounded container edges even after those controls. A narrowly bounded exception (at most 16 pixels and channel delta three) is acceptable only after repeated runs confirm the mismatch is rasterization noise; larger or stronger changes must still fail.