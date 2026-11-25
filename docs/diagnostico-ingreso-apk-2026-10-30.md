# Ingreso desde la APK Android — 2026-10-30

## Comprobación posterior — 2026-11-02

Al preparar una nueva entrega Android se comprobó la API publicada con cuerpos
JSON vacíos: `/api/v1/auth/mobile-login/request` y
`/api/v1/auth/mobile-login/confirm` devuelven HTTP 400 con errores JSON de
validación. Ya no reproducen el 404 de rutas ausentes. Esta comprobación no
envía correos, no modifica cuentas y no confirma la recepción real de códigos
ni un inicio de sesión completo en el teléfono.

## Estado

Diagnóstico confirmado y rutas actuales comprobadas. El usuario solicitó avanzar con la actualización después de revisar el alcance. **Pendiente de confirmar y completar la publicación en la interfaz**: no se modificaron producción, cuentas, contraseñas ni roles.

## Causa y evidencia

- La APK llega a la API publicada de Worky y solicita el contrato correcto.
- La investigación de publicación identificó una versión de API anterior a las rutas de ingreso móvil.
- Las solicitudes de diagnóstico con cuerpo JSON vacío a `POST /api/v1/auth/mobile-login/request` y `POST /api/v1/auth/mobile-login/confirm` devolvieron 404 HTML en producción.
- El código actual monta ambas rutas bajo `/api/v1`. La prueba local de enrutamiento devuelve 400 JSON en ambas: rechaza el cuerpo vacío antes de consultar cuentas o enviar correo.
- La comparación de esquemas de publicación detectó que faltan las tablas de desafíos y dispositivos móviles confiables.
- Un estado saludable en `/api/healthz` no demuestra que estén disponibles las operaciones requeridas por la APK.

No es necesario reinstalar la APK para corregir este 404: primero debe publicarse el servidor compatible. La entrega real de códigos y el ingreso desde el teléfono todavía deben comprobarse después de publicar.

## Validación del código actual

- `pnpm --filter @workspace/api-server exec tsx --test test/worky-mobile-login-routing.test.ts`: aprobado; prueba ambas rutas con cuerpos vacíos, sin usar cuentas ni enviar correos.
- `pnpm --filter @workspace/api-server run typecheck`: aprobado.
- `pnpm --filter @workspace/api-server run build`: aprobado.
- `pnpm --filter @workspace/api-server run test:mobile-device-login`: aprobado durante la revisión posterior. Usa cuentas sintéticas de desarrollo que elimina al finalizar y sustituye Gmail por respuestas simuladas; no envía correos reales.
- No se cambió la lógica de autenticación. Se conserva la identificación de dispositivos, el código para dispositivos nuevos y la autenticación Bearer.

## Revisión previa solicitada

La revisión se realizó antes de recibir la solicitud de actualización. Comprobó mediante la prueba existente:

- Un dispositivo nuevo obtiene un desafío, sin recibir todavía una sesión.
- Un código correcto permite ingresar y registrar el dispositivo.
- Un dispositivo reconocido ingresa sin otro correo.
- Los códigos vencidos, reutilizados y bloqueados por intentos no habilitan sesiones.
- El intervalo entre reenvíos evita correos duplicados.
- Consultar o revocar dispositivos requiere autenticación; una cuenta no puede revocar dispositivos ajenos.

Límites de esta revisión:

- Gmail fue simulado en las pruebas. No se comprobó su autorización o entrega real en producción y no se debe afirmar que publicar garantizará la recepción del código.
- Los metadatos de publicación y las comprobaciones de rutas permiten identificar la API desactualizada, pero no reconstruyen por sí solos un diff completo de todos los archivos de la versión publicada frente al estado actual.
- El cambio previo de matrícula sigue separado de la corrección móvil. No se aprobó implícitamente.
- La revisión no modifica ni marca como verificadas cuentas reales.

## Cambio exacto de esquema pendiente

Resultado de la comparación de desarrollo y producción: nueve sentencias, sin eliminación de tablas, columnas ni datos y sin incompatibilidades advertidas. Esto describe el diff consultado; debe revisarse nuevamente si el proyecto cambia antes de publicar.

### A. Ingreso móvil

Dos tablas, dos claves foráneas y cuatro índices:

```sql
CREATE TABLE "worky_mobile_login_challenges" (
  "id" serial PRIMARY KEY NOT NULL,
  "usuario_id" integer NOT NULL,
  "device_hash" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "worky_mobile_trusted_devices" (
  "id" serial PRIMARY KEY NOT NULL,
  "usuario_id" integer NOT NULL,
  "device_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "device_key" uuid DEFAULT gen_random_uuid() NOT NULL
);

ALTER TABLE "worky_mobile_login_challenges"
  ADD CONSTRAINT "worky_mobile_login_challenges_usuario_id_worky_users_id_fk"
  FOREIGN KEY ("usuario_id") REFERENCES "public"."worky_users"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "worky_mobile_trusted_devices"
  ADD CONSTRAINT "worky_mobile_trusted_devices_usuario_id_worky_users_id_fk"
  FOREIGN KEY ("usuario_id") REFERENCES "public"."worky_users"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX "worky_mobile_login_challenge_device_created_idx"
  ON "worky_mobile_login_challenges" USING btree
  ("usuario_id", "device_hash", "created_at");

CREATE UNIQUE INDEX "worky_mobile_trusted_device_key_idx"
  ON "worky_mobile_trusted_devices" USING btree ("device_key");

CREATE UNIQUE INDEX "worky_mobile_trusted_device_user_device_idx"
  ON "worky_mobile_trusted_devices" USING btree ("usuario_id", "device_hash");

CREATE INDEX "worky_mobile_trusted_device_user_idx"
  ON "worky_mobile_trusted_devices" USING btree ("usuario_id");
```

### B. Cambio previo de documentación profesional, separado del ingreso móvil

El diff también incluye este cambio existente. No es necesario para resolver el 404 móvil y no debe aprobarse implícitamente:

```sql
ALTER TYPE "public"."worky_private_document_type" ADD VALUE 'matricula';
```

## Publicación pendiente

Después de la solicitud de actualización se repitió la comparación de esquemas: conserva las mismas nueve operaciones documentadas, sin advertencias de pérdida de datos. No se ejecutó ninguna sentencia manualmente. La publicación y su comprobación posterior todavía están pendientes.

La publicación usa el estado actual del proyecto, no únicamente la nueva prueba de rutas. No se debe presentar como una publicación aislada de dos handlers.

La base existente debe actualizarse mediante el flujo de publicación administrado por Replit; no se creó otra base ni se ejecutó sincronización manual. Después de la aprobación y publicación, comprobar ambos endpoints otra vez con `{}`: deben devolver 400 JSON en lugar de 404, sin enviar correos ni modificar cuentas. El ingreso real debe hacerlo el titular desde su teléfono, sin compartir credenciales.
