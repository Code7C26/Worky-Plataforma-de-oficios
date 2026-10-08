---
name: Account settings concurrency
description: How independent account forms and live location tracking avoid overwriting each other.
---

Treat account settings updates as partial field patches. Each independent form should submit only the fields it owns rather than resending an account snapshot.

**Why:** Personal details, postal address, and live location can be saved close together. Full-snapshot writes can silently restore stale names or emails, while read-spread-write updates to location JSON can lose either a new address or newer coordinates.

**How to apply:** Preserve omitted account fields. For shared JSON location data, atomically merge only the keys owned by the operation in PostgreSQL; postal settings own address/city/province, while live tracking owns coordinates/capture time.