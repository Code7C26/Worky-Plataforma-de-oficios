# Isolated admin-signup route tests

Run `pnpm --filter @workspace/api-server run test:admin-signup` for both helper and route tests,
or `pnpm --filter @workspace/api-server run test:admin-signup:routes` for routes only.
Run `pnpm --filter @workspace/api-server run test:admin-signup:typecheck` to also
type-check the test harness, since the normal API typecheck includes only application source.

The runner bundles the **real Express routes, Zod contracts, bcrypt, JWT and Drizzle schema**.
Only the database entrypoint, email delivery and unrelated side-effect helpers are replaced.
PGlite runs PostgreSQL in memory, with no database URL, disk persistence, external database
connection or real mail delivery. The child process receives only fixed test credentials.
Triggers inject account, audit and code-consumption write failures to verify real rollback.
No server/application workflow or published database is involved.

Each test resets the three relevant tables and uses a separate reserved test IP while
retaining the real rate-limit middleware. The SQL logger also verifies that both simultaneous
requests issue `FOR UPDATE` against the code. Successful responses are checked against
persisted rows and signed session tokens, not merely status codes.

## Concurrency boundary

PGlite serializes transactions on one embedded connection. The concurrent HTTP tests prove
single consumption and that the route requests the PostgreSQL row locks; they **do not**
prove lock contention, deadlocks or isolation across independent production PostgreSQL
connections. A separate disposable multi-connection PostgreSQL test is needed for that
additional assurance. Never run these tests against a published database.

The small SQL fixture mirrors only the users, admin-signup codes and audit tables needed
here. If those schemas change, update the fixture with them.
