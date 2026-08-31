---
name: Profile photo cleanup races
description: Concurrency rule for reclaiming abandoned profile photo objects.
---

Profile photo cleanup must lock the owning account before claiming an upload row, then compare the row's object path with the account's current photo inside the same transaction.

**Why:** A save can publish a prepared variant while a grace-period worker is claiming it; checking only the upload status can delete the photo that the account is about to use.

**How to apply:** Keep profile-photo cleanup isolated from chat and other storage lifecycles, and perform the final object deletion only after the row is claimed and the current account reference has been checked.