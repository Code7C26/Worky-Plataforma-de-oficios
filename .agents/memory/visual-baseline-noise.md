---
name: Visual baseline noise
description: How to interpret isolated one-pixel mismatches in the Worky visual audit
---

Exact pixel comparisons can occasionally report a single-pixel delta in different screenshots across consecutive runs, even when the UI has not changed. Capture-time animation state must be controlled at the screenshot boundary rather than tuned with a longer arbitrary sleep.

**Why:** Headless browser rendering can vary minimally between captures, and an in-progress entry animation can make a stable UI look different. A fixed delay can still race delayed or infinite animations.

**How to apply:** Prefer reduced motion plus Playwright's disabled-animation screenshot mode, after fonts and two render frames settle. Keep exact pixel comparison and rerun before updating baselines; do not hide real changes with a broad tolerance.

In this workspace, Chromium can vary by a small number of anti-aliased pixels in text and rounded container edges even after those controls. A narrowly bounded exception (at most 16 pixels and channel delta three) is acceptable only after repeated runs confirm the mismatch is rasterization noise; larger or stronger changes must still fail.

Remote web fonts are not reliable dependencies for exact visual comparisons. `document.fonts.ready` can resolve after a remote font fails, leaving some captures in fallback typography while others use the intended font.

**Why:** Intermittent Google Fonts fetch failures changed text pixels across separate screenshots and looked like UI regressions even though the layouts were unchanged.

**How to apply:** Bundle the fonts required by a visual test and explicitly load/check them before capturing. Keep pixel comparisons exact rather than absorbing font fallback into looser thresholds.

Screenshot fixtures with relative timestamps must use a fixed browser clock that matches the baseline's reference day.

**Why:** A fixture that renders as a same-day time can become “Yesterday” after midnight, producing large, unrelated screenshot diffs.

**How to apply:** Freeze the browser date and timezone for visual tests that render relative dates; keep API fixture timestamps aligned with that fixed clock.