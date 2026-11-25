---
name: Android ARM emulator limits
description: The bundled Android QEMU emulator cannot run ARM64 guest images on this x86_64 workspace.
---

The Android emulator available in this workspace rejects ARM64 system images on
the x86_64 host, even with acceleration disabled. A built APK and installed
system image do not enable cross-architecture boot.

**Why:** An attempt to boot an ARM64 Android 15 image exited before startup with
the emulator's explicit unsupported-host-architecture error.

**How to apply:** Check `uname -m` and the emulator startup output before
installing large ARM system images. Use a real Android device or an ARM host to
test ARM APK startup; do not substitute an x86 APK when the requirement concerns
the ARM-targeted release.
