---
name: Mobile APK delivery
description: Worky mobile changes should be accompanied by a current Android APK for the user.
---

When a user requests a change to Worky Móvil, include a newly built Android APK with the delivery whenever the build environment permits. Default to a test APK pointed at the development API/database; deliver production only when explicitly requested.

Expo Go is a live development preview opened with its QR code; it does not generate an installable APK. Keep the two delivery paths distinct: use the Expo Go QR for the live preview and a standalone test-signed APK for installation.

**Why:** The user explicitly requested an installable APK for every mobile-app change, not just a development preview. Gradle can also reuse a React Native bundle when `EXPO_PUBLIC_DOMAIN` changes, producing a valid APK that still calls the previous environment.

**How to apply:** After implementing and validating a mobile change, use the repository's Android APK build script with the development API origin and present the resulting test APK. Explain that it is test-signed and uses development data; report blockers plainly rather than implying the preview is installable. When building against different API origins, force a fresh JavaScript bundle and verify the expected host is embedded before presenting it.

## APK updates and size

A sideloaded APK update still downloads the whole package. Android can install it over the existing app and retain app data when the package ID and signing key match and the version code increases, but the user must confirm installation. Offer an ARM64-only APK for modern Android phones and retain a universal ARM32/ARM64 APK as a compatibility fallback; do not promise incremental patches or silent updates through a downloaded APK.

**Why:** A universal APK includes native libraries for multiple processor types, increasing download and installation size. ARM64-only reduces the package for most current phones but cannot run on 32-bit-only devices.

**How to apply:** Generate both variants with the same package ID, signing key, and version code. Label ARM64 as the faster option and universal as the fallback; if the device rejects ARM64, install the universal build instead.
