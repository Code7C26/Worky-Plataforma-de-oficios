---
name: Password visibility policy
description: Worky rules for showing and hiding entered passwords.
---

Show/hide controls belong on ordinary password-entry forms such as sign-in, registration, admin access, and password confirmation for a separate account change.

**Why:** The user requested a visibility option in password fields while explicitly excluding the password-change area.

**How to apply:** Keep password-change and password-reset forms masked in web and mobile settings/auth flows unless the user changes this rule. Do not change authentication, validation, or submission behavior when adding the eye control.
