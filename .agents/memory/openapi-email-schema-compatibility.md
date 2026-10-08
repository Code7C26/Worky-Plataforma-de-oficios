---
name: OpenAPI format compatibility
description: Compatibility rule for formatted fields in generated OpenAPI-to-Zod contracts in this workspace.
---

Avoid OpenAPI `format: email` and `format: uri` when code-generating contracts in this workspace: the generator emits Zod 4-only helpers such as `z.email()` and `z.url()`, while the installed runtime is Zod 3. Keep these fields as strings and validate incoming values explicitly where the API needs to enforce a format.

**Why:** The current generated runtime uses Zod 3, while the generator emits Zod 4 methods for these OpenAPI formats; codegen then produces a typecheck failure.

**How to apply:** Use `type: string` (and a length bound when appropriate) in OpenAPI. Validate email input with the project's email check at the API boundary; omit URI format for server-issued URLs unless the generated runtime supports it.