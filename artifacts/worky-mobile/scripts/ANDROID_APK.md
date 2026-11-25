# APK de diagnóstico de Worky

Esta compilación incluye el JavaScript y los recursos en la APK. No depende de
Expo Go ni de Metro. Usa el mismo encabezado y las mismas dependencias que el
código actual; no sustituye la app por una web.

## Requisitos

- Dependencias del workspace instaladas con pnpm.
- JDK 17.
- Android SDK con `platform-tools`, Build Tools 37.0.0, plataforma Android 37,
  NDK 27.1.12297006 y CMake. Las versiones requeridas provienen de Expo/RN
  instalados; deben revisarse al actualizar el SDK.
- `ANDROID_HOME` y, si es necesario, `JAVA_HOME` configurados.
- `unzip` disponible.

## Compilar

Consultar primero la dirección publicada de la API. No usar una dirección de
desarrollo en una APK que deba funcionar sin el workspace.

```sh
WORKY_APK_TARGET=test \
WORKY_API_ORIGIN=https://DIRECCION-HTTPS-DE-PRUEBA \
  pnpm --filter @workspace/worky-mobile run build:apk
```

El resultado queda en
`generated-artifacts/worky-android/worky-prueba-android.apk`, fuera de Git y del
despliegue. La APK incluye ARM de 32 y 64 bits y se verifica con `apksigner`.
La carpeta nativa `android/` también es generada y no se versiona.

Para una instalación estable fuera del workspace, compilar explícitamente la
variante de producción contra su API HTTPS pública:

```sh
WORKY_APK_TARGET=production \
WORKY_API_ORIGIN=https://DIRECCION-PUBLICA-DE-LA-API \
  pnpm --filter @workspace/worky-mobile run build:apk
```

Esta variante usa las cuentas y los datos reales de producción. Conserva el
identificador y la firma de la APK de producción anterior y aumenta su versión
para que Android permita instalarla como actualización sin desinstalar la app.

## Alcance y seguridad

- Es una compilación **release con firma de prueba**, no una entrega para
  Google Play ni una firma de producción.
- La app necesita Internet para usar la API. Si se selecciona la API publicada,
  las operaciones usan cuentas y datos reales de ese servidor.
- Android puede solicitar permiso para instalar desde el navegador o gestor de
  archivos. Descargar e instalar únicamente la APK entregada por este proyecto.
- La prueba en Android no confirma el resultado de áreas seguras en iOS.
- Una diferencia respecto de Expo Go ayuda a investigar, pero por sí sola no
  prueba qué componente causó el error.
