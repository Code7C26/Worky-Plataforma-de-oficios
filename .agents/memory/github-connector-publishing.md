---
name: GitHub connector publishing
description: GitHub API and Git remotes use separate authentication paths in this workspace.
---

The GitHub integration can authenticate API calls while the repository's HTTPS Git remote still rejects pushes. The connector may also reject some HTML uploads through its Cloudflare-protected proxy.

**Why:** Connecting GitHub in Replit does not automatically install credentials for shell Git, and proxy filtering can fail on otherwise valid repository content.

**How to apply:** Prefer the authenticated GitHub client for repository operations; verify each created blob before building a tree, throttle batches, and surface any files rejected by the proxy rather than silently changing them.

For Worky, GitHub `main` may have an independently initialized snapshot history rather than sharing ancestry with the local Replit `main`. Never force-push the local branch over the remote.

**Why:** Replacing a divergent remote branch would discard its existing commits and any remote-only files.

**How to apply:** Compare the GitHub tip with local history before publishing. If they diverge, add scoped commits whose parents descend from the current GitHub tip, preserve remote-only files, and update the branch only after verifying the uploaded blobs and trees.