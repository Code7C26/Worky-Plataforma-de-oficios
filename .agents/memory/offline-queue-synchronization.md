---
name: Offline queue synchronization
description: Reliability rules for appointment-attempt retries after network recovery
---

Offline appointment-attempt synchronization must be serialized per conversation. A mount-triggered sync and an `online` event can happen together, so both must share one in-flight operation rather than independently reading and posting the same queue.

**Why:** Replaying the same local attempt twice creates duplicate history records, while removing it before the server response can lose the user's action.

**How to apply:** Keep each pending attempt until its POST resolves successfully, then remove it; preserve it when the request fails so a later retry can run again.