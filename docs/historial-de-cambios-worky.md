# Historial de cambios de Worky

**Fecha de actualización:** 24 de agosto de 2026  
**Producto:** Worky — Plataforma de oficios  
**Propósito del documento:** registrar en orden las mejoras realizadas en la aplicación, sus validaciones y los próximos pasos identificados.

---

## 1. Evolución integral de la plataforma

### Objetivo

Construir la base funcional de Worky como una plataforma que conecta clientes con profesionales de oficios, manteniendo una única cuenta por persona y permitiendo activar el perfil Partner cuando el usuario decide ofrecer sus servicios.

### Cambios realizados

- Registro e inicio de sesión de usuarios.
- Sesión persistente mediante recuperación de la cuenta con `/auth/me`.
- Cuenta única que comienza como cliente.
- Activación del perfil Partner desde “Ofrecer mis servicios”.
- Búsqueda y perfiles públicos de profesionales.
- Catálogo compartido de categorías.
- Publicación, aceptación y seguimiento de changas.
- Estados de trabajo: publicada, aceptada, en curso, finalizada y cancelada.
- Chat asociado a cada changa.
- Experiencias diferenciadas para clientes y Partners.
- Migración progresiva de las llamadas hacia `/api/v1`.
- Validación de permisos por propietario y participante.
- Uso de Object Storage para archivos, conservando metadatos en PostgreSQL.
- Reviews, recomendaciones, reputación y ranking calculados a partir de datos reales.
- Conversaciones con mensajes no leídos, adjuntos, etiquetas y citas.
- Notificaciones persistentes y actualización en tiempo real.
- Preparación de la operación Partner, calendario y dashboard.
- Preparación de pagos y reservas sin confirmar pagos desde el frontend.
- Estados de carga, vacío, error, éxito y acciones pendientes.
- Validaciones de responsive, accesibilidad y foco.

### Archivos y áreas principales

- `artifacts/api-server/src/routes/worky.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/middlewares/auth.ts`
- `artifacts/worky/src/App.tsx`
- `lib/db/src/schema/worky.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.ts`

---

## 2. Reseñas, reputación y organización de changas

### Objetivo

Hacer que la calificación sea segura y corresponda únicamente a la persona habilitada, además de ordenar la operación de los Partners.

### Cambios realizados

- El cliente dueño de una changa finalizada es quien puede calificar.
- Se impide calificar desde el rol equivocado.
- Se evita la duplicación de reviews.
- Se persiste el estado de calificación de la changa.
- Se incorporó una ventana de calificación con:
  - puntuación,
  - comentario,
  - adjuntos,
  - validaciones,
  - estados de carga,
  - errores claros.
- Las reseñas se reflejan en el perfil público del Partner.
- Se puede acceder al perfil profesional desde una conversación.
- Las changas del Partner se separan en:
  - **Oportunidades**,
  - **En proceso**,
  - **Mis trabajos**.
- Se reforzaron las validaciones del backend, además de ocultar acciones no permitidas en la interfaz.

### Validaciones realizadas

- Permisos de calificación.
- Prevención de duplicados.
- Persistencia del estado de review.
- Separación de las secciones del Partner.
- Visibilidad de adjuntos y reseñas.

### Archivos y áreas principales

- `artifacts/worky/src/App.tsx`
- `artifacts/worky/src/components/ui/dialog.tsx`
- `artifacts/worky/test/reviews-and-partner-jobs.test.ts`
- `artifacts/api-server/src/routes/worky.ts`
- `artifacts/api-server/test/worky-privacy.test.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.schemas.ts`

---

## 3. Identidad visual y pantalla de acceso

### Objetivo

Dar a Worky una identidad reconocible y mejorar la primera impresión de la aplicación.

### Cambios realizados

- Se incorporó el logo horizontal proporcionado para Worky.
- Se incorporó el símbolo de marca como favicon.
- Se corrigió la duplicación de la pantalla de login.
- Se dejó una única pantalla para usuarios no autenticados.
- Se centró verticalmente el mensaje principal en desktop.
- Se mejoró la composición visual del acceso:
  - tarjeta translúcida,
  - bordes suaves,
  - sombra,
  - blur,
  - degradados,
  - campos con mejor contraste,
  - detalle decorativo sutil en el panel izquierdo.
- Se mantuvo una experiencia responsive para desktop y móvil.

### Archivos principales

- `artifacts/worky/src/App.tsx`
- `artifacts/worky/src/index.css`
- `artifacts/worky/index.html`
- `artifacts/worky/public/brand/worky-logo.png`
- `artifacts/worky/public/brand/worky-mark.png`

---

## 4. Unificación visual de toda la aplicación

### Objetivo

Extender el lenguaje visual de la pantalla de acceso al resto de Worky sin modificar reglas de negocio, endpoints, permisos, autenticación, estados de changas ni modelos de datos.

### Cambios realizados

#### Sistema visual compartido

- Fondos con degradados sutiles y textura de grano.
- Superficies, bordes y sombras consistentes.
- Tipografía de display y tipografía de lectura compartidas.
- Estados visuales con mayor contraste.
- Foco visible y accesible.
- Transiciones suaves y respeto por `prefers-reduced-motion`.

#### Shell, sidebar y navegación

- Sidebar con degradado de marca y mejor profundidad visual.
- Navegación con estados activos más claros.
- Mejor separación entre cuenta, navegación y llamada a ofrecer servicios.
- Header con efecto translúcido y blur.
- Navegación móvil con ancho controlado y mejor adaptación.

#### Inicio y búsqueda

- Hero de búsqueda con composición editorial.
- Filtros de categorías con mejor jerarquía.
- Tarjetas de profesionales con elevación al pasar el cursor.
- Indicadores visuales para disponibilidad y verificación.
- Estados de loading, vacío y error más orientados a la acción.

#### Perfiles y formularios

- Tarjetas de perfil con tratamiento visual compartido.
- Formularios con campos, labels y estados de foco consistentes.
- Mejor lectura de reputación, experiencia, ubicación y precio.
- Superficies de edición y activación del perfil Partner unificadas.

#### Changas, conversaciones y chat

- Tarjetas de changas y conversaciones con estados visuales consistentes.
- Badges de estado con indicador de color.
- Hover y profundidad para distinguir elementos interactivos.
- Mejor tratamiento visual de citas, adjuntos, errores y acciones pendientes.

#### Dashboard Partner

- Métricas operativas agrupadas en tarjetas.
- Mejor jerarquía para trabajos recientes, agenda y portfolio.
- Superficies consistentes entre el dashboard y el resto de la aplicación.

### Archivos principales

- `artifacts/worky/src/index.css`
- `artifacts/worky/src/App.tsx`
- `artifacts/worky/src/components/ui/dialog.tsx`
- `artifacts/worky/src/pages/not-found.tsx`

---

## 5. Corrección puntual del encabezado

### Objetivo

Mejorar la presentación del texto **“Tu red de confianza, en orden.”**, que se veía suelto o podía quebrarse mal en anchos intermedios.

### Cambios realizados

- Se agregó una clase visual específica para el texto del encabezado.
- Se incorporó un indicador circular con el color primario de Worky.
- Se mejoraron alineación, peso tipográfico y espaciado.
- Se evitó el salto de línea en tablet y desktop.
- Se mantuvo el mensaje original y no se modificó el comportamiento del header.

### Archivos modificados

- `artifacts/worky/src/App.tsx`
- `artifacts/worky/src/index.css`

---

## 6. Auditoría visual responsive

### Objetivo

Verificar que las pantallas principales mantengan una experiencia usable en distintos tamaños.

### Cobertura

- Mobile: 360, 390 y 430 px.
- Tablet: 768 y 1024 px.
- Desktop: 1440 px.
- Pantallas revisadas:
  - changas,
  - conversaciones,
  - dashboard Partner,
  - perfiles,
  - navegación,
  - estados vacíos y de carga.

### Cambios y controles realizados

- Se agregaron recorridos reproducibles de auditoría visual.
- Se revisaron desbordes horizontales.
- Se revisaron elementos fuera de pantalla.
- Se verificaron grids y tarjetas en mobile, tablet y desktop.
- Se verificó la ausencia de duplicación de contenido.
- Se agregaron capturas de referencia visual.
- Se documentó el requisito de utilizar Playwright con las librerías gráficas necesarias del entorno.

### Archivos principales

- `artifacts/worky/scripts/visual-regression.mjs`
- `artifacts/worky/package.json`
- `artifacts/worky/test-results/visual/`
- `.replit`
- `.agents/memory/visual-audit-browser-runtime.md`

---

## 7. Auditoría pixel a pixel

### Objetivo

Detectar cambios visuales pequeños entre capturas de referencia y capturas actuales antes de publicar nuevas versiones.

### Resultado

- Se incorporó la tarea de detectar diferencias pixel a pixel.
- La auditoría visual responsive quedó acompañada por una verificación más estricta de capturas.
- La tarea fue implementada y quedó integrada al flujo de validación visual del proyecto.

### Estado

- Implementada.
- La integración final quedó sujeta al proceso de merge correspondiente.

---

## 8. Validaciones técnicas realizadas

Durante las etapas anteriores se ejecutaron las siguientes verificaciones:

- Typecheck del frontend.
- Build de producción con Vite.
- Tests de errores de citas.
- Tests de cola offline de intentos de visita.
- Tests de lectura y reintento de notificaciones.
- Tests de reconexión de notificaciones.
- Tests de reviews y organización de changas del Partner.
- Revisión del preview en desktop.
- Revisión del preview en móvil.
- Revisión de logs del workflow web y del servidor API.
- Revisión de foco, loading, empty, error y éxito.

---

## 9. Reglas y límites respetados

Los cambios visuales se realizaron sin alterar:

- APIs existentes.
- Permisos del backend.
- Autenticación y recuperación de sesión.
- Estados de changas.
- Modelos de datos.
- Reglas para calificar.
- Flujo de citas y reservas.
- Persistencia de archivos.
- Integraciones de pagos.

---

## 10. Pendientes y próximos pasos

### En seguimiento

- **Detectar cambios pixel a pixel antes de publicar Worky.**
- **Bloquear publicaciones con cambios visuales no aprobados.**

### Pendientes funcionales existentes

- Confirmar pagos y reservas con Mercado Pago sin falsos positivos.
- Permitir reportar reviews y recomendaciones inapropiadas.

### Mejora identificada

- Mantener una cobertura visual automatizada para Home, changas, conversaciones, perfil y dashboard en mobile, tablet y desktop.

---

## Resumen ejecutivo

Worky evolucionó desde una base de plataforma de oficios hacia una experiencia más completa, con cuentas persistentes, perfiles Partner, changas, chat, citas, reputación, notificaciones y dashboard operativo. Luego se consolidó una identidad visual consistente desde el login hasta las pantallas internas, se corrigieron detalles puntuales de composición y se añadieron auditorías responsive y pixel a pixel para reducir regresiones antes de publicar.