# Historial de cambios de Worky

**Fecha de actualización:** 4 de noviembre de 2026
**Producto:** Worky — Plataforma de oficios  
**Propósito del documento:** mantener un registro cronológico de las tareas realizadas, sus fechas, evidencias y validaciones.

### Reconstrucción de mejoras con evidencia Git anterior al 24 de agosto de 2026

Se revisó `git log` hasta el límite del 24 de agosto de 2026 a las 00:00 en `America/Buenos_Aires` (UTC−03:00). La columna indica **fecha/hora del commit en UTC**, no fecha de realización: Git no demuestra cuándo se comenzó o terminó una tarea. En este huso, cualquier marca de 00:00–02:59 UTC corresponde al día calendario anterior en Buenos Aires; por eso, los commits del 24 de agosto de madrugada UTC (última fila) aún son del 23 de agosto local. Las referencias son hashes abreviados que permiten localizar la evidencia en el historial.

| Fecha/hora del commit (UTC) | Mejora agrupada en esta bitácora | Commits de evidencia |
|---|---|---|
| 2026-08-22 19:04–22:49 UTC | Base de la API Worky, generación del cliente, esquema de datos y conexión de rutas de aplicación (sección 1). | `b46dfb6` cliente/rutas; `0cf624e` esquema/dependencias; `a43592a` servidor/rutas; `ca719fb` integración de rutas/interfaz. |
| 2026-08-22 23:01–23:29 UTC | Operación Partner, almacenamiento de archivos, estados auditables, aislamiento entre participantes y pruebas de privacidad (secciones 1 y 9). | `dc6ed92`, `9d8b3ae`, `59a3a6a`, `7321c4b`, `aad480c`. |
| 2026-08-22 23:10 UTC; 2026-08-23 19:44–20:03 UTC | Reputación, recomendaciones y reseñas; permisos de calificación, prevención de duplicados y persistencia del estado de review (sección 2). | `bade0fa`, `5999d90`, `6f61ce5`, `d2a908f`. |
| 2026-08-23 00:55–02:18 UTC | Migración de perfiles, changas y mensajes a `/api/v1`; coordinación de visitas, historial persistente, reintentos y prevención de duplicados en la cola offline (secciones 1 y 8). | `4d506c6`, `f8f8004`, `9331eb3`, `4c2474e`, `c68a09f`, `4184314`, `052b585`, `c154b57`. |
| 2026-08-23 02:50–14:53 UTC | Avisos vinculados con sus changas, marcado de lectura, reintentos, contador sincronizado y notificaciones en tiempo real (SSE), con reconexión, aislamiento por usuario y límites de conexiones. | `98283f6`, `1dd7b44`, `4f8975c`, `7f5b2e7`, `7c4f218`, `b4e8bd1`, `0930c28`, `f9756fb`, `aa63b10`, `6d47f96`, `1c76d8d`, `f745909`, `0b70aa1`, `77ec0b8`, `eb15b52`. |
| 2026-08-23 18:46–20:03 UTC | Cambios de marca y estilo, integración de recursos visuales, reseñas, encabezado y organización de rutas/interfaz (secciones 2–5). | `9e95e0d`, `c3b8b68`, `6408a0c`, `128d4b6`, `5999d90`, `b557e85`, `6f61ce5`, `627b9d2`, `d2a908f`, `2cd0eed`. |
| 2026-08-24 02:01–02:23 UTC (23 de agosto en Buenos Aires) | Auditoría visual responsive, baselines para comparación pixel a pixel e integración de la auditoría en la validación del proyecto (secciones 6–7). | `a0ca9d4`, `ded6236`, `e26c306`. |

El commit inicial `9ef0b8f` está fechado el 28 de julio de 2026, pero contiene el scaffold del workspace y no evidencia suficiente para datar las funcionalidades Worky enumeradas aquí.

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

## 11. Registro de tareas y evidencia

Las fechas de esta sección se agruparon por tarea, no por cada commit. Cuando una fecha procede únicamente de Git, se identifica como fecha del commit, no como fecha de realización. Un commit confirma que el cambio estaba registrado para ese momento, pero no permite deducir cuándo se hizo el trabajo. Las referencias cortas permiten comprobar la evidencia. La reconstrucción del periodo anterior al 24 de agosto se detalla al inicio de este documento.

Para las tareas nuevas, agregar una entrada al completar el trabajo con: fecha local de realización (`America/Buenos_Aires`), objetivo y alcance, cambios realizados, pruebas con resultado, referencia de commit cuando exista y estado de publicación. Si algo no se verificó o no se publicó, dejarlo explícito.

| Fecha consignada / tipo de evidencia | Tarea o grupo | Resultado y validación | Evidencia |
|---|---|---|---|
| Commit: 2026-08-24 02:01–02:23 UTC (23 de agosto en Buenos Aires) | Auditoría responsive y regresión visual | Se agregaron recorridos y capturas de referencia para revisar las pantallas en distintos tamaños y detectar diferencias visuales. Esta marca horaria procede de Git y no fija la fecha de realización. | Commits `a0ca9d4`, `ded6236`, `e26c306`; validación visual documentada en la sección 6. |
| 2026-08-26 | Privacidad y validación de archivos | Se reforzaron las cargas de fotos y adjuntos: validar contenido real de imagen, limpiar cargas abandonadas o rechazadas y cubrir los flujos de almacenamiento con pruebas. | Commits `7af4a99`, `fd4d05e`, `0ee88ed`, `d51609c`, `fbb9b60`; pruebas `20ac389`, `5eb229a`. |
| 2026-08-31–2026-09-02 | Estabilidad visual y búsqueda por cercanía | Se estabilizaron las capturas de regresión y se corrigió el ordenamiento por cercanía cuando falta ubicación disponible. | Commits `8d6e7da`, `78ebfe6`, `115166e`, `0f28ade`. |
| 2026-09-07 | Privacidad de ubicación | Se evitó calcular distancias usando ubicaciones vencidas y se agregaron pruebas para las reglas de ubicación. | Commits `0fc9ece`, `bfeb3f4`, `adfcfeb`, `c766bac`. |
| 2026-09-15 | Recuperación de contraseña | Se documentó e implementó el flujo de recuperación segura de contraseña. | Commit `4656f41`; registro de cambios asociado en el historial Git. |
| 2026-09-29–2026-09-30 | Integración y experiencia móvil | Se avanzó en autenticación e integración con la API; se organizaron las bandejas por rol, el chat y la vista de adjuntos, y se añadieron mejoras de accesibilidad y movimiento. | Commits `7655ad3`, `7242e02`, `40831b4`, `3a3af7b`, `74ac149`, `90f7a3d`, `941797a`; pruebas de bandeja por rol en `157bef6`. |
| 2026-10-01 | Configuración de cuenta y cambio de rol | Se agregaron controles de privacidad y configuración de cuenta, y se preservó el contexto al cambiar entre Cliente y Partner; se verificaron anuncios accesibles. | Commits `6772b0e`, `16e43bc`, `9fa8e42`, `f88f069`. |
| 2026-10-05–2026-10-08 | Verificación de email y administración | Se implementaron flujos de verificación de email y recuperación, alta y delegación administrativa, lectura de notificaciones y pruebas de integración asociadas. | Commits `d5860bd`, `7bdb834`, `5bfae5d`, `d04e3bf`, `774a3b8`, `500f878`; documentación en `1e2c325`. |
| 2026-10-13–2026-10-15 | Rutas y documentación de Worky Admin | Se ampliaron las rutas de registro/notificación administrativa y se actualizaron documentos y configuración relacionados. | Commits `69f5b72`, `9c114d5`, `60c65b1`, `63459d5`. La existencia de un commit no implica por sí sola que el cambio se haya publicado en producción. |
| 2026-10-22 | Inicio móvil con verificación de dispositivo nuevo | Se agregó el envío automático de un código al iniciar sesión en una instalación nueva, confianza para ingresos posteriores desde esa instalación y el control para mostrar/ocultar la contraseña. El esquema se aplicó a desarrollo; producción no se modificó. | Commit `af160dc`; `pnpm --filter @workspace/api-server run test:mobile-device-login`, typechecks de API y móvil y build estático iOS/Android aprobados; preview revisado. |
| 2026-10-22 | Recuperación del preview web tras la regeneración del cliente API | Vite mostró un import faltante mientras se regeneraban los archivos del cliente. Se verificó que los archivos existieran, se reinició el workflow web y se confirmó el login en el preview. No requirió cambios de datos ni publicación. | Captura de preview posterior al reinicio y logs del workflow web sin el error de import. |
| 2026-10-22 | Crear este registro cronológico y establecer la regla para mantenerlo | Se incorporó el formato con fecha, alcance, validación, evidencia y estado de publicación; se hizo un resumen retrospectivo de tareas agrupadas según la evidencia disponible en Git. | `docs/historial-de-cambios-worky.md`, instrucción de proyecto en `replit.md`; revisión `git diff --check`. |
| 2026-10-22 | Crear carrusel publicitario para explicar Worky | Se diseñaron tres piezas verticales 4:5: qué es Worky, cómo funciona para clientes y cómo sumarse como Partner. Se verificaron visualmente y se exportaron a 1080×1350; sin cambios en el producto ni publicación. | `artifacts/mockup-sandbox/public/ads/worky-*.html`, `generated-artifacts/worky-*-1080x1350.jpg`; capturas del preview/canvas. |
| 2026-10-22 | Video publicitario de funcionalidades | Se creó un video animado 16:9 de 29 segundos y seis escenas sobre publicar una solicitud, descubrir profesionales, coordinar por chat y funciones para Partners. A pedido del usuario, el cierre quedó como «La red que mueve tu ciudad». El preview inició y pasó la validación del ciclo de grabación; no se comprobó la exportación MP4 ni la sincronía musical. | `artifacts/worky-publicidad-funciones/src/components/video/scenes.tsx`, `src/components/video/VideoTemplate.tsx`, `public/audio/bg_music.mp3`, `SCRIPT.md`; logs del workflow y `scripts/validate-recording.sh`. |
| 2026-10-22 | Video vertical de Worky para Reels y Shorts | Se creó una versión independiente 9:16 de 29 segundos con seis escenas recompuestas para móvil y el cierre «La red que mueve tu ciudad». Tras el feedback del usuario, se corrigió el centrado y el ajuste de los logos usando los PNG oficiales con transparencia y `contain`, y se retiró una superposición sobre el símbolo. El agente de diseño revisó capturas de las seis escenas y transiciones; el preview quedó activo sin errores de consola. Build, chequeo TypeScript y validación del ciclo de grabación pasaron; no se exportó MP4. La pista instrumental es procedural porque el servicio de generación no estaba disponible. El chequeo global `validate:worky` sigue bloqueado en su validador de artefactos, que no reconoce los `PORT` y `BASE_PATH` requeridos por los dos videos; el video horizontal ya presentaba el mismo patrón. | `artifacts/worky-publicidad-vertical/SCRIPT.md`, `src/components/video/scenes.tsx`, `src/components/video/VideoTemplate.tsx`, `public/images/worky-official-logo.png`, `public/images/worky-official-mark.png`, `public/audio/bg_music.mp3`; workflow, `scripts/validate-recording.sh` y `scripts/src/validate-artifact-config.ts`. |

---

## 12. Acceso administrativo con sesión vigente — 2026-10-26

- Al abrir `/admin` o `/admin/verificaciones`, se consulta el rol vigente de la sesión al servidor, evitando mostrar el alta inicial a una sesión cuyo rol se actualizó.
- Un rol admin confirmado abre el panel sin pedir código ni contraseña adicional. No se conceden permisos por el rol guardado en el navegador.
- Si falla temporalmente la consulta, se permite reintentar sin solicitar códigos ni eliminar una sesión vigente.
- Se aclaró el texto del login administrativo para distinguir acceso de administradores existentes y alta inicial.
- Verificación: pruebas del acceso admin y del gate de sesión, chequeo de tipos y build aprobados. Se cubrieron admin, no-admin, sesión ausente y error con reintento mediante respuestas simuladas, sin cuentas reales ni envío de correos. Captura de `/admin` sin sesión: login visible sin errores.
- Estado: disponible en desarrollo, sin publicar ni modificar roles de cuentas reales o datos de producción.

### Habilitación inicial autorizada en desarrollo — 2026-10-26

- Con aprobación explícita del usuario para omitir el código de alta únicamente en desarrollo, se habilitó como admin la cuenta activa y ya verificada que coincide con el correo principal configurado.
- La promoción y su evento de auditoría se registraron de forma atómica. Una consulta posterior confirmó rol admin, cuenta activa, correo verificado y auditoría presente.
- No se cambió la contraseña ni se alteraron otros administradores. Producción no se modificó. Esta excepción puntual no cambia los requisitos del alta administrativa normal.

## 13. Alta profesional con revisión administrativa obligatoria — 2026-10-26

- Se estableció el flujo profesional en la web: crear cuenta, confirmar el email y esperar la revisión de los documentos y la habilitación administrativa. Se retiró el texto que describía la verificación como informativa.
- Se agregó una pantalla de alta pendiente con estado de DNI frente, DNI dorso y antecedentes penales, carga o reemplazo de documentos, mensajes de error y actualización periódica de la habilitación. Permite conservar el acceso a la edición del perfil y a la vista Cliente.
- La API compartida bloquea el dashboard profesional, las oportunidades y la aceptación de changas mientras falte la habilitación. También impide que un cliente contrate directamente a un perfil pendiente.
- El administrador solo puede habilitar un perfil con cuenta activa, email verificado y los tres documentos aprobados. Aprobar documentos no publica automáticamente el perfil. La habilitación actualiza el estado de alta; el solicitante no puede marcarlo como completo antes de la aprobación.
- Verificaciones: prueba aislada de Admin con cuentas temporales (incluyendo revisión de documentos, bloqueo previo, email no verificado y habilitación final); prueba de interfaz en JSDOM del estado pendiente, edición disponible y desbloqueo; chequeos TypeScript y builds de web/API satisfactorios. La primera ejecución detectó una omisión en la limpieza de notificaciones de QA; se corrigió y se limpiaron esas cuentas temporales.
- Alcance: web marketplace y controles de la API compartida. No se modificaron cuentas reales, no se enviaron correos de prueba, no se cambió el esquema y no se publicó ni modificó producción. La carga nativa de documentos desde la app móvil queda como una ampliación independiente.

## 14. Consola Admin sin navegación duplicada — 2026-10-26

- Las rutas `/admin` y `/admin/verificaciones` muestran la consola administrativa directamente, sin el sidebar ni el encabezado del marketplace que duplicaban la navegación y reducían el espacio disponible.
- Se conserva la navegación propia de Admin, su diseño responsive y la comprobación de permisos de la sesión. No se modificaron la autenticación, los roles ni los endpoints.
- Validaciones satisfactorias: TypeScript, tres pruebas de acceso Admin y build de la web. La vista autenticada no se verificó con un navegador.
- Cambio limitado a desarrollo; no se publicó.

## 15. Verificación agrupada por postulante y matrícula opcional — 2026-10-26

- Verificaciones reúne los perfiles sin habilitar en fichas con DNI frente, DNI dorso, antecedentes y matrícula opcional; muestra archivos faltantes, pendientes, aprobados y rechazados, incluso cuando ya no quedan documentos pendientes y solo falta la decisión final.
- Se incorporaron búsqueda, paginación y actualización periódica. Cada archivo adjunto puede abrirse con la sesión autenticada y los pendientes pueden aprobarse o rechazarse con el motivo auditado existente. La habilitación final está disponible en esa misma ficha.
- La API comprueba cuenta activa, email verificado y los tres tipos obligatorios aprobados. La matrícula no es obligatoria, pero cualquier matrícula adjuntada debe estar aprobada. La ausencia de un tipo obligatorio no se compensa con otro archivo.
- Se agregó la carga opcional de matrícula en el registro y en el estado pendiente de la web. Los archivos siguen en el almacenamiento privado existente.
- Cambio acotado del esquema de desarrollo: `ALTER TYPE public.worky_private_document_type ADD VALUE IF NOT EXISTS 'matricula'`. No se ejecutó sincronización amplia, no se cambió producción ni se modificaron cuentas reales.
- Pruebas satisfactorias: lógica de los documentos obligatorios/opcionales; API con cuentas temporales y limpieza, incluyendo accesos 401/403, perfil sin archivos, documentos aprobados antes de habilitar, matrícula pendiente y habilitación final; componente en JSDOM con apertura, aprobación, rechazo y bloqueos; prueba del estado pendiente profesional; TypeScript y builds de web/API.

## 16. Separación de vista marketplace y permiso administrativo — 2026-10-26

- En `/home` y demás vistas del marketplace las cuentas administradoras se presentan como Cliente o Profesional, sin el enlace Administración ni esa etiqueta en la barra lateral.
- Una cuenta admin con perfil profesional puede alternar las vistas Cliente/Profesional. Se ignoran preferencias antiguas que pretendían usar Admin como una vista del marketplace.
- `/admin` conserva su consola independiente y la comprobación del rol obtenida del servidor. No se cambiaron roles de cuentas ni permisos administrativos.
- Validaciones: casos de selección de vista con/sin perfil profesional y preferencias antiguas; pruebas del control de acceso Admin; TypeScript y build. Sin publicación.

## 17. Documentos del registro sin carga duplicada y bloqueo profesional — 2026-10-26

- El estado pendiente consulta los documentos guardados y solicita archivo únicamente cuando falta o fue rechazado. Los archivos recibidos o aprobados muestran nombre y estado, sin un control para volver a cargarlos. La matrícula ausente sigue siendo opcional y su carga se ofrece desplegable.
- Con todos los documentos obligatorios recibidos, se muestra que la solicitud espera revisión/habilitación. Al terminar de guardar el registro se actualizan las consultas para no conservar la lista vacía obtenida mientras se procesaba el alta.
- Se retiraron las excepciones de edición que permitían mostrar páginas profesionales antes de la habilitación. Solo permanece disponible el formulario inicial cuando aún no existe perfil, además de la carga documental necesaria. La vista Cliente no se bloquea.
- La API también exige habilitación al consultar/editar disponibilidad y consultar/agregar portfolio, además de los controles existentes sobre dashboard y changas.
- Validaciones satisfactorias: interfaz en JSDOM con archivos recibidos sin controles de recarga, faltantes, rechazados y bloqueo hasta habilitación; dos pruebas de recuperación del registro; API con cuentas QA para disponibilidad/portfolio bloqueados antes de habilitar y disponibles después; TypeScript y builds de web/API. Se limpiaron las cuentas temporales.
- Sin cambios de esquema, cuentas reales ni producción.

## 18. Fondo continuo en el logo de la barra lateral — 2026-10-26

- Se retiró el degradado azul claro y el borde del bloque del logo en la barra lateral del marketplace. El fondo azul marino de la barra queda continuo detrás del logo.
- Sin cambios en el archivo del logo, las opciones del menú ni la consola Admin. Cambio aplicado en desarrollo, sin publicación.

## 19. Cabecera azul en la búsqueda de la app móvil — 2026-10-26

- Se añadió una franja azul marino continua desde la parte superior del área segura del dispositivo hasta debajo del logo de Worky en la pantalla Buscar. Usa la versión clara del logo, conservando el tamaño anterior.
- El logo completo quedó centrado horizontalmente dentro de la franja, sin alterar el resto de los controles.
- El resto de la pantalla conserva su fondo y contenido anteriores. La barra de estado se presenta en claro sobre la franja.
- TypeScript pasa. El script de build estático de Expo no pudo iniciar Metro porque el puerto 8081 estaba ocupado por el servidor de previews; el workflow Expo de la app sigue ejecutándose. Sin cambios de datos, API ni publicación.

## 20. Registro de nuevas entregas

Las entradas nuevas se agregan en esta sección, una por cada entrega. La validación automática comprueba los campos y no modifica el documento. Usar un encabezado `### AAAA-MM-DD — Título de la entrega` y debajo cuatro viñetas: `- Resultado: ...`, `- Validación: ...`, `- Evidencia: ...` y `- Estado de publicación: ...`.

### 2026-10-26 — Simplificar la búsqueda principal móvil
- Resultado: se retiraron de la pantalla Buscar el acceso con «+», la tarjeta «Publicar un trabajo» y el encabezado «¿Qué necesitás resolver?». El campo de búsqueda mantiene una etiqueta accesible para lectores de pantalla.
- Validación: pasaron el build de `@workspace/api-client-react`, el chequeo de tipos móvil, el build estático Expo para iOS y Android, y `git diff --check`.
- Evidencia: `artifacts/worky-mobile/app/(tabs)/index.tsx`.
- Estado de publicación: no publicado.

### 2026-10-26 — Unificar las pestañas de la app móvil
- Resultado: se agregó un encabezado Worky azul marino, compacto y centrado en todas las pestañas; se unificó el fondo de las pantallas y se reforzó el contraste de la navegación. En el rol cliente, Trabajos usa un «+» más grande; en el rol profesional, Changas conserva el icono de maletín. «Publicar un trabajo» ahora resalta con un «+» grande sobre fondo azul.
- Validación: pasaron el chequeo de tipos móvil, el build estático Expo para iOS y Android, y `git diff --check`.
- Evidencia: `artifacts/worky-mobile/app/(tabs)/_layout.tsx` y `artifacts/worky-mobile/app/(tabs)/jobs.tsx`.
- Estado de publicación: no publicado.

### 2026-10-28 — Compatibilidad móvil con Expo Go SDK 58
- Resultado: la app móvil usa Expo 58.0.19, React Native 0.88 y React 19.3 con el conjunto oficial de versiones incluido en ese SDK. Se adaptó la barra de pestañas a `emitter`/`navigateToTab` y se unificó la resolución de React, React Native y React Query en Metro para las bibliotecas compartidas. Los builds generados no se incorporan al repositorio.
- Validación: pasaron TypeScript, los bundles y manifiestos estáticos iOS/Android y la prueba de navegación cliente/profesional con acceso a publicar y a Changas. El diagnóstico online no está totalmente limpio: recomienda cuatro parches recientes bloqueados por la política de antigüedad y detecta una instalación React de un peer compartido; Metro usa la copia de la app y la prueba de navegación con React Query pasó. No se verificó Expo Go en un teléfono físico.
- Evidencia: `artifacts/worky-mobile/package.json`, `artifacts/worky-mobile/metro.config.js`, `artifacts/worky-mobile/app/(tabs)/_layout.tsx`, `artifacts/worky-mobile/test/jobs-role-access.browser.test.mjs` y `pnpm-lock.yaml`.
- Estado de publicación: no publicado; vista previa móvil reiniciada con SDK 58. Se conservaron la API y la web existentes.

### 2026-10-28 — Acceso completo a la barra lateral web
- Resultado: la barra lateral usa la altura visible del navegador y desplazamiento vertical independiente cuando no entra todo su contenido. Los bloques no se comprimen y Configuración/Salir de Worky quedan accesibles también con texto ampliado y en el menú móvil. Se aisló la resolución TypeScript de React en la web para evitar conflictos de tipos tras la actualización del SDK móvil.
- Validación: pasaron TypeScript, build web y `git diff --check`. Una comprobación de navegador con API simulada verificó Configuración y Salir con foco de teclado en los roles cliente/profesional a 1440×900, 1024×480 con texto ampliado y 390×480.
- Evidencia: `artifacts/worky/src/index.css` y `artifacts/worky/tsconfig.json`.
- Estado de publicación: no publicado; sin cambios en cuentas, datos ni API.

### 2026-10-28 — Mantener estable el Admin después de habilitar un Partner
- Resultado: el Admin conserva una altura de pantalla estable, con desplazamiento independiente para el menú y el contenido. Al desaparecer el último perfil de la cola, el fondo del menú no se corta y sus últimas opciones siguen accesibles. El contador de verificaciones se actualiza también fuera de Resumen.
- Validación: pasaron TypeScript, build web, las cuatro pruebas de acceso/cola admin y `git diff --check`. La nueva prueba `test:admin-layout` reprodujo la habilitación del último perfil en escritorio 1280×600 y móvil 390×600; comprobó el aviso de éxito, cierre del diálogo, cola vacía, contador actualizado y navegación dentro de la pantalla. Todas las solicitudes se interceptaron con datos QA; no se modificaron cuentas reales.
- Evidencia: `artifacts/worky/src/pages/admin-console.tsx`, `artifacts/worky/test/admin-console-layout.browser.test.mjs` y `artifacts/worky/package.json`.
- Estado de publicación: no publicado; sin cambios en la API, permisos ni reglas de habilitación.

### 2026-10-28 — Recibir y responder propuestas de visita en el chat móvil
- Resultado: el chat móvil consulta las visitas y las intercala cronológicamente con los mensajes, incluso cuando no hay texto. Muestra fecha, estado y Aceptar/Rechazar únicamente al cliente de una propuesta pendiente. La respuesta confirmada por el servidor actualiza la conversación y las vistas activas; los fallos se muestran y permiten reintentar. Las visitas nuevas se consultan cada ocho segundos.
- Validación: pasaron TypeScript, las 14 pruebas de conversaciones y la exportación de bundles iOS/Android. Una comprobación en navegador a 390×844, con toda la API simulada, verificó recepción sin mensajes, error 503 y reintento, aceptación/rechazo persistentes al recargar, ausencia de controles para el profesional y llegada de una propuesta mediante refresco periódico. Sin errores JavaScript. No equivale a una prueba en dispositivos físicos.
- Evidencia: `artifacts/worky-mobile/app/chat/[changaId].tsx`, `artifacts/worky-mobile/components/ChatVisitCard.tsx`, `artifacts/worky-mobile/lib/chat-timeline.ts` y `artifacts/worky-mobile/test/chat-timeline.test.mjs`.
- Estado de publicación: no publicado; sin cambios en la API, base de datos ni conversaciones reales. Se conservaron los endpoints existentes y la autenticación Bearer.

### 2026-10-28 — Presentación compacta de las visitas en el chat web
- Resultado: las visitas muestran fecha y hora junto a un estado legible en una tarjeta compacta. El historial queda debajo, desplegable con teclado, en vez de competir en la misma fila. Los intentos sin sincronizar se muestran abiertos con sus controles de reintento y eliminación. Se conservaron permisos, formularios, mensajes y acciones existentes.
- Validación: pasaron TypeScript, build web, las ocho pruebas de errores/intentos sin conexión y `git diff --check`. Una comprobación de navegador con API simulada cubrió Partner en escritorio y pantalla angosta, historial pendiente abierto, cliente con los controles de respuesta e historial oculto, y Partner sin visitas con formulario de propuesta. Sin recortes horizontales ni errores JavaScript en esos cinco casos.
- Evidencia: `artifacts/worky/src/App.tsx`, componentes `AppointmentActions`, `AppointmentStatusPill`, `AppointmentAttemptHistory` y bloque de visitas de `ChatPageLegacy`.
- Estado de publicación: no publicado; sin cambios en API, datos reales, aplicación móvil ni panel Admin.

### 2026-10-28 — Estado de trabajos, identidad del chat y reseñas en móvil
- Resultado: los avisos de trabajos finalizados llevan a Mis trabajos; cada trabajo muestra el estado y permite al cliente calificarlo una sola vez con estrellas y comentario. El chat resuelve el nombre y la foto de la otra persona desde el trabajo, incluso al abrirlo desde Actividad, y ofrece acceso a la reseña cuando corresponde.
- Validación: tipado del móvil y la API, compilación de API, exportación iOS/Android y 17 pruebas de conversaciones y navegación. Un recorrido móvil en navegador con API simulada comprobó envío, error con borrador preservado, reintento, prevención de doble envío, recarga y permisos por cuenta.
- Evidencia: código de rutas de trabajos, conversación y actividad; contrato OpenAPI generado y pruebas automatizadas. El cambio de la API devuelve el estado real de reseña en el detalle del trabajo.
- Estado de publicación: disponible en desarrollo; no publicado en producción.

### 2026-10-28 — Fondo azul detrás de la barra de estado Android
- Resultado: la app móvil configura el área superior de Android con el mismo azul marino del encabezado y mantiene íconos claros. iOS no recibe cambios de color.
- Validación: prueba de configuración, typecheck móvil, evaluación de configuración Expo y revisión del diff. La confirmación visual en un dispositivo Android físico queda pendiente.
- Evidencia: `app.json`, configuración compartida de pestañas y prueba aislada de la barra de estado.
- Estado de publicación: disponible en desarrollo; no publicado.

## Resumen ejecutivo

Worky evolucionó desde una base de plataforma de oficios hacia una experiencia más completa, con cuentas persistentes, perfiles Partner, changas, chat, citas, reputación, notificaciones y dashboard operativo. Luego se consolidó una identidad visual consistente desde el login hasta las pantallas internas, se corrigieron detalles puntuales de composición y se añadieron auditorías responsive y pixel a pixel para reducir regresiones antes de publicar.

### 2026-10-29 — Presentación final de Worky
- Resultado: presentación final de diez diapositivas en español, con logo oficial del proyecto, visuales representativos y campos editables para autoría, institución y fecha. El contenido fue confirmado antes de construirlo.
- Alcance: explica los recorridos de cliente y profesional, la revisión documental, la coordinación, la arquitectura web/móvil y los límites verificados; no inventa métricas ni afirma pagos reales activos.
- Validación: `validate-slides` (10 diapositivas), TypeScript y build de producción aprobados; preview de portada revisado a 1920×1080 sin errores de consola. El build conserva una advertencia informativa por tamaño del bundle JavaScript.
- Evidencia: `artifacts/worky-presentacion-final/`; artefacto Worky — Presentación final.
- Estado: presentación disponible en el workspace; no se publicaron cambios de la plataforma ni se modificó la web, móvil o API.


### 2026-10-29 — Barra lateral fija en modo Cliente
- Resultado: barra lateral web fija en la altura de la ventana; el menú conserva accesibles sus enlaces sin desplazar el documento, y el panel móvil bloquea el scroll del fondo mientras está abierto. La invitación naranja para ofrecer servicios aparece solo en la vista Cliente cuando la consulta del perfil profesional terminó correctamente y no hay un perfil asociado.
- Validación: TypeScript, build y pruebas de cambio de rol pasaron; los tipos del mockup también pasaron y se revisó la barra a 322×876 y 1280×800. Web y API quedaron ejecutándose.
- Alcance y límite: no se tocaron roles reales ni la API. La captura de Worky muestra la pantalla de acceso porque el navegador de comprobación no tiene sesión iniciada; el panel autenticado se contrastó en el mockup aislado. La validación global sigue bloqueada por una prueba preexistente de asignación de rol admin, ajena a este cambio.


### 2026-10-29 — Mostrar y ocultar contraseñas
- Resultado: controles accesibles para mostrar/ocultar en inicio de sesión, registro, alta admin y contraseña actual usada para confirmar un cambio de email, en web y en los formularios móviles de acceso y registro. Los formularios explícitos de cambio y restablecimiento de contraseña siguen ocultos, como excepción solicitada.
- Validación: TypeScript y build web; TypeScript móvil y pruebas de cambio de contraseña; interacción automatizada confirmó alternancia entre `password` y `text` en acceso y confirmación de registro. Revisé también el campo de registro móvil a 402×874.
- Alcance: no se modificaron validaciones, endpoints ni cuentas.

### 2026-10-30 — Diagnóstico del ingreso desde la APK Android
- Resultado: la investigación de producción identificó una API publicada anterior a las rutas de ingreso móvil; ambas devuelven 404 en producción y 400 JSON con cuerpos vacíos en el código actual. Se agregó una prueba de enrutamiento para conservar esta comprobación.
- Validación: prueba aislada de las dos rutas, TypeScript y build de API aprobados. No se utilizaron cuentas reales ni se enviaron correos.
- Base de datos: se documentó el SQL pendiente de dos tablas de ingreso móvil y sus índices, separándolo del cambio previo de matrícula profesional; la comparación no indica eliminación de datos.
- Evidencia: `docs/diagnostico-ingreso-apk-2026-10-30.md` y `artifacts/api-server/test/worky-mobile-login-routing.test.ts`.
- Estado: pendiente de aprobación y publicación; no se modificaron producción, cuentas, contraseñas ni roles. Todavía no se afirma que el acceso desde el teléfono esté resuelto.
- Revisión previa solicitada: también pasó la prueba integral de dispositivos nuevos y reconocidos, vencimiento, bloqueo de intentos, reutilización y revocación. Usó cuentas sintéticas de desarrollo con limpieza y Gmail simulado, sin correos reales. La entrega real en producción sigue sin comprobarse; no hay autorización para publicar.
- Solicitud posterior: el usuario pidió actualizar tras la revisión. La comparación de esquemas se repitió y mantiene las mismas nueve operaciones, sin eliminación de datos. Se prepara la acción de publicación; no se afirma que producción ya esté actualizada ni se ejecutaron migraciones manuales.

### 2026-11-02 — Entrega de APK Android independiente
- Resultado: compilación release para ARM de 32 y 64 bits, con firma de prueba y JavaScript incluido, sin requerir Expo Go. Archivo entregado: `generated-artifacts/worky-android/worky-prueba-android.apk` (63.814.719 bytes).
- Validación: Gradle `assembleRelease` aprobado; firma APK v2 verificada con `apksigner`; comprobada la presencia del bundle y las bibliotecas nativas de ambas arquitecturas.
- API: las dos rutas publicadas de ingreso móvil responden HTTP 400 JSON a cuerpos vacíos, sin enviar correos ni modificar cuentas; ya no se reproduce el 404 anterior. No se probó el ingreso real en un dispositivo.
- Compilación: el primer intento se interrumpió por falta de memoria; el segundo terminó con límites de JVM reducidos y pausa temporal de la vista previa móvil. La vista previa volvió a quedar en ejecución.
- Alcance: APK de prueba, no publicación en Google Play. No se cambiaron cuentas, roles ni esquemas de producción.

### 2026-11-04 — Documentación final del proyecto Worky
- Resultado: se consolidaron los documentos históricos, el primer mockup, la bitácora, la planilla de testing y el estado técnico en una entrega final con portada, índice, evolución, arquitectura, recorridos, resultados, límites, referencias y próximos pasos. Se incorporaron los integrantes e institución confirmados; la fecha de entrega queda “a definir”.
- Entregables: `docs/entrega-final/Documento_Final_Worky.md` (fuente editable), `Documento_Final_Worky.docx` (Word), `Documento_Final_Worky.pdf` (PDF) y `Documento_Final_Worky.html` (fuente de impresión), con los recursos visuales en `docs/entrega-final/assets/`.
- Validación: PDF A4 de 15 páginas; comprobada la integridad del DOCX, sus imágenes y tablas, y la extracción de texto del PDF. Las figuras del primer mockup se identifican como ilustrativas. Se explicitan los 33 estados reportados por la planilla, la inconsistencia de sus pestañas y los límites de producción/pagos, sin presentar métricas no verificadas.
- Alcance: no se modificaron la aplicación, la base de datos, cuentas, roles ni producción.

### 2026-11-04 — Aceptar nombres habituales de oficios al publicar trabajos
- Resultado: la app móvil y la API convierten nombres como “albañil”, “plomero” y “electricista” a las categorías oficiales. Otros oficios se agrupan en “Otro” conservando el nombre específico en la descripción; el formulario informa cómo se clasificará. La misma normalización se aplica al perfil profesional, sus servicios y los filtros por categoría.
- Validación: prueba aislada del endpoint con una cuenta sintética confirmó “Albañil” → “Albañilería” y “Pintor” → “Otro” con el oficio preservado; 4 pruebas del normalizador, chequeo de tipos de API y móvil, compilación de la API y build APK aprobados. `/api/healthz` respondió `{"status":"ok"}`.
- APK: `generated-artifacts/worky-android/worky-prueba-android.apk`, independiente de Expo Go, firma de prueba y configurada para el API de desarrollo; no es una publicación de tienda ni apunta a producción.
- Validación ampliada: `test:privacy` pasó al corregir su cuenta sintética para que tuviera rol profesional. La validación integral avanzó hasta `test:visual`, pero excedió el límite de ejecución y queda sin resultado.
- Builds de publicación: el pre-build del proyecto y los builds de producción de API, web, app móvil web, presentación y video finalizaron correctamente. El APK de producción queda pendiente de la publicación aprobada por el usuario.
- Alcance: no se modificó el esquema de PostgreSQL, no se ejecutaron migraciones y no se publicó ni alteró producción.

### 2026-11-05 — Mejorar la acción de publicar y el contraste móvil
- Resultado: el formulario muestra “Publicar trabajo” como acción principal azul marino, con tilde y texto marfil, inmediatamente encima de “Cancelar”; ambos botones ocupan el mismo ancho y alto. Se aclararon textos de estados, avisos, navegación y otros elementos que antes usaban azul oscuro sobre superficies oscuras.
- Validación: chequeo de tipos móvil y prueba de navegador en modo oscuro aprobados; la prueba verificó color, contraste, orden y dimensiones iguales de los botones. La API publicada respondió correctamente en `/api/healthz`.
- APK: `generated-artifacts/worky-android/worky-prueba-android.apk`, 63.840.115 bytes, independiente de Expo Go, firma de prueba verificada y conectado a `https://workyoficios.replit.app`. Incluye bibliotecas ARM de 32 y 64 bits.
- Alcance: no se publicó una nueva versión ni se modificaron datos o esquema de producción. La instalación física en un dispositivo Android no se probó.
