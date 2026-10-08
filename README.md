# El Peatón: Realidad Aumentada

Aplicación estática con HTML, JavaScript, A-Frame 1.5.0 y MindAR 1.2.5. Reconoce tres láminas y reproduce una sola escena con su audio incorporado. No necesita micrófono, base de datos ni frameworks adicionales.

## Requisitos Y Comandos

- Node.js >= 22.12; verificado con 22.14.0.
- pnpm 10.18.2. Usar exclusivamente pnpm para dependencias y scripts del proyecto.
- Cámara, WebGL y HTTPS de confianza en Chrome para Android o Safari para iPhone.
- Computadora y celulares en la misma red, sin aislamiento de clientes.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` sirve desarrollo HTTPS en `0.0.0.0:5173`. Requiere certificados externos como se explica abajo.

Para la actividad, detener desarrollo y ejecutar:

```powershell
pnpm build
pnpm start
```

`pnpm start` utiliza el servidor estático HTTPS de `scripts/serve.mjs`, sirve **solamente dist** y no utiliza el servidor de desarrollo. Abrir `https://<IPv4-DE-LA-PC>:5173`. `PORT` permite cambiar el puerto del servidor estático. `pnpm preview` sigue disponible para previsualización, no es el modo recomendado para la actividad. Los tres usan 5173 por defecto; no ejecutarlos a la vez.

Otros comandos:

```powershell
pnpm test
pnpm test:browser
pnpm media:audit
pnpm media:optimize
pnpm media:fade
pnpm media:verify-fade
pnpm vendor
```

`test:browser` requiere Edge en la ruta habitual de Windows o `BROWSER_PATH` con un ejecutable Chromium compatible. Lanza un perfil temporal, cámara simulada, WebGL software y un servidor de prueba **HTTP solo en localhost**, un contexto seguro de navegador. Cierra sus procesos y servidor al terminar. No habilita un modo HTTP para la actividad ni sustituye una prueba HTTPS por IP en celulares.

## HTTPS Y Certificados

Certificado y clave deben permanecer **fuera del proyecto/repositorio**, de `public` y de `dist`. La ubicación predeterminada es `../el-peaton-certs/cert.pem` y `../el-peaton-certs/key.pem`. La carpeta anterior `certs/` no se borró ni se distribuye, pero ya no es la ubicación utilizada.

Para usar otra ubicación externa, definir rutas absolutas antes de `pnpm dev` o `pnpm start`:

```powershell
$env:TLS_CERT = "C:\ruta-externa\cert.pem"
$env:TLS_KEY = "C:\ruta-externa\key.pem"
```

`pnpm build` y las pruebas unitarias no requieren certificados. Nunca se inicia HTTP como alternativa si falla HTTPS.

Con mkcert instalado, obtener la IPv4 real con `ipconfig`, verificar que el directorio padre exista y generar fuera del proyecto:

```powershell
mkcert -install
New-Item -ItemType Directory -Force -Path "..\el-peaton-certs"
mkcert -cert-file "..\el-peaton-certs\cert.pem" -key-file "..\el-peaton-certs\key.pem" localhost 127.0.0.1 <IPv4-DE-LA-PC>
mkcert -CAROOT
```

Cambiar el certificado si cambia la IP. Permitir el puerto de Node.js en el firewall de Windows solo en redes privadas.

Para equipos administrados que usan una CA local, instalar únicamente su certificado público `rootCA.pem` en los celulares, con autorización del responsable. En Android: configuración de seguridad, instalar certificado de CA. En iPhone: instalar perfil y habilitar confianza completa en Configuración > General > Información > Configuración de confianza de certificados. No distribuir `rootCA-key.pem` ni la clave del servidor. Quitar la confianza local cuando deje de necesitarse. Para una actividad abierta, es preferible un nombre y un certificado confiable gestionados por la institución; no depender de que los participantes omitan advertencias de seguridad.

## Inicio, Audio Y Seguimiento

1. La pantalla inicial prepara la escena sin solicitar cámara ni descargar videos.
2. Tocar **Comenzar experiencia con audio**. MindAR solicita solamente cámara, con `audio: false`.
3. Autorizar la cámara. La aplicación diferencia esta espera de la preparación posterior del reconocimiento.
4. Apuntar a una lámina. Solo entonces se asigna el `src` del video correspondiente.
5. Si el navegador bloquea `play()` con sonido, aparece una explicación y **Reproducir escena con audio**. Tocar este botón reproduce directamente desde una nueva interacción. No se aplica una reproducción silenciosa automática como sustituto.

El botón inicial establece sonido activo y aporta la interacción del usuario, pero **no garantiza autorización de los tres videos en todos los navegadores**. Cada `play()` se comprueba individualmente. Safari puede necesitar otro toque al cambiar de escena.

Se utiliza el audio incorporado del mismo video, con `muted = false` y `volume = 1`. El volumen físico del celular sigue siendo responsabilidad del usuario. **Silenciar sonido / Activar sonido** cambia el silencio sin separar pistas ni modificar el punto de reproducción. Al activar sonido, también se detecta un posible bloqueo del navegador.

Al cambiar de marcador se pausa primero la escena anterior, incluido su audio. Al perder el marcador se espera 750 ms antes de pausar. Se cancela esa pausa si reaparece; no se modifica `currentTime`. Al recuperar una escena continúa desde su posición anterior, incluso después de cambiar a otra. Se conservó el bucle de los videos originales; el reinicio al final natural del bucle es intencional.

La tolerancia puede probarse con `?tolerancia=500` o `?tolerancia=1000` (rango acotado a 500–1000 ms). **No mantiene visible el objeto**: MindAR oculta el target cuando pierde seguimiento. Durante esa breve tolerancia puede continuar el audio aunque el objeto no esté visible.

Pasar a segundo plano pausa inmediatamente todos los videos y su audio. Al volver, se intenta continuar la escena seguida; si el navegador exige una nueva interacción, se muestra el botón de audio.

Los elementos de video están fuera de `<a-assets>`, sin `src` inicial y con `preload="none"`. A-Frame no espera su descarga para iniciar la cámara. Cada `src` se asigna una vez y se mantiene el elemento y su buffer. `preload` es una sugerencia: un navegador puede seguir transfiriendo rangos de un video ya pausado o liberar su buffer por presión de memoria. No se fuerza `load()`, no se descarga previamente toda la actividad y no se promete que ningún byte vuelva a transferirse.

Estados con límite: preparación de escena 30 s, advertencia de espera de autorización/cámara 30 s, preparación posterior al permiso 45 s, carga o interrupción de video 20 s antes de ofrecer reintento. No hay un spinner indefinido. Volver a cargar evita iniciar MindAR varias veces sobre una misma escena.

## Correspondencia Y Recursos Locales

| Índice MindAR | Lámina | Video original |
|---|---|---|
| 0 | `marcador1.png` | `el_peaton1.mp4` |
| 1 | `marcador2.png` | `el_peaton2.mp4` |
| 2 | `marcador3.png` | `el_peaton3.mp4` |

Se conservan los índices del archivo `marcadores.mind`, los planos y las tres escenas. La altura de cada plano se ajusta a la proporción real de su recurso.

A-Frame y MindAR se sirven desde `public/vendor`, no desde CDN durante la actividad. `pnpm vendor` permite reconstruir las copias fijadas y verifica su SHA-256 contra `public/vendor/manifest.json`. Requiere Internet solamente para esa descarga; conserva los avisos de licencia de las distribuciones. Una prueba de navegador registra si aparecen solicitudes externas. La prueba realizada no observó ninguna; confirmar también en los celulares y la red de la actividad.

El build publica únicamente imágenes, `.mind`, bibliotecas y los tres videos seleccionados. `el_peaton.mp4` no se utiliza y no se copia a `dist`. Los originales permanecen en `public`.

## Fundido De Audio Y Sin VR

Las tres escenas utilizan `public/media/el_peaton1-fade-2s.mp4`, `el_peaton2-fade-2s.mp4` y `el_peaton3-fade-2s.mp4`. El audio incorporado desciende progresivamente durante los últimos **2 segundos**. No depende de modificar `video.volume` por JavaScript, una técnica que no es fiable en Safari iPhone. Se mantienen el control de silencio, las pausas y el bucle; cada vuelta aplica el mismo fundido.

Para regenerar o comprobar las copias:

```powershell
pnpm media:fade
pnpm media:verify-fade
pnpm build
```

FFmpeg se obtiene mediante la dependencia de desarrollo `@ffmpeg-installer/ffmpeg`, instalada exclusivamente con pnpm; no se sirve ni se carga en el celular. `FFMPEG` permite indicar un ejecutable externo. El script conserva los archivos de entrada, copia la imagen comprimida sin recodificar, procesa la misma pista de audio a AAC 256 kbps y agrega `faststart`. La duración puede variar menos de un paquete AAC al volver a codificar audio (14–17 ms en las copias actuales); el stream de video permanece idéntico y no se separan pistas de reproducción.

`docs/fade-report.json` registra hashes del video, duraciones y comparaciones de audio PCM: ganancia decreciente a lo largo del fundido. Esta comprobación no sustituye escuchar el final en el dispositivo real. Si existen copias 720p, el script toma esas como entrada; ejecutar nuevamente `media:fade` después de optimizar para no seguir usando fundidos de una versión anterior. Vite prioriza las copias con fundido y las selecciona en cada carga de página; no hace falta reiniciar la computadora.

VR está desactivado mediante `xr-mode-ui` (el nombre correcto en A-Frame 1.5), sin botones inmersivos, sin atajo `F` y sin entrada por `scene.enterVR()`. MindAR sigue utilizando la cámara normal, no una sesión WebXR inmersiva. `pnpm test:browser --url=https://10.0.9.89:5173/` permite verificar el servidor actual con cámara/detecciones simuladas, usando confianza real del certificado, sin omitir validación HTTPS.

## Videos Y Conversión Pendiente

`docs/media-report.json` contiene metadatos obtenidos leyendo solamente el contenedor MP4, sin decodificar ni convertir contenido. Los tres videos tienen H.264 y una pista AAC LC estéreo no vacía, a 48 kHz. Esto **no equivale a haber escuchado o validado la decodificación del audio**.

| Escena | Peso original | Duración | Resolución | FPS | Video | Audio | faststart |
|---|---:|---:|---|---:|---:|---:|---|
| 1 | 11,92 MiB | 62,438 s | 1080×1920 | 30 | 1340,7 kbps | 253,4 kbps | No |
| 2 | 10,38 MiB | 62,457 s | 1080×1920 | 30 | 1132,9 kbps | 253,4 kbps | No |
| 3 | 5,50 MiB | 29,797 s | 1080×1920 | 30 | 1289,6 kbps | 253,4 kbps | No |

El video 3 dura aproximadamente medio minuto. No se modificó su contenido para ajustarlo a un minuto. `marcadores.mind` pesa 1.836.475 bytes; las tres imágenes suman 2.339.070 bytes.

Los bitrates actuales de video ya están cerca del rango propuesto. Conviene evaluar primero **menor resolución para reducir trabajo de decodificación** y **faststart para no necesitar el índice del final del MP4**. No son pruebas de que expliquen por sí solos el spinner inicial.

FFmpeg ya está disponible como herramienta del proyecto, aunque no esté en el PATH del sistema. ffprobe sigue pendiente. **No se generaron copias 720p; sus pesos y calidad quedan pendientes.** Las copias con fundido mantienen la resolución original. Para optimizar usando el FFmpeg del proyecto (o un ejecutable externo indicado con `FFMPEG`):

```powershell
pnpm media:optimize
pnpm media:fade
pnpm media:audit
pnpm build
```

El script conserva los originales y genera `public/media/el_peaton1-720p.mp4`, `el_peaton2-720p.mp4` y `el_peaton3-720p.mp4`. Utiliza H.264, `yuv420p`, 30 FPS, video 1,2 Mbps con máximo 1,8 Mbps, AAC 128 kbps y `faststart`. Mantiene proporción vertical (720×1280 para los archivos actuales) sin ampliar videos pequeños. No elimina ni separa el audio; exige una pista de audio de entrada.

Al existir esas copias, volver a ejecutar `pnpm media:fade` para incorporar el fundido en la versión 720p. Vite selecciona las copias con fundido antes que las 720p sin fundido, tanto en desarrollo como en el siguiente build. Comparar calidad y claridad del audio antes de usarlas con participantes. El script comprueba disponibilidad antes de crear copias y elimina archivos parciales ante fallos.

Comando equivalente para una escena:

```powershell
ffmpeg -i public/el_peaton1.mp4 -map 0:v:0 -map 0:a:0 -vf "scale=w='trunc(iw*min(1,min(1280/iw,1280/ih))/2)*2':h='trunc(ih*min(1,min(1280/iw,1280/ih))/2)*2',fps=30" -c:v libx264 -preset medium -b:v 1200k -maxrate 1800k -bufsize 3600k -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart public/media/el_peaton1-720p.mp4
ffprobe -v error -show_format -show_streams -of json public/el_peaton1.mp4
```

Crear `public/media` antes del comando manual. Repetir para escenas 2 y 3. Como alternativa inicial sin pérdida, generar una copia con `-map 0 -c copy -movflags +faststart`; no reduce resolución ni peso significativamente. Ofrecer 480×854 solo si pruebas en celulares justifican la calidad y fluidez; no se generó ni se adoptó una variante 480p sin esas pruebas.

## Diagnóstico Y Mediciones

Abrir `https://<IP>:5173/?diagnostico=1`. La interfaz normal no muestra información técnica. El modo de diagnóstico muestra un panel y registra en consola:

- `arReady`, `arError`, `targetFound`, `targetLost`.
- `waiting`, `stalled`, `playing`, `pause`, `error` de cada video.
- Escena activa, `currentTime`, `readyState`, `networkState`, rangos del buffer y silencio.
- Errores de `play()`, incluido bloqueo de audio, y solicitud y primer cuadro de cada video.

En consola, `window.elPeatonDiagnostics.report()` devuelve el informe. El buffer de eventos se limita a 300 y el panel se actualiza cada 2 s, solamente en modo diagnóstico. Las métricas básicas se guardan también en modo normal. Comparar ambos modos si el propio registro afecta a un celular lento.

Las marcas están en milisegundos desde la navegación:

| Medida | Fuente / interpretación |
|---|---|
| Transferencia de bibliotecas y `.mind` | Resource Timing: comienzo, duración, bytes. No incluye toda la ejecución del JS. |
| Escena | Eventos `loaded` y `renderstart`; `sceneAfterLibraryTransferMs` estima preparación tras finalizar las transferencias de bibliotecas e incluye ejecución y assets de imagen. |
| Inicio de MindAR a `arReady` | `mindarStartToReadyMs`, desde el botón; incluye solicitud de cámara. |
| Autorización y disponibilidad de cámara | `permissionAndCameraAcquisitionMs`: desde `getUserMedia` hasta obtener el stream. No puede separar exactamente la decisión humana del arranque del dispositivo. |
| Inicialización después de obtener cámara | `postCameraInitializationMs`, no incluye espera de permiso. Incluye `.mind`, preparación del reconocimiento y calentamiento. |
| Primera detección | `readyToFirstTargetMs`; depende de cuándo se presenta la lámina, no solo del procesamiento. |
| Solicitud a primer cuadro | Restar `videoRequestMs[indice]` de `firstFrameMs[indice]`. Usa `requestVideoFrameCallback`; si falta, etiqueta `playing` como aproximación. |

## Servidor, Range Y Caché

El servidor reutilizado transmite archivos por streams con backpressure, responde a rangos simples (`206` y `Content-Range`), rechaza rangos inválidos (`416`), soporta `HEAD`, MIME y revalidación ETag. Comparte el cálculo de hash entre solicitudes mientras no cambie el archivo; no vuelve a leer el MP4 entero para cada rango o celular. La primera solicitud de un archivo todavía requiere calcular ese hash.

HTML usa `no-cache`; los recursos sin hash verificable usan `public, no-cache`, que **permite almacenar y reutilizar mediante revalidación**, no prohíbe la caché. Solo nombres con SHA-256 completo verificado en `assets`/`vendored` reciben `immutable`. Los nombres Vite cortos y las bibliotecas con versión conservan revalidación. Así no se impiden actualizaciones de `.mind`, imágenes o MP4 con el mismo nombre. Compilar y reiniciar el servidor antes de la actividad; evitar reconstruir `dist` mientras se usa.

Comprobar en el servidor real, usando la CA de confianza:

```powershell
curl.exe --cacert "<CAROOT>\rootCA.pem" -D - -o NUL -H "Range: bytes=0-1023" https://localhost:5173/media/el_peaton1-fade-2s.mp4
curl.exe --cacert "<CAROOT>\rootCA.pem" -I https://localhost:5173/marcadores.mind
```

Esperar `206`, `Content-Range: bytes 0-1023/<peso>` y `Content-Length: 1024` en la primera solicitud, con `Content-Type: video/mp4`. En Windows con CA local, curl puede necesitar `--ssl-revoke-best-effort` si no hay servicio de revocación; no utilizar `-k`. Verificar segunda visita y respuestas `304` de recursos revalidados en DevTools; algunos navegadores revalidan o solicitan rangos de otra manera. Las pruebas automáticas del handler ya cubren `206`, rangos abiertos/sufijo, `416`, MIME, `HEAD`, ETag y controles de rutas/TLS; la confianza y acceso desde celulares siguen pendientes.

## Prueba De La Actividad

1. Conectar la computadora por Ethernet al router/AP. Asegurar buena señal Wi-Fi, alimentación y desactivar suspensión e hibernación durante la actividad. Verificar que tampoco se suspenda la interfaz de red.
2. Probar 1 celular con caché vacía y luego una segunda visita. Anotar modelo, navegador, tiempos de permiso y postpermiso, `arReady`, primer cuadro y pausas.
3. Probar los MP4 directamente por HTTPS y luego en AR, con audio, en cada modelo de celular. No confundir tiempo de acercar la lámina con tiempo de inicialización.
4. Verificar las tres escenas, audio audible y sincronizado, ausencia de audio superpuesto, reanudación sin reinicio, control de sonido, recuperación del bloqueo de `play()` y pausa al cambiar de aplicación o bloquear pantalla.
5. Probar pérdidas de seguimiento breves y largas con tolerancias 500, 750 y 1000 ms. Revisar iluminación, reflejos, distancia y estabilidad de la lámina.
6. Escalar a 5, 10 y, si hay dispositivos, 20 celulares. Repetir caché vacía y segunda visita, una lámina compartida y varias copias de la misma lámina. Usar tanto Chrome Android como Safari iPhone.

Completar una fila por ejecución, sin inventar valores no medidos:

| Usuarios/modelo | Caché | Permiso+cámara ms | Postcámara ms | arReady total ms | Video/primer cuadro ms | Directo vs AR | Audio/pausas/seguimiento |
|---|---|---:|---:|---:|---|---|---|
| Pendiente | | | | | | | |

El reconocimiento se procesa en cada celular. Varios usuarios pueden apuntar al mismo marcador; no hay bloqueo compartido. Compilar no elimina límites de red. Los bitrates originales totales están cerca de 1,4–1,6 Mbps por reproducción: 20 descargas a ese ritmo representarían aproximadamente 28–32 Mbps antes de overhead y ráfagas de buffering, sin contar el arranque conjunto. Esto es una estimación de tráfico, **no una garantía de capacidad**.

Indicadores para separar causas:

- Transferencia: MP4 directo también falla; `waiting`/`stalled`, poco buffer, tiempos o throughput de solicitudes deficientes. Revisar Wi-Fi, AP, Ethernet y servidor.
- Seguimiento: `targetLost` frecuente aunque el video directo sea fluido; revisar lámina, iluminación y cámara. La tolerancia no recupera matrices de seguimiento.
- Procesamiento: MP4 directo fluido, AR entrecortado y buffer suficiente; revisar CPU/GPU, temperatura y resolución del video/cámara en ese celular.

## Resultados Y Pendientes

Consultar `docs/results.md`, `docs/media-report.json` y `docs/browser-smoke.json`. La entrega conserva los originales y no afirma soporte probado para 20 usuarios.

- Completado: reproducción controlada con audio, carga diferida, exclusión de escenas, tolerancia sin reinicios, diagnóstico y compilación.
- Completado: bibliotecas locales, integración del servidor estático HTTPS existente y pruebas automáticas de su handler.
- Completado: prueba de integración de escritorio con cámara y detecciones simuladas. No verificó sonido audible ni reconocimiento de láminas reales.
- Completado: tres copias con fundido incorporado de 2 s y faststart, video comprimido idéntico, audio PCM verificado y VR desactivado. Falta escuchar los finales en un celular.
- Pendiente: ffprobe, conversión 720p, pixel format y comparación visual/acústica antes/después.
- Verificado posteriormente en esta computadora: certificado externo para `10.0.9.89`, servidor HTTPS activo y respuestas `200`/`206` por IP. Pendiente: acceso desde otros equipos, confianza del certificado y permisos en cada celular. Consultar `docs/results.md`.
- Pendiente: Chrome Android/Safari iPhone, mediciones con caché vacía y segunda visita, y pruebas de carga con 1, 5, 10 y 20 celulares.
