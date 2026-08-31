---
name: Object Storage provisioning
description: Environment requirement for Worky user uploads and signed URL generation.
---

App Storage must be provisioned through the workspace setup flow before the API server can generate signed upload URLs. Having the bucket-related environment variable names present is not enough; otherwise the GCS client can fail with missing default credentials.

**Why:** Registration created users successfully but failed while uploading profile and verification files when the storage service had not been provisioned for the runtime.

**How to apply:** When changing upload flows or restarting a fresh workspace, verify App Storage setup first, then restart the API server so its storage client receives the provisioned runtime configuration.