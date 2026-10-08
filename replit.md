# Worky — Plataforma de oficios

Marketplace que conecta clientes con profesionales de oficios para publicar, aceptar y coordinar changas.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run validate:worky` — regenerate the API client, rebuild its declarations, then typecheck and test Worky
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `WORKY_ADMIN_SIGNUP_ALLOWED_EMAILS` — comma-separated admin-signup allowlist; unset or empty disables the flow. Configure it in the API Repl without committing the addresses.
- Admin signup sends one-time codes directly through Gmail SMTP, never Resend. Configure `WORKY_ADMIN_GMAIL_USER` with the authorized Worky Gmail mailbox and `WORKY_ADMIN_GMAIL_APP_PASSWORD` as a Secret in the API Repl. Use a Google application password with two-step verification, never the normal mailbox password. Missing or invalid mail configuration refuses delivery; there is no fallback provider.
- This SMTP change is limited to admin signup. Existing account-email verification and password recovery keep their current transports. Signup stores only hashed codes in Worky's current PostgreSQL; apply its reviewed schema change through the API Repl, without creating another database.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, JWT (`jsonwebtoken`), bcrypt (`bcryptjs`) y rate limiting.
- DB: PostgreSQL administrado por Replit + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/worky/src/App.tsx` — experiencia web y flujos de cliente/profesional.
- `artifacts/api-server/src/routes/worky.ts` — API autenticada `/api/v1` de usuarios, profesionales, changas y mensajes.
- `artifacts/api-server/src/routes/legacy.ts` — compatibilidad temporal con los hooks del frontend actual.
- `artifacts/api-server/src/seed.ts` — usuarios profesionales y cliente de prueba.
- `lib/api-spec/openapi.yaml` — contrato fuente de los endpoints y tipos.

## Architecture decisions

- El MVP usa una API de dominio única con filtros por rol y estados explícitos de changa.
- El cliente invalida las consultas afectadas después de cada mutación para reflejar los cambios al navegar.
- El flujo de aceptación valida que un trabajo publicado no pueda ser aceptado dos veces.

## Product

Los clientes pueden registrarse, iniciar sesión, buscar profesionales, ver perfiles, publicar changas y conversar. Los profesionales pueden crear su perfil, revisar oportunidades filtradas por categoría, aceptar trabajos de forma atómica y responder mensajes.

## User preferences

La experiencia debe conservar la identidad cercana, confiable y ágil del mockup de Worky, con textos en español rioplatense.

## Gotchas

- Para preparar el backend: `pnpm --filter @workspace/db run push` y `pnpm --filter @workspace/api-server run seed`.
- `JWT_SECRET` debe estar en Secrets; como compatibilidad local se acepta también `SESSION_SECRET`.
- El frontend todavía usa rutas legacy mientras migra a `/api/v1`; no eliminar `legacy.ts` hasta completar esa migración.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
