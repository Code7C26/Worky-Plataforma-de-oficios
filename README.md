# Worky · Plataforma de oficios

Worky es un proyecto de marketplace web y móvil para conectar a personas que necesitan resolver trabajos del hogar con profesionales de oficios. El producto reúne búsqueda, perfiles, publicación y seguimiento de changas, conversaciones y coordinación de visitas.

## Accesos
- Aplicación web pública: https://workyoficios.replit.app
- Repositorio público: https://github.com/Code7C26/Worky-Plataforma-de-oficios
- Instagram: @workyoficios

## Arquitectura
- **Web marketplace**: React, TypeScript y Vite, en `artifacts/worky/`.
- App móvil: React Native y Expo, en `artifacts/worky-mobile/`.
- API: Express y TypeScript, en `artifacts/api-server/`.
- Datos: PostgreSQL con Drizzle ORM, en `lib/db/`.
- Contrato y cliente: OpenAPI y código generado bajo `lib/api-spec/` y paquetes de cliente.
- Documentación del proyecto: `docs/entrega-final/` y `docs/historial-de-cambios-worky.md`.
- Guion de la defensa: `docs/entrega-final/Guion_Defensa_Worky.md`.
- Manual de usuario: `docs/manual-usuario-worky.md`.
- Publicaciones y plan de difusión: `docs/entrega-final/Publicaciones_Instagram_Worky.md` y `docs/entrega-final/Kit_Difusion_Worky.md`.

Las reglas de autenticación, roles y operaciones importantes se verifican en el servidor. Los documentos de identidad y antecedentes son privados y se revisan mediante el panel administrativo.

## Desarrollo local
Requiere Node.js y pnpm compatibles con el workspace.

```bash
pnpm install
pnpm --filter @workspace/worky run dev
```

Para iniciar servicios por separado:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/worky-mobile run dev
```

## Validación
```bash
pnpm run validate:worky
```

El flujo ejecuta validaciones del registro de cambios y la configuración, genera el cliente a partir del contrato y corre las suites disponibles del API y la web. Un resultado local no demuestra por sí solo entrega de email, pago real, publicación ni pruebas con usuarios.

## Límites conocidos
- No se presentan métricas de adopción, ingresos o conversión como verificadas.
- El flujo de pago en producción debe comprobarse de punta a punta antes de presentarlo como validado.
- El plan de pruebas documentado conserva estados que deben reconciliarse; ver `docs/entrega-final/Documento_Final_Worky.md`.
- El repositorio y la aplicación son recursos distintos: este README describe el proyecto del código fuente.

## Equipo
Mateo Santino Villarreal y Santiago Gastón Romero · Instituto Privado El Obraje · 7.º año C · 2026.
