---
name: Inverted chat list layout
description: React Native inverted FlatList rendering without manual orientation transforms
---

Use the inverted FlatList's built-in visual inversion and keep message rows and empty-state content untransformed. For Worky's chat, keep the message array reverse-ordered with `inverted` so the newest messages stay by the composer.

**Why:** Adding `scaleY: -1` to each rendered row or the empty-state container flips text upside down on top of the list's own inversion.

**How to apply:** When adjusting chat ordering or empty-state placement, preserve `FlatList`'s inversion semantics and verify that message text remains upright and the latest message sits nearest the composer.