---
name: Subagent follow-up authority
description: How to continue design work when a worker's connector authority differs from the current environment.
---

When `sendFollowup` reports that a subagent has different connector authority, do not retry the same follow-up repeatedly. Start a new specialized subagent with the original artifact context, current files, and the user's latest instruction.

**Why:** Design workers can be created under a connector authority that the parent cannot reuse; repeated follow-up attempts fail without progressing the work.

**How to apply:** Use a fresh worker name and pass the approved source files and relevant skills whenever the follow-up callback returns a connector-authority error.
