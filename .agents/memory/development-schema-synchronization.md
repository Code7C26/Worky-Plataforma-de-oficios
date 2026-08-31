---
name: Development schema synchronization
description: Environment constraint when validating API changes that depend on recently added database tables.
---

Generated database declarations and the development database can lag behind the current Drizzle schema independently.

**Why:** API typechecks may resolve stale package declarations, while integration tests may fail with a missing relation even though the source schema already defines it.

**How to apply:** When a validation failure mentions a missing exported table or relation, refresh the library declarations and synchronize the development schema before diagnosing the feature under test.