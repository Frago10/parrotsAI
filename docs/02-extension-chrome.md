# Extensión de Chrome: lector de pantalla inteligente

CallPilot ahora también vive en un panel lateral de Chrome. Además de escuchar una llamada, **lee lo que hay en la pantalla** (texto de la página + captura) y te da respuestas sobre eso, en cualquier página web.

## Qué hace

| Función                        | Cómo se activa                                                                                                             | Qué envía al servidor                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Leer pantalla**              | Botón 👁, atajo `Alt+Shift+R` o clic derecho → "CallPilot: leer esta pantalla"                                              | Captura del área visible + texto visible, formularios, tablas, código e imágenes (alt) |
| **Preguntar sobre lo que ves** | Escribe en el panel y Enter, o usa los chips (Responder preguntas, Resumir, Error/código, Redactar, Traducir)              | Lo mismo + tu pregunta                                                                 |
| **Texto seleccionado**         | Selecciona texto → clic derecho → "CallPilot: preguntar sobre …"                                                           | El texto seleccionado + la página                                                      |
| **Auto-lectura**               | Casilla "Auto-lectura"                                                                                                     | Lee sola cuando la pantalla cambia y se estabiliza (tope de 4 lecturas por minuto)     |
| **Página completa**            | Casilla "Página completa"                                                                                                  | Además, el texto de toda la página (hasta 36.000 caracteres)                           |
| **Escuchar pestaña**           | Botón 🎧 (elige la pestaña y marca "Compartir audio") o `Alt+Shift+A` / clic derecho → "escuchar el audio de esta pestaña" | Audio de la pestaña transcrito en vivo                                                 |
| **Micrófono**                  | Botón 🎙                                                                                                                    | Tu voz transcrita (canal "Tú")                                                         |
| **Answer / Auto Answer**       | Botón ⚡ o `Ctrl/Cmd+Enter`                                                                                                | Responde a la última pregunta detectada en la llamada                                  |

El lector y el audio se combinan: si hay una llamada en curso, el modelo recibe también los últimos 90 segundos de transcripción junto con la pantalla.

## Instalar (modo desarrollador)

Requisitos: Chrome 116 o superior, y el servidor corriendo (`pnpm dev`, ver `README.md`).

```bash
pnpm install
pnpm ext:build          # genera apps/extension/dist
```

1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Pulsa **Cargar descomprimida** y elige la carpeta `apps/extension/dist`.
3. Fija el icono 🦜 en la barra de Chrome. Al pulsarlo se abre el panel lateral.

Para guardar un `.zip` (por ejemplo para pasarlo a otra máquina): `pnpm ext:pack` crea `apps/extension/callpilot-extension-<versión>.zip`. Para desarrollar con recarga: `pnpm ext:dev` y pulsa "Recargar" en `chrome://extensions` tras cada build.

## Primer uso (5 minutos)

1. Arranca el servidor: `pnpm dev`. Con `STT_PROVIDER=fake` y `LLM_PROVIDER=fake` en `.env` todo funciona con respuestas simuladas; con claves reales (`ANTHROPIC_API_KEY`, y `DEEPGRAM_API_KEY` para audio) las respuestas son de verdad.
2. Abre cualquier página web (un quiz, documentación, un correo, un panel).
3. Abre el panel y pulsa **👁 Leer pantalla**. La primera vez se crea una sesión rápida automáticamente.
4. En ⚙ puedes cambiar el servidor, el idioma, el modelo, las instrucciones para la IA (quién eres, tono, datos útiles) y los dominios bloqueados.
5. Marca 👍/👎 en cada respuesta: queda en el registro JSONL de la sesión y alimenta el backtesting.

Cada lectura queda registrada en `data/sessions/<id>.jsonl` como `screen.context` (URL, título, tamaño del texto, si llevó captura y el disparador). Se puede reproducir y medir con `pnpm backtest`.

## Qué lee y qué nunca lee

- Lee solo lo **visible**: texto en el viewport (más el de toda la página si lo pides), campos de formulario visibles con su valor, tablas, bloques de código, texto alternativo de imágenes, shadow DOM abierto e iframes.
- **Nunca** lee: contraseñas, campos ocultos, botones, elementos con `display:none`, `visibility:hidden` u opacidad 0.
- **No funciona** en `chrome://`, la Chrome Web Store ni el visor interno de PDF (Chrome lo impide). En un PDF abierto en el navegador no hay texto en el DOM: usa la captura.
- **Dominios bloqueados** (⚙): en esos sitios no se lee ni se captura nada. Ponlos para banca, correo, salud, etc.
- La captura puede contener cosas sensibles que se ven en pantalla. Desmarca "Captura" si solo quieres enviar texto.
- El texto de la página se trata como **datos, nunca como instrucciones** para el modelo: el prompt le ordena ignorar cualquier texto de la página que intente cambiar su comportamiento. Es una mitigación, no una garantía.

## Seguridad del servidor

El servidor realtime solo acepta conexiones del navegador desde `localhost`, desde extensiones de Chrome y desde los orígenes que añadas en `ALLOWED_ORIGINS` (por ejemplo `https://app.midominio.com` o `*.midominio.com`). Una página web cualquiera no puede abrir el WebSocket ni usar la API. Si lo expones a internet, añade autenticación antes: hoy hay un solo usuario local.

## Uso responsable

CallPilot es una herramienta visible: el panel está a la vista y no oculta nada de lo que hace. Úsala en sitios y conversaciones donde la asistencia de IA está permitida o informada (trabajo, estudio libre, pruebas de tu propio software, práctica). No está pensada para evaluaciones o exámenes donde se prohíbe la ayuda externa, y no incluye ningún modo para ocultarse de plataformas de evaluación. El audio de llamadas pide confirmar el consentimiento de los participantes antes de empezar.

## Qué probar en distintas páginas

| Tipo de página                            | Qué esperar                                                                      | Notas                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Quiz o formulario de práctica             | Detecta las preguntas visibles y las responde; ve opciones y la que está marcada | Para preguntas bajo el scroll, desplázate y vuelve a leer  |
| Documentación o artículo                  | Resumen y respuestas sobre el contenido visible                                  | Marca "Página completa" para artículos largos              |
| Error, stack trace o código en línea      | Causa y arreglo; lee bloques `pre` y editores tipo CodeMirror/Monaco             | Monaco solo expone las líneas renderizadas                 |
| Correo o chat                             | Propone una respuesta al mensaje visible                                         | Añade dominios sensibles a la lista de bloqueo             |
| Dashboard con tablas y gráficos           | Lee las tablas; los gráficos los interpreta con la captura                       | Con "Captura" desmarcada no ve los gráficos                |
| Google Docs/Sheets, Figma, apps en canvas | El texto del DOM es parcial                                                      | Funciona sobre todo por la captura                         |
| YouTube, Meet, Teams                      | La pantalla se lee igual; para el audio usa 🎧                                   | Usa auriculares para que tu micrófono no duplique el audio |

## Qué está probado y qué falta por probar en tu Chrome

Probado de forma automática (Chromium con la extensión cargada, servidor con proveedores simulados): el lector sobre HTML real, la inyección en pestañas e iframes, la captura de la pestaña, el envío al servidor, las respuestas en el panel, la auto-lectura, los dominios bloqueados y el rechazo de orígenes externos.

**No se pudo probar en este entorno** y conviene que lo verifiques tú en la primera sesión:

1. Abrir el panel lateral con el icono (la automatización lo abre como ventana).
2. 🎧 Pestaña (selector de Chrome dentro del panel) y el atajo `Alt+Shift+A` con `tabCapture`.
3. 🎙 Micrófono: si Chrome no muestra el aviso en el panel, se abre una pestaña para concederlo una sola vez.
4. Respuestas reales con claves de Anthropic y Deepgram (hasta ahora solo simuladas).
5. Que `Alt+Shift+R` y `Alt+Shift+A` no choquen con otros atajos tuyos (`chrome://extensions/shortcuts`).

## Costo aproximado

Estimación, no medida: una lectura con captura (imagen de ~1.500 tokens + 2.000–4.000 de texto + ~400 de salida) con Claude Haiku 4.5 ronda 0,01 USD. La auto-lectura está limitada a 4 por minuto, así que el peor caso ronda 1,5–2 USD por hora de uso continuo. Con Sonnet 5.5 sube a unas 2–3 veces eso. Cada respuesta guarda tokens y latencia en el registro de la sesión para medirlo de verdad.

## Problemas frecuentes

- **"El servidor responde, pero no puede usar la base de datos"**: Postgres no está corriendo o `DATABASE_URL` en `.env` es incorrecta. Arranca Postgres, ejecuta `pnpm db:migrate` y reabre el panel. `http://localhost:4001/health` muestra el error exacto en el campo `db`.
- **Punto rojo / "No hay conexión con el servidor"**: arranca `pnpm dev` o corrige la URL en ⚙ (por defecto `http://localhost:4001`).
- **"Chrome no deja leer esta página"**: es una página interna o protegida; abre una web normal.
- **No capturó la imagen**: la pestaña no estaba visible. Se usa solo el texto y se avisa.
- **La respuesta dice "usa el simulador"**: falta la clave o `LLM_PROVIDER=fake`; pon `ANTHROPIC_API_KEY` y `LLM_PROVIDER=anthropic` en `.env` y reinicia.
- **El audio de la pestaña se silenció al usar `Alt+Shift+A`**: es normal en `tabCapture`; CallPilot lo devuelve a los altavoces, pero si no lo oyes pulsa 🎧 de nuevo y usa el selector de Chrome.
