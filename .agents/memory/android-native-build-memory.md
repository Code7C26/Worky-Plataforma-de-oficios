---
name: Android native build memory
description: Gradle daemon memory flags must be system properties, not project properties.
---

Use `-Dorg.gradle.jvmargs` for Gradle daemon memory settings, not
`-Porg.gradle.jvmargs`. Project-property syntax can be silently ignored while the
rest of a native build proceeds normally.

**Why:** In a memory-constrained workspace, an unexpectedly large Java daemon
competes with Metro and native C++ compilers. A command accepting the flag is not
proof that the requested heap or metaspace limit took effect.

**How to apply:** Use bounded workers and inspect the actual daemon JVM options
when diagnosing native build memory pressure. If temporarily pausing the mobile
preview to free memory, restore its managed workflow after the build.

On a clean native build, stop the mobile preview temporarily and reduce the
Gradle heap if the daemon disappears with an increased cgroup OOM-kill count.

**Why:** the configured 1536 MB heap plus Metro and native compilation can exceed
the workspace's available memory even when Gradle uses one worker.

**How to apply:** reuse the partial build cache, try a 1024 MB heap and 512 MB
metaspace, and restore the managed preview after finishing. Confirm OOM evidence
instead of assuming every daemon crash is a memory problem.

Resolve Android platform package names from `sdkmanager --list` instead of
assuming that the numeric compile SDK is the package suffix.

**Why:** the repository exposes API 37 as `platforms;android-37.0`, not
`platforms;android-37`; requesting the latter fails before installation.

**How to apply:** check available platform and build-tool identifiers before
preparing a clean build environment. Keep SDKs and build caches in ignored
generated output directories, not in version control.

In this workspace, `installSystemDependencies` does not index the `androidenv`
SDK packages. A minimal SDK manager can be composed from the pinned Nixpkgs
Android environment, then used to install the exact platform, build tools, NDK,
and CMake into `generated-artifacts/android-sdk`.

**Why:** the package installer rejects those Android Nix attributes, while the
APK build still needs current Google packages beyond Nixpkgs' pinned platform
list.

**How to apply:** use Nix only to obtain `sdkmanager`, accept Google's SDK
license only after the user authorizes it, and keep the downloaded SDK under
the ignored generated-artifacts directory.

Run Android APK builds as background jobs when they may need a clean Gradle or
native compilation; the foreground shell limit can terminate a build after five
minutes before it produces the APK.

**Why:** the first build after native changes can spend several minutes compiling
Gradle plugins and C++ libraries, and the foreground tool timeout kills that work.

**How to apply:** start the APK build in the background, monitor for failure or
completion, then verify the APK timestamp, signature, and required native bundle
before delivering it.
