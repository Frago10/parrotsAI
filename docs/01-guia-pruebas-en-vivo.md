# Guía de pruebas en vivo

Cómo usar el prototipo en tus llamadas reales y cómo convertir cada llamada en datos de backtesting.

## 1. Preparar el entorno

1. Copia `.env.example` a `.env` en la raíz y rellena:
   - `DATABASE_URL` (Postgres local).
   - `DEEPGRAM_API_KEY` y `STT_PROVIDER=deepgram` para transcripción real.
   - `ANTHROPIC_API_KEY` y `LLM_PROVIDER=anthropic` para respuestas reales.
   Sin claves, todo funciona en modo simulado (`fake`): útil para probar la interfaz, no para una llamada real.
2. `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev`.
3. Abre http://localhost:3000 en **Google Chrome de escritorio** (Safari, Firefox y móvil no capturan audio de pestaña).

## 2. Crear la sesión

- **Call Sessions → Crear sesión**. Empresa y título sirven como términos reforzados para el STT.
- **Modo**: Regular para reuniones y ventas; Interview para entrevistas (usa el CV marcado como default en Resumes).
- **Idioma**: el de la llamada. Si mezclas español e inglés, elige `Multilingüe (auto)`.
- **Modelo**: Claude Haiku 4.5 (rápido) es el default. Sonnet 5.5 y Opus 5.5 dan respuestas más elaboradas pero tardan más.
- **Instrucciones**: pega la descripción del puesto, el guion de la reunión, objetivos, tono y datos que quieras que la IA tenga a mano.
- **Sesión de prueba (backtesting)**: actívalo en las llamadas que quieras que yo reproduzca después.

## 3. Durante la llamada

1. Abre Meet/Teams/Zoom en una pestaña y CallPilot en otra.
2. En CallPilot, marca el consentimiento y pulsa **Compartir pestaña y empezar**.
3. En el diálogo de Chrome: pestaña **"Pestaña de Chrome"** (no Ventana ni Pantalla), elige la de la llamada y marca **"Compartir audio de la pestaña"**. Si el VU-meter de "Ellos" no se mueve, pulsa **Cambiar pestaña** y repite.
4. Usa **auriculares**: si tu micrófono capta el altavoz, tu voz aparece duplicada en el canal "Ellos".
5. Las preguntas detectadas aparecen arriba a la derecha; con Auto Answer activado la respuesta llega sola. Si el sistema no detectó una pregunta que sí lo era, pulsa **Answer** (Ctrl/Cmd+Enter): ese clic queda registrado como "pregunta perdida".
6. Marca cada respuesta con 👍 o 👎. Es el dato más valioso para el backtesting.
7. El chat (Ctrl/Cmd+K) acepta instrucciones en vivo: "más corto", "responde como senior", "dame 3 preguntas de cierre".
8. **Terminar** cierra la sesión y genera las notas en segundo plano.

## 4. Después de la llamada

- En la vista de la sesión: AI Notes, Transcripción (búsqueda y export), Ask AI y Detalles.
- **Exportar JSONL (backtesting)** descarga `data/sessions/<id>.jsonl` con transcripción, preguntas detectadas, respuestas, latencias y tu feedback.
- Copia ese archivo a `backtesting/datasets/sessions/` y súbelo al repo (o pásamelo). Yo lo reproduzco con `pnpm backtest` y comparo versiones del detector y de los prompts.

## 5. Qué mirar en el panel Debug

- **STT parcial / final**: latencia desde que termina la frase hasta que llega el texto. Objetivo: parcial < 300 ms.
- **1er token**: tiempo desde el fin de la pregunta hasta el primer fragmento de respuesta. Objetivo: < 1,2 s p50.
- **frames them/me**: si "them" no sube, la pestaña no está enviando audio.
- **ws**: estado de la conexión; se reconecta sola con backoff.

## 6. Problemas conocidos del prototipo

- PDF y DOCX todavía no se procesan: sube `.txt`/`.md` o pega el texto (fase 7).
- Screenshot descarga la captura pero aún no la analiza con visión (fase 6).
- Sin autenticación: un único usuario local. Créditos y planes son informativos (fase 15).
- OpenAI y Gemini aparecen en el catálogo pero usan el simulador hasta implementar sus proveedores.
