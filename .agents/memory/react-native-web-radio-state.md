---
name: React Native Web radio state
description: Radio accessibility state can require an explicit ARIA checked prop for correct web output.
---

For React Native radio controls, keep `accessibilityState={{ checked: ... }}` for native platforms and also provide `aria-checked` for web. Verify the rendered DOM when a radio's checked state matters; role and label rendering alone do not prove that the selected option is exposed.

**Why:** In the installed React Native Web renderer, a `Pressable` with `accessibilityRole="radio"` and `accessibilityState.checked` rendered with the radio role but without `aria-checked`. Adding `aria-checked` produced the expected output.

**How to apply:** When using radio roles in shared Expo components, inspect server-rendered web markup or browser accessibility output and retain native `accessibilityState` for Android/iOS.