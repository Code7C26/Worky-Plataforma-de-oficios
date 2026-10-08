// This module replaces @workspace/db ONLY in the isolated route-test bundle.
// Never import the production DB entrypoint: even a configured DATABASE_URL is ignored.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
export * from "../../../../lib/db/src/schema";

export const isolatedPostgres = new PGlite();
export const statements: string[] = [];
export const db = drizzle(isolatedPostgres, {
  logger: { logQuery(query) { statements.push(query); } },
});

export async function initializeDatabase() {
  await isolatedPostgres.exec(`
    CREATE TYPE worky_role AS ENUM ('cliente', 'profesional', 'admin');
    CREATE TYPE worky_onboarding_status AS ENUM
      ('registration_started', 'basic_info_completed', 'professional_verification_pending', 'onboarding_completed');
    CREATE TABLE worky_users (
      id serial PRIMARY KEY, nombre text NOT NULL, email text NOT NULL UNIQUE,
      email_verified_at timestamptz, password_hash text NOT NULL,
      telefono text, edad integer, foto_object_path text,
      onboarding_estado worky_onboarding_status NOT NULL DEFAULT 'registration_started',
      onboarding_paso integer NOT NULL DEFAULT 1, onboarding_respuestas jsonb NOT NULL DEFAULT '{}',
      rol worky_role NOT NULL DEFAULT 'cliente', ubicacion jsonb,
      activo boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE worky_admin_signup_tokens (
      id serial PRIMARY KEY, email text NOT NULL UNIQUE, code_hash text NOT NULL UNIQUE,
      code_salt text NOT NULL, attempts integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL, used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE worky_audit_events (
      id serial PRIMARY KEY, usuario_id integer REFERENCES worky_users(id),
      entidad text NOT NULL, entidad_id integer NOT NULL, accion text NOT NULL,
      estado_anterior text, estado_nuevo text, metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION reject_signup_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected isolated test failure'; END;
    $$;
  `);
}

export async function resetDatabase() {
  await isolatedPostgres.exec(`
    DROP TRIGGER IF EXISTS reject_audit ON worky_audit_events;
    DROP TRIGGER IF EXISTS reject_consumption ON worky_admin_signup_tokens;
    DROP TRIGGER IF EXISTS reject_account ON worky_users;
    TRUNCATE worky_audit_events, worky_admin_signup_tokens, worky_users RESTART IDENTITY CASCADE;
  `);
  statements.length = 0;
}
