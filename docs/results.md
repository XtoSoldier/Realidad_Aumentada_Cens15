# Diagnóstico, Cambios Y Resultados

## Causas Verificadas En El Código Original

- `index.html`, `<a-assets>`: tres MP4 con `src` inicial y `preload="auto"`. Competían por transferencia desde el arranque. A-Frame esperaba su buffer o el timeout predeterminado de 3 s, no un timeout de dos minutos.
- `index.html`, handlers `targetFound`/`targetLost`: asignaban `currentTime = 0` en detección y pérdida. Una fluctuación del seguimiento reiniciaba el video.
- `index.html`, atributos de video y JavaScript: audio forzado a silencio. No existían botón inicial con audio, control de sonido ni pausa explícita en segundo plano.
- `index.html`, `marcadoresActivos`: no había exclusión de reproducción entre escenas ni captura del rechazo de `play()` en el handler general de toques.
- Las bibliotecas dependían de dos servicios externos. Los MP4 tienen 1080×1920, 30 FPS e índice `moov` posterior a `mdat`, sin `faststart`.

El spinner original era de MindAR. Se ocultaba después de obtener cámara, cargar los targets, preparar el reconocimiento y emitir `arReady`. **No se demostró qué etapa provocaba los dos minutos observados**. Transferencia, permiso, calentamiento y procesamiento se deben medir por separado.

## Cambios Aplicados

- `index.html`: inicio explícito con audio, estados y controles, videos sin `src` y fuera de assets bloqueantes; MindAR sin autoinicio ni spinner propio; bibliotecas locales y asociaciones originales conservadas.
- `src/app.mjs`: un video activo, carga al detectar, `src` asignado una vez, pausas sin reinicios, tolerancia de pérdida cancelable 750 ms, audio del propio video, control de silencio, `play()` comprobado, botón de recuperación, pausa en segundo plano y protección frente a promesas tardías.
- `src/app.mjs`: observación del `getUserMedia` real de MindAR, marcas de cámara y `arReady`, Resource Timing, primer cuadro y eventos de video; estados con avisos/reintentos limitados en tiempo.
- `public/vendor` y `scripts/vendor.mjs`: mismas versiones A-Frame/MindAR, servidas localmente, con procedencia, pesos y SHA-256 en el manifest. Se mantuvo la carga clásica antes del parseo de `a-scene`: la prueba de integración detectó que `defer` introducía un error de registro de sistemas en A-Frame 1.5.
- `scripts/serve.mjs` y `scripts/tls.mjs`: reutilizados, no se creó un servidor equivalente. El hash de los archivos ahora se comparte entre solicitudes y se invalida al cambiar metadatos; no se lee el MP4 completo en cada rango. HTTPS, Range, MIME, revalidación y claves externas.
- `vite.config.mjs`: misma configuración TLS para desarrollo y preview; build sin certificados; selección de copias 720p si existen; distribución limitada a recursos utilizados.
- `scripts/media.mjs`: metadatos MP4 sin ffprobe, sin leer el contenido `mdat`, sin decodificar ni convertir.
- `scripts/optimize-media.mjs`: conversión reproducible pendiente, conserva originales y audio.
- `tests/playback.test.mjs`, `tests/server.test.mjs` y `scripts/browser-smoke.mjs`: pruebas de lógica, servidor e integración de escritorio.
- `package.json` y `README.md`: scripts exclusivamente pnpm y procedimiento de operación/prueba. No se agregaron dependencias ni frameworks.

## Comparación De Pesos Y Comportamiento

| Aspecto | Antes | Después |
|---|---|---|
| MP4 solicitados antes de detectar una lámina | Tres fuentes elegibles para precarga automática | Cero en la prueba de navegador; ningún `src` asignado |
| Peso de las tres escenas | 29.159.740 bytes (27,81 MiB) | Igual; conversión pendiente |
| Video adicional sin uso `el_peaton.mp4` | Vite lo copiaba como parte de `public` | No se distribuye; original de 11.890.634 bytes conservado |
| Bytes de MP4 distribuidos | 41.050.374 bytes (39,15 MiB), incluidos los no usados | 29.159.740 bytes (27,81 MiB), solo las tres escenas |
| Bibliotecas de AR | CDN, versiones 1.5.0/1.2.5 | Mismas versiones, 3.148.447 bytes locales; no se redujo su peso |
| Posición al perder/recuperar target | Reiniciada | Conservada, comprobada en lógica y navegador |
| Audio | Silenciado siempre | Activo salvo silencio elegido o bloqueo explicado; audibilidad física pendiente |
| Videos activos | Sin exclusión explícita en aplicación | Uno, verificado en pruebas |
| Datos de tiempos | Sin instrumentación | Marcas y reporte disponibles |

La disminución de recursos elegibles para descarga inicial no equivale a afirmar que antes todos se descargaban completos ni que el arranque ahora tarda un valor determinado en Wi-Fi. `preload` y el buffer dependen del navegador.

## Mediciones Locales De Referencia

Ejecución de referencia de `pnpm test:browser`: Edge headless en esta computadora, perfil temporal sin caché previa, WebGL software, cámara y autorización simuladas, HTTP localhost como contexto seguro, eventos de target sintetizados. `docs/browser-smoke.json` se actualiza con la última ejecución, cuyos valores pueden variar. Son mediciones de integración, **no un benchmark móvil ni una comparación válida con los dos minutos reportados**.

| Etapa | Medición de referencia |
|---|---:|
| Transferencia de A-Frame local | 200 ms |
| Transferencia de MindAR local | 549 ms |
| Transferencia de `marcadores.mind` | 131 ms |
| Render de escena después del fin de transferencias de bibliotecas | 747 ms |
| Botón / inicio de MindAR a `arReady` | 5840 ms |
| Solicitud de cámara a stream, simulados | 250 ms |
| Stream obtenido a `arReady` | 5588 ms |
| Solicitud de video 1 a primer cuadro | 2587 ms |
| Solicitud de video 2 a primer cuadro | 1665 ms |
| Solicitud de video 3 a primer cuadro | 1381 ms |

El primer `targetFound` se emitió por el script 365 ms después de `arReady`: **no mide detección de una lámina real**. La preparación posterior a la cámara incluye transferencia de `.mind`, metadata de cámara, controlador y calentamiento de GPU. La diferencia pequeña entre intervalos se debe a marcas/eventos distintos y al registro de diagnóstico.

| Comparación en celulares | Antes | Después |
|---|---|---|
| Spinner / arranque | Aproximadamente 2 minutos, observación del usuario no instrumentada | Pendiente de medición en el mismo dispositivo/red |
| Caché vacía frente a segunda visita | Pendiente | Pendiente |
| MP4 directo frente a AR | Pendiente | Pendiente |
| 1, 5, 10 y 20 usuarios | No comprobado | No comprobado |

## Verificación Realizada

- `pnpm build`: compilación correcta; distribución revisada sin el MP4 extra ni certificados.
- `pnpm test`: 23 pruebas aprobadas. Incluyen fuentes diferidas, exclusión, audio/rechazo/reintento, pérdida breve/larga, posiciones, promesas tardías, segundo plano, Range 206/416, HEAD, MIME, ETag, cambio de contenido, digest compartido, traversal y ubicaciones de credenciales.
- `pnpm test:browser`: pasó. No solicitó MP4 antes de detección, llegó a `arReady`, recibió cuadros de las tres escenas, no reinició al recuperar, reprodujo solo una, cambió silencio y pausó en segundo plano. No observó solicitudes HTTP externas. Se cerraron navegador y servidor temporales.
- `pnpm media:audit`: tres pistas AAC LC no vacías y metadatos de H.264 confirmados por lectura de contenedor. No se decodificó ni escuchó audio.
- `pnpm media:optimize`: detectó ausencia de FFmpeg y salió con un aviso sin modificar videos. No cuenta como conversión completada.
- Activación HTTPS posterior: certificado generado con mkcert para `localhost`, `127.0.0.1` y `10.0.9.89` en `../el-peaton-certs`, fuera del proyecto. `pnpm start` iniciado; comprobados `200` para HTML y `206` con `Content-Range: bytes 0-1023/12500855` para el video 1 por HTTPS usando la IP desde esta computadora. También se verificó confianza del sistema en localhost. curl/Schannel necesitó `--ssl-revoke-best-effort` porque esta CA local no publica información de revocación; se mantuvieron las comprobaciones de confianza, vigencia y nombre, sin `-k`. No se cambiaron las reglas existentes del firewall ni el perfil de red. Esto no verifica acceso desde otro dispositivo.

## Pendientes Explícitos

- ffprobe y comparación visual/acústica en celulares; copias 720p y nuevos pesos. FFmpeg ya se obtuvo posteriormente con pnpm; las copias con fundido y faststart están completadas, como se describe abajo. Variante 480p solo si las pruebas lo justifican.
- Confianza del certificado y handshake HTTPS desde los celulares; acceso por Wi-Fi y solicitudes parciales desde esos equipos. La configuración externa y el handshake por IP desde la computadora ya fueron verificados.
- Chrome Android y Safari iPhone: sonido audible y sincronizado de las tres escenas, gestos por escena, recuperación del bloqueo, volumen físico, pausas y cambios sin superposición, segundo plano y regreso.
- Láminas reales: correspondencia/detección y estabilidad del seguimiento, tolerancia 500–1000 ms y ausencia de reinicios involuntarios. La tolerancia no mantiene visible el target.
- Medición antes/después comparable con caché vacía/segunda visita y MP4 directo/AR, por modelo de celular.
- Pruebas progresivas con 1, 5, 10 y 20 dispositivos, una lámina compartida y varias copias. No hay soporte de 20 usuarios certificado por estas pruebas locales.

## Actualización: Fundido De 2 Segundos Y Sin VR

Aplicados fundidos lineales al audio de las tres escenas, incorporados en copias nuevas. Los archivos de entrada se conservaron y el stream H.264 comprimido es idéntico, verificado con SHA-256 de los paquetes de video. El audio sigue siendo la pista incorporada del MP4; no se usa un volumen JavaScript para simular el efecto. Se mantiene AAC estéreo a 48 kHz, con objetivo 256 kbps y faststart.

| Escena | Archivo usado | Inicio del fundido | Peso generado | Duración generada |
|---|---|---:|---:|---:|
| 1 | `media/el_peaton1-fade-2s.mp4` | 60,438 s | 12.469.322 bytes | 62,421 s |
| 2 | `media/el_peaton2-fade-2s.mp4` | 60,457 s | 10.905.097 bytes | 62,443 s |
| 3 | `media/el_peaton3-fade-2s.mp4` | 27,797 s | 5.783.237 bytes | 29,781 s |

La variación de 14–17 ms al volver a codificar AAC es menor que un paquete de audio; el video no fue cortado ni recodificado. Las comparaciones de ventanas PCM al principio, mitad y final del fundido muestran ganancias aproximadas de 0,82, 0,47–0,52 y 0,09–0,11 respecto al mismo segmento original. `docs/fade-report.json` contiene hashes y valores completos. `pnpm media:verify-fade` comprueba video intacto, duración, faststart, decodificación y ganancia decreciente; pasó para las tres escenas. La comprobación de audibilidad/calidad en celulares sigue pendiente.

Se reemplazó el atributo obsoleto `vr-mode-ui` por `xr-mode-ui` desactivado, se deshabilitaron atajos de teclado y se bloqueó la entrada inmersiva de la escena. No se modificó el reconocimiento de MindAR. La prueba de navegador comprueba ausencia de botones inmersivos, que llamar `enterVR()` o presionar `F` no active VR y que WebXR del renderer siga deshabilitado, mientras `arReady` y los tres videos funcionan.

FFmpeg se obtuvo con `@ffmpeg-installer/ffmpeg` como dependencia de desarrollo y pnpm; no se incluye en la distribución ni en el navegador. No se generaron copias 720p en este cambio: la imagen sigue a resolución original. Después de generar las copias se compiló `dist` y se ejecutaron las 23 pruebas de regresión con éxito.

`pnpm test:browser --url=https://10.0.9.89:5173/` pasó usando el HTTPS real y su certificado confiable, con cámara y detecciones simuladas. Confirmó que las tres fuentes activas son los archivos con fundido y que no hay VR. El puerto 5173 estaba ocupado por el servidor Vite del usuario (PID 17216); se lo conservó, sin iniciar un segundo servidor ni reiniciar la computadora. Recargar la página selecciona las copias nuevas; para usar la distribución estática sigue disponible el procedimiento `pnpm build` / `pnpm start` cuando se detenga desarrollo.
