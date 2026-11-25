# Worky — tutorial ilustrativo de uso

## Treatment
- **Promise:** mostrar, sin presentar datos de ejemplo como hechos, cómo una persona puede buscar o publicar trabajo, revisar un perfil, conversar y coordinar, seguir el estado, confirmar el pago antes del cierre y dejar una reseña después.
- **Identity:** conservar el formato y la identidad visual existente: 16:9; crema `#f9f6f0`, azul tinta `#17223a`, azul profundo `#203655`, naranja `#f58224`, amarillo `#f8c859`; Space Grotesk en titulares y DM Sans en interfaz.
- **Hero:** las pantallas ilustrativas de Worky y la línea naranja que conecta las decisiones del recorrido.
- **Motion:** revelados de interfaz con máscaras y escala, trazado de ruta, y transferencias por coincidencia de formas.
- **Arc:** necesidad de un oficio → elegir buscar o publicar → abrir un perfil → conversar y coordinar una visita → seguir el trabajo → confirmar el pago antes de cerrar → reseñar después.
- **Payoff:** el trazo naranja resuelve en el logo oficial y deja un resumen tutorial, no una promesa de servicio o pago.
- **Runtime:** 32 s, 7 escenas, 16:9. Se conservan duraciones, formato, audio y movimientos exitosos de las escenas no afectadas.
- **Alcance factual:** el recorrido completo es un escenario de uso ilustrativo; las pantallas, conversaciones y estados son ejemplos gráficos, no registros de usuarios ni operaciones reales. No mostrar nombres de personas, direcciones, distancias, puntuaciones, cantidades de reseñas, ni testimonios. La presencia de “pago confirmado” ilustra el paso que la persona debe completar antes de cerrar; no acredita una integración o validación de pago de punta a punta. No afirmar validación de Mercado Pago, email, producción ni métricas.

## Audio spec
- Runtime: 32 s.
- Music: conservar intacto el instrumental nu-disco / light funk ya aprobado, sin voz añadida.
- Playback file: `public/audio/bg_music.mp3`.
- Beat alignment: conservar el archivo, velocidad, volumen y sincronización existentes; no alterar audio en esta revisión.

## Timeline
| Shot | Time | Viewer focus | Motion event | Composition | Handoff |
|---|---:|---|---|---|---|
| 01 | 0–4s | Una pérdida y Worky | Gota y ripple revelan el recorrido | Macro de cañería, tipografía asimétrica | La gota pasa a marcador |
| 02 | 4–9s | Buscar o publicar trabajo | Dos rutas aparecen; publicación ilustrativa toma foco | Copia izquierda, interfaz de pedido derecha | Marcador pasa a búsqueda |
| 03 | 9–14s | Encontrar trabajo/profesionales | Búsqueda genérica reúne perfiles, sin datos personales | Mapa gráfico a la izquierda y rail de resultados a la derecha | Tarjeta de perfil abre |
| 04 | 14–19s | Abrir y revisar perfil | Secciones del perfil se enfocan una por una | Perfil editorial al centro | Acción de mensaje da paso al chat |
| 05 | 19–23s | Conversar y coordinar visita | Intercambio de ejemplo y coordinación sin hora inventada | Chat y tarjeta de visita | Aro de visita pasa al estado |
| 06 | 23–28s | Seguir, confirmar pago y reseñar | Estado progresa; confirmación previa al cierre; reseña posterior | Rail de trabajo sobre campo crema | Disco dorado resuelve al logo |
| 07 | 28–32s | Resumen de marca/tutorial | Logo y cierre de copy | Campo azul continuo y lockup oficial | Gota conecta con inicio |

## Shot-by-shot script

### Shot 01 / 0.00–4.00s / 4.00s — “¿Una pérdida?”
**Purpose:** Mantener el gancho doméstico y presentar Worky sin sugerir resultados garantizados.
**Exact content:** “PLIP.”, “¿Una pérdida?”, “Encontrá un plomero con Worky.”, etiqueta de marca “WORKY / OFICIOS” y una identificación persistente en las escenas del recorrido: “RECORRIDO ILUSTRATIVO · EJEMPLO DE USO”.
**Composition:** Se conserva la cañería macro sobre campo crema, la gota naranja y el titular abajo a la izquierda. La pequeña etiqueta ilustrativa ocupa un área segura en la franja superior. Sin rostros ni datos personales.
**Artistic idea:** La gota funciona como punto y portal: el recorrido de ejemplo aparece reflejado dentro de ella.
**Timed choreography:** 0.00–0.45s cae la gota y golpea dos ondas. 0.45–1.15s “PLIP.” aparece con impacto. 1.15–2.10s entra “¿Una pérdida?” con máscara y la línea naranja traza hacia abajo. 2.10–3.35s la interfaz diminuta se revela en el reflejo; aparece “Encontrá un plomero con Worky.”. 3.35–4.00s gota y línea se acercan al lente para ceder el paso al marcador de la siguiente escena.
**Transition contract:** La gota mantiene posición y color al transformarse en marcador del panel de publicación; el panel entrante y la línea naranja se revelan durante el empuje.
**Assets/technique:** Geometría SVG/CSS existente, grano y logo tipográfico existente; sin nueva imagen. Conservar la escena visualmente, añadir solo el rótulo ilustrativo.
**Sound intent:** Instrumental existente y aprobado; sin voz o cambios.

### Shot 02 / 4.00–9.00s / 5.00s — “Buscá o publicá.”
**Purpose:** Enseñar ambas formas de empezar: buscar un trabajo o publicar un pedido para recibir contactos.
**Exact content:** Titular “Buscá o publicá.”; ruta 1 “Buscar trabajo”; ruta 2 “Publicar un pedido”; ejemplo de formulario: “Plomería”, “Contá qué necesitás resolver”, “Sumá una descripción, fotos o ubicación”; control visual “Publicar pedido”; estado de demostración “Ejemplo de publicación”. Rótulo persistente “RECORRIDO ILUSTRATIVO · EJEMPLO DE USO”.
**Composition:** Se preserva el campo azul, la columna de copy izquierda y la interfaz de teléfono a la derecha. La elección de dos rutas precede a la vista de publicación. No aparece dirección de ejemplo ni otra ubicación específica.
**Artistic idea:** Un solo marcador naranja se bifurca en dos opciones de inicio y vuelve a reunirse en el formulario de publicación.
**Timed choreography:** 0.00–0.35s la gota de la toma anterior aterriza como pin. 0.35–1.15s el teléfono rota de frente y aparece el titular. 1.15–2.00s las dos opciones “Buscar trabajo” / “Publicar un pedido” se revelan en sucesión, sin simular navegación real. 2.00–3.25s se enfocan categoría, descripción y detalles opcionales en el formulario sin valor prefabricado. 3.25–4.25s el control visual “Publicar pedido” se marca y cambia a “Ejemplo de publicación”. 4.25–5.00s el pin abandona el teléfono y viaja hacia la búsqueda.
**Transition contract:** El marcador cruza hacia la escena siguiente y encaja en el centro del radio gráfico; la interfaz se contrae y revela resultados genéricos.
**Assets/technique:** DOM/CSS de interfaz y pin SVG/CSS existentes. No formularios reales, datos de prueba que parezcan reales ni afirmaciones sobre el backend.
**Sound intent:** Instrumental existente y aprobado, sin cambios.

### Shot 03 / 9.00–14.00s / 5.00s — “Encontrá una opción.”
**Purpose:** Mostrar cómo revisar resultados y abrir un perfil sin presentar profesionales, distancias, calificaciones o verificaciones ficticias.
**Exact content:** “Buscá trabajos o profesionales”; “Trabajos y perfiles de ejemplo”; tres tarjetas con el rótulo genérico “Perfil de plomería” y descriptores “Servicios · Descripción”, “Servicios · Experiencia” y “Servicios · Información”; tarjeta seleccionada con control visual “Ver perfil”. Rótulo persistente “RECORRIDO ILUSTRATIVO · EJEMPLO DE USO”.
**Composition:** Se mantiene el campo azul de búsqueda a la izquierda y los resultados en crema a la derecha. Las tarjetas no llevan nombre, iniciales, estrellas, reseñas, distancia, disponibilidad concreta ni sello de verificación; usan un ícono genérico de perfil.
**Artistic idea:** Una onda de búsqueda ordena tarjetas abstractas por relevancia visual y destaca una, sin implicar clasificación ni ranking real.
**Timed choreography:** 0.00–0.55s el pin aterriza y abre un círculo de búsqueda. 0.55–1.20s aparecen “Buscá trabajos o profesionales” y “Resultados de ejemplo”. 1.20–2.45s las tres tarjetas genéricas se ensamblan con distinta profundidad. 2.45–3.35s sus campos descriptivos aparecen uno a uno; no se dibujan badges de confianza o cifras. 3.35–4.20s una tarjeta adquiere foco por escala y borde, no por una puntuación. 4.20–5.00s el panel abre el perfil a través de un encuadre circular.
**Transition contract:** El contorno de la tarjeta elegida se expande hasta coincidir con el borde de la ficha de perfil; un giro suave revela la siguiente toma.
**Assets/technique:** Elementos CSS de mapa y resultados existentes, adaptados para etiquetas genéricas; sin mapa de proveedores ni datos reales.
**Sound intent:** Instrumental existente y aprobado, sin cambios.

### Shot 04 / 14.00–19.00s / 5.00s — “Abrí el perfil.”
**Purpose:** Explicar que la persona puede conocer servicios e información publicada en el perfil antes de iniciar una conversación.
**Exact content:** Titular “Abrí el perfil.”; perfil genérico “Profesional” / “Plomería” con ícono abstracto; secciones “Servicios”, “Info”, “Servicios”, “Descripción”, “Experiencia”; nota “Revisá la información que comparte el perfil. La información varía según cada profesional.”; control visual “Enviar mensaje”; guía “Podés conversar desde el chat asociado al trabajo.” Rótulo persistente “RECORRIDO ILUSTRATIVO · EJEMPLO DE USO”. No reseñas, testimonios, estrellas, cifras, nombres, iniciales, barrios ni etiquetas de verificación.
**Composition:** Se conserva el panel central claro sobre fondo azul, con margen editorial. El número decorativo y su puntuación se reemplazan por formas abstractas bajas de contraste. Las etiquetas llegan secuencialmente y dejan el panel legible.
**Artistic idea:** El perfil se abre como una ficha de trabajo: el marco enfoca cada sección y una línea naranja conduce al punto de contacto.
**Timed choreography:** 0.00–0.45s el círculo entrante se resuelve en el contorno del perfil. 0.45–1.20s el panel se revela, con “Profesional de plomería” como único título de perfil. 1.20–2.25s las secciones “Servicios” y “Descripción” aparecen por separado. 2.25–3.35s “Experiencia compartida por el profesional” se enmarca como campo editable/publicado, no como aval de Worky. 3.35–4.20s la línea naranja conecta ficha y acción “Enviar mensaje”. 4.20–5.00s el icono de mensaje se acerca al lente y se convierte en la burbuja de chat.
**Transition contract:** El icono de mensaje del perfil crece y empalma con el encabezado del chat; el panel sale por una máscara vertical mientras la conversación entra.
**Assets/technique:** DOM/CSS de perfil y formas ya existentes. Retirar valores de perfil, reseñas, estrellas y distintivos no respaldados.
**Sound intent:** Instrumental existente y aprobado, sin cambios.

### Shot 05 / 19.00–23.00s / 4.00s — “Conversá y coordiná.”
**Purpose:** Mostrar que el chat está asociado a la conversación del trabajo y sirve para acordar una visita antes de empezar.
**Exact content:** Encabezado “Chat del trabajo”; mensajes ilustrativos “Hola, vi tu pedido. ¿Podemos coordinar una visita?” / “Sí, conversemos el horario.”; texto “Acordá los detalles antes de empezar.”; tarjeta “Visita” / “A coordinar” con “Definan los detalles en la conversación.” y recordatorio “Coordinen los detalles”. Rótulo persistente “RECORRIDO ILUSTRATIVO · EJEMPLO DE USO”. Sin nombres, horas ni marcas de tiempo inventados, estado online o “visita confirmada”.
**Composition:** Se preserva el fondo azul, chat grande a la izquierda y tarjeta crema/amarilla a la derecha. El contenido se identifica como ejemplo y deja espacio para una lectura clara.
**Artistic idea:** El borde de la burbuja se pliega en una tarjeta de coordinación; la visita se plantea como resultado de la conversación, no como reserva real automática.
**Timed choreography:** 0.00–0.40s el icono entrante ancla el chat en pantalla. 0.40–1.25s el primer mensaje aparece como texto ilustrativo. 1.25–2.00s la respuesta entra desde el lado opuesto. 2.00–2.80s las burbujas se pliegan en la tarjeta “Visita a coordinar”. 2.80–3.45s el recordatorio “Acordá los detalles antes de empezar” queda legible. 3.45–4.00s el contorno circular de la tarjeta avanza hacia el siguiente rail de estados.
**Transition contract:** La tarjeta de visita gira a plano y su aro se convierte en el primer nodo del seguimiento del trabajo; el panel de chat pliega en una línea horizontal.
**Assets/technique:** DOM/CSS existente de chat y calendario; textos de ejemplo sin identidades, horarios ni timestamps.
**Sound intent:** Instrumental existente y aprobado, sin cambios.

### Shot 06 / 23.00–28.00s / 5.00s — “Seguí. Confirmá. Cerrá.”
**Purpose:** Enseñar el orden: seguimiento del trabajo, confirmar el pago antes del cierre y dejar una reseña después de finalizar.
**Exact content:** Titular “Seguí. Confirmá. Cerrá.”; etapas “Trabajo en curso” → “Trabajo realizado” → “Confirmá el pago” / “Pago confirmado”; tarjeta “ANTES DE CERRAR” que progresa de “Seguí el estado” a “Marcar pago confirmado” y, solo después, “Pago confirmado”; luego “Trabajo finalizado” y “Después de finalizar: reseñá tu experiencia”. Rótulo persistente “RECORRIDO ILUSTRATIVO · EJEMPLO DE USO”. No aparecen proveedores, métodos de pago, precios, saldos ni supuesta validación automática.
**Composition:** Se conserva el campo crema con el rail horizontal azul/naranja y la unión de cañería como motivo central. La tarjeta de recibo se sustituye por una tarjeta de acción/estado sin importe ni marca de proveedor. La reseña queda en un área posterior y separada de la confirmación.
**Artistic idea:** El tubo se endereza en una secuencia de estados; el nodo de pago permanece antes de la puerta de cierre, mientras las estrellas de reseña solo aparecen después de esa puerta.
**Timed choreography:** 0.00–0.50s el aro entrante se convierte en nodo de “Trabajo en curso”. 0.50–1.45s el motivo de cañería gira y el avance resalta “Trabajo realizado”. 1.45–2.55s aparece “Confirmá el pago antes de cerrar” con el control visual “Marcar pago confirmado”; el estado cambia a “Pago confirmado” como acción ilustrativa, sin indicador de procesamiento. 2.55–3.30s el paso de cierre se habilita visualmente y se lee “Trabajo finalizado”. 3.30–4.20s recién entonces aparecen las estrellas vacías y “Después, reseñá tu experiencia”. 4.20–5.00s una estrella gira en disco amarillo y empuja la composición hacia el cierre de marca.
**Transition contract:** El disco amarillo ocupa el área de marca del plano final; los paneles se retiran mediante escalas y máscaras coordinadas, mientras el campo azul de salida empieza a aparecer.
**Assets/technique:** Rail y unión SVG/CSS existentes; tarjeta de estado adaptada. El estado de pago es una indicación tutorial, no una afirmación de integración/procesamiento por Mercado Pago.
**Sound intent:** Instrumental existente y aprobado, sin cambios.

### Shot 07 / 28.00–32.00s / 4.00s — “Worky. El oficio que necesitás, más cerca.”
**Purpose:** Cerrar el tutorial en la identidad de Worky con un resumen fiel del flujo y sin CTA o promesas no solicitadas.
**Exact content:** Logo oficial sin alterar; “El oficio que necesitás, más cerca.”; resumen “Buscá o publicá. Abrí un perfil. Conversá y coordiná. Confirmá el pago antes de cerrar; reseñá después.”; pie “RECORRIDO ILUSTRATIVO · EJEMPLO DE USO”. Sin afirmaciones de disponibilidad, pagos procesados, métricas ni validaciones.
**Composition:** Conservar campo azul continuo, logo original y lockup existentes; ajustar únicamente copy y el rótulo ilustrativo a zonas seguras.
**Artistic idea:** Los pasos del recorrido se condensan en el trazo naranja que concluye en el símbolo de la marca.
**Timed choreography:** 0.00–0.35s disco amarillo llega y las piezas de interfaz se repliegan. 0.35–1.10s se revela el logo oficial sin recolor o redibujo. 1.10–1.80s entra el titular. 1.80–2.65s el resumen aparece en líneas cortas y legibles. 2.65–3.35s el lockup se asienta mientras la gota naranja recorre hacia la posición del primer cuadro. 3.35–4.00s gota y marca sostienen el empalme de loop sin campo vacío.
**Transition contract:** La gota final coincide en posición, escala y tono con la gota del primer cuadro; el loop reanuda su caída.
**Assets/technique:** Logo oficial importado existente, máscaras DOM y línea SVG/CSS ya disponibles.
**Sound intent:** El instrumental existente resuelve a 32 s; sin capas nuevas.

## Beat variety review
El montaje alterna gancho macro, bifurcación de flujo, mapa/resultados, ficha editorial, chat, rail de proceso y cierre de marca. Se preserva la paleta, el formato 16:9, las siete escenas, sus duraciones y el audio aprobado. Los datos y diálogos que quedan visibles se presentan como ejemplos; no hay identidades o métricas que puedan confundirse con perfiles reales. El recorrido separa pago y cierre y coloca reseña solo después. La última escena cambia de interfaz a lockup de marca y vuelve al gesto de apertura.
