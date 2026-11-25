---
name: React Native Web selection state
description: Selected and checked states may need explicit ARIA props for correct web output.
---

For React Native Web controls with selection semantics, keep `accessibilityState` for native platforms and also provide the matching explicit ARIA state (`aria-checked` for radio roles, `aria-selected` for tab roles). Verify the rendered DOM; role and label rendering alone do not prove that selected state is exposed.

**Why:** In the installed React Native Web renderer, `Pressable` role/state combinations rendered the role and label but omitted the selected or checked ARIA attribute.

**How to apply:** When using radio or tab roles in shared Expo components, inspect browser accessibility output and retain native `accessibilityState` for Android/iOS alongside explicit ARIA state for web.