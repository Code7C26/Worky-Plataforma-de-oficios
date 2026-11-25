---
name: Local Whisper memory limit
description: Choose a Whisper model that fits the workspace memory limit.
---

Local Whisper `large-v3` was killed by the runtime in the workspace's 8 GB memory limit after downloading the model. A subsequent `medium` download hit the separate 4 GB `/home/runner` overlay cache limit. For a short, clean synthetic Spanish voiceover, `small` is a practical local fallback.

**Why:** the model loads with additional inference memory beyond its file size, and large downloads share a limited tool-cache overlay.

**How to apply:** start with `small` for short, clear audio in this workspace; keep inference local and report any model substitution.
