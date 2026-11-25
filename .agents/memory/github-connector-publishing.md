---
name: GitHub connector publishing
description: GitHub API and Git remotes use separate authentication paths in this workspace.
---

The GitHub integration can authenticate API calls while the repository's HTTPS Git remote still rejects pushes. The connector may also reject some HTML uploads through its Cloudflare-protected proxy.

**Why:** Connecting GitHub in Replit does not automatically install credentials for shell Git, and proxy filtering can fail on otherwise valid repository content.

**How to apply:** Prefer the authenticated GitHub client for repository operations; verify each created blob before building a tree, throttle batches, and surface any files rejected by the proxy rather than silently changing them.

GitHub's `POST /git/trees` response may list only the new tree's top-level entries, even when nested file paths were included. It is not a complete recursive view of the created tree.

**Why:** A nested file can look missing in the create response even though the stored tree contains it.

**How to apply:** Before creating a commit, fetch the new tree with `GET /git/trees/{sha}?recursive=1` and verify every expected path and blob SHA against that result.

For Worky, GitHub `main` may have an independently initialized snapshot history rather than sharing ancestry with the local Replit `main`. Never force-push the local branch over the remote. When importing a merged PR, apply only that PR's first-parent changes and resolve conflicts file by file; do not replace whole local files or assume unrelated mail/auth flows are equivalent.

**Why:** Replacing a divergent remote branch would discard its existing commits and any remote-only files. A broad merge can also erase Replit-only features or change existing email transports while importing an unrelated PR.

**How to apply:** Compare the GitHub tip with local history before publishing. If they diverge, preserve the local working tree and remote-only files, resolve only the requested PR's changes, then verify the final diff and tests before publication. Update GitHub only after verifying uploaded blobs and trees.