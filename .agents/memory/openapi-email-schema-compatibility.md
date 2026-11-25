---
name: OpenAPI format compatibility
description: Compatibility rule for formatted fields in generated OpenAPI-to-Zod contracts in this workspace.
---

Avoid OpenAPI `format: email`, `format: uri`, and `format: uuid` when code-generating contracts in this workspace: the generator emits Zod 4-only helpers such as `z.email()`, `z.url()`, and `z.uuid()`, while the installed runtime is Zod 3. Keep these fields as strings with length bounds or patterns and validate incoming values explicitly where needed.

**Why:** The current generated runtime uses Zod 3, while the generator emits Zod 4 methods for these OpenAPI formats; codegen then produces a typecheck failure.

**How to apply:** Use `type: string` with a length bound or regex pattern in OpenAPI. Validate email, URL, and UUID values at the API boundary; omit unsupported formats unless the generated runtime supports them.