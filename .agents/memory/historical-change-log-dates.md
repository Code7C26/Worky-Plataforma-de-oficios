---
name: Historical change-log dates
description: Rules for documenting older Worky changes when Git is the only available evidence.
---

When reconstructing the history, label a timestamp from Git as the commit date, not the date work was performed. Group related commits into readable tasks and cite the commit hashes. State the timezone and convert dates at day boundaries before grouping records. If the initial commit is only a workspace scaffold, do not use it to date application features.

**Why:** A commit can be created after the work itself and does not prove when implementation or validation happened.

**How to apply:** Use commit metadata as evidence for historical records; record a completion date only when a separate source confirms it.
