---
name: Recognized-device login policy
description: User requirement for login challenges and restored sessions across Worky.
---

Ask for an email login code only on a new, unrecognized device, not on every visit or sign-in from a previously confirmed device. A valid restored admin session should open the admin panel without another login challenge.

**Why:** the user explicitly requested fewer repeated verification steps while retaining verification on new devices.

**How to apply:** keep remembered-device proof across logout and distinguish recurring login challenges from the one-time admin activation requirement. An authenticated client session alone is not proof of an admin role.
