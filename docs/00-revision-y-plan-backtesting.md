# Revisión del proyecto CallPilot y plan de backtesting

Fecha: 2026-10-01. Base: `prompt_replica_copiloto_llamadas.md` (Partes A y B, fases 0 a 18).

## 1. Estado real al día de hoy

- El repo `parrotsAI` está vacío: solo tiene un `README.md` con el nombre. No hay código de ninguna fase.
- El entorno de esta sesión tiene Node 22, pnpm 10, Python 3.11 y ffmpeg. Sirve para construir y para backtesting offline.
- No hay ninguna clave de API configurada (OpenAI, Anthropic, Google, Deepgram, AssemblyAI).
- La política de red del entorno bloquea `api.openai.com`, `api.deepgram.com` y `api.assemblyai.com`. `api.anthropic.com` sí es alcanzable (falta la clave).

Consecuencia: puedo construir todo el código y hacer backtesting determinista (sin proveedores), pero no puedo probar STT ni LLM reales desde aquí hasta que se añadan claves y hosts permitidos (ver sección 7).

## 2. Dudas que cambian el trabajo (necesito tu respuesta)

1. **Idiomas de tus llamadas reales.** El doc pide 50+ idiomas, pero para uso personal importa cuáles usas tú. Asumo español e inglés, con llamadas mezcladas (spanglish técnico). Esto define el STT (Nova-3 multilingüe vs monolingüe) y el dataset de backtesting.
2. **Tipo de llamada que vas a probar primero.** ¿Entrevistas (modo INTERVIEW con CV) o reuniones/ventas (modo REGULAR)? Afecta qué prompt y qué dataset priorizo.
3. **Plataforma de la llamada.** ¿Google Meet en Chrome, Teams/Zoom nativos en escritorio, o teléfono? Si es Meet/Teams web en Chrome, la Fase 3.1 basta y la app de escritorio (3.2 y 12) se pospone.
4. **Sistema operativo.** Si usas macOS, la captura de audio del sistema (Fase 3.2) es la parte más dura del proyecto. En Chrome con "compartir pestaña + audio" funciona igual en Windows, macOS y Linux.
5. **Proveedor LLM principal.** El doc lista OpenAI, Anthropic y Google. Para el MVP recomiendo un solo proveedor con dos modelos (rápido y detallado) y añadir el resto después. ¿Cuál tienes clave?
6. **Guardado de audio.** El doc dice que el audio nunca se guarda. Para backtesting serio necesito grabaciones de tus llamadas de prueba (solo con consentimiento de la otra parte, o llamadas simuladas). Propongo un toggle "Guardar audio para evaluación" apagado por defecto.

Si no respondes, construyo con estos defaults: es/en, modo REGULAR primero, Google Meet en Chrome, un proveedor LLM, audio guardado solo en sesiones marcadas como "de prueba".

## 3. Recomendaciones de alcance para uso personal

El doc describe un producto comercial completo. Para "uso personal primero, comercializar después" propongo recortar así:

**Construir ahora (MVP personal, 2 a 3 semanas):**
- Fase 0 (monorepo simplificado), Fase 1 (modelo de datos), Fase 2 (lista de sesiones, sin paginación compleja).
- Fase 3.1 (captura por pestaña en Chrome) y Fase 4 (STT streaming).
- Fase 5 (detección de preguntas + Auto Answer), Fase 8 (chat manual), Fase 9 (pantalla en vivo).
- Fase 10 (notas post-llamada).
- Panel de debug con latencias y un exportador de sesión en JSONL (base del backtesting).

**Posponer o eliminar hasta comercializar:**
- Auth multiusuario, Stripe, créditos, planes, Pricing, Landing (fases 15 y 17). Para uso personal: un solo usuario local y contador de minutos informativo.
- Electron (3.2 y 12), bot Recall.ai y calendario (11), Mock Interview (13), herramientas Prepare (14), Headshots.
- Sentry, BullMQ/Redis. Las notas post-llamada pueden correr en el mismo proceso al principio.
- Blocklist, páginas legales (16) se dejan como tabla vacía y texto de consentimiento en la UI.

Esto reduce el MVP a: Next.js + servidor realtime + Postgres (o SQLite para arrancar) + un STT + un LLM.

## 4. Riesgos técnicos que el doc subestima

1. **Captura de audio de pestaña en Chrome.** `getDisplayMedia` con audio solo funciona si el usuario elige "Pestaña de Chrome" y marca "Compartir audio de la pestaña". Si elige "Ventana" o "Pantalla completa", en macOS no llega audio. Hay que validar la pista de audio y guiar al usuario; está contemplado en el doc, pero conviene asumir que fallará en el primer intento y diseñar el reintento.
2. **Eco y doble transcripción.** El canal "them" (pestaña) incluye tu propia voz si Meet la devuelve, y el micrófono "me" puede captar el altavoz. Hay que probar con auriculares y medir cuánto texto se duplica entre canales. Es el primer backtest que haré con tus grabaciones.
3. **Detección de preguntas en español.** Los STT en streaming suelen omitir el signo de apertura y a veces el de cierre. La heurística debe apoyarse más en palabras interrogativas y en entonación de la frase que en el símbolo. Un clasificador LLM con debounce de 600 ms añade latencia; propongo medir precisión/recall de la heurística sola antes de pagar la llamada extra.
4. **Latencia total.** Audio a texto parcial < 300 ms y primer token < 1.2 s son metas razonables, pero la respuesta completa de 5 viñetas tarda 3 a 6 s. Para leer en voz alta hay que mostrar el streaming desde el primer token y poner la "idea central" primero. La estructura de salida del doc ya lo hace bien.
5. **Prisma 7 y pgvector.** Prisma soporta `Unsupported("vector(1536)")` pero no índices HNSW ni búsqueda vectorial nativas; se hacen con SQL crudo. Alternativa más simple para RAG personal: tabla `DocumentChunk` con `tsvector` (BM25) primero y vector después.
6. **Fin de turno (utterance end).** Deepgram y AssemblyAI lo reportan de forma distinta. La abstracción `SttProvider` debe normalizar `transcript.partial`, `transcript.final` y `utterance.end` para que el detector de preguntas no dependa del proveedor.

## 5. Entregables previos a la Fase 0 (los pide el doc)

### 5.1 Árbol de carpetas propuesto (versión MVP personal)

```
parrotsAI/
├── apps/
│   ├── web/                 # Next.js 16, App Router, Tailwind 4, shadcn/ui, next-intl
│   │   ├── app/(workspace)/sessions/
│   │   ├── app/(workspace)/sessions/[id]/live/
│   │   ├── app/(workspace)/sessions/[id]/notes/
│   │   ├── components/
│   │   └── lib/audio/       # AudioWorklet, getDisplayMedia, VU-meter, cliente WS
│   └── realtime/            # Fastify 5 + ws: pipeline audio -> STT -> detector -> LLM
│       ├── src/stt/         # SttProvider: deepgram.ts, assemblyai.ts, fake.ts (backtesting)
│       ├── src/pipeline/    # questionDetector.ts, answerer.ts, sessionState.ts
│       └── src/ws/          # protocolo de mensajes (Zod)
├── packages/
│   ├── db/                  # Prisma + Postgres (schema, migraciones, seed)
│   ├── ai/                  # LlmProvider: anthropic.ts, openai.ts, google.ts, fake.ts; catálogo models.json
│   └── shared/              # tipos, esquemas Zod, prompts versionados (prompts/v1/*.md), i18n
├── backtesting/             # harness determinista (ver sección 6)
│   ├── datasets/            # utterances es/en etiquetadas, transcripciones de llamadas
│   ├── fixtures/audio/      # WAV 16 kHz con preguntas conocidas (cuando haya grabaciones)
│   ├── replay/              # reproduce un JSONL de sesión contra el pipeline
│   └── reports/             # métricas por corrida (precisión, recall, latencias, costo)
├── docs/
├── .env.example
├── package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json
└── README.md
```

### 5.2 Dependencias con versión (publicadas en npm al 2026-10-01)

| Paquete | Versión | Uso |
|---|---|---|
| next / react | 16.3.8 / 19.3.0 | app web |
| typescript | 7.0.2 | todo el monorepo (strict) |
| tailwindcss | 4.3.3 | estilos |
| next-intl | 4.14.8 | i18n es/en |
| prisma / @prisma/client | 7.10.0 (estable; 8 está en RC) | ORM |
| fastify / @fastify/websocket / ws | 5.12.5 / 11.3.1 / 8.22.0 | servidor realtime |
| zod | 4.6.5 | validación y protocolo WS |
| @anthropic-ai/sdk | 0.131.0 | LLM Claude |
| openai | 7.25.0 | LLM OpenAI (opcional) |
| @google/genai | 2.25.0 | LLM Gemini (opcional) |
| @deepgram/sdk | 5.13.0 | STT principal |
| assemblyai | 4.41.5 | STT alternativo |
| pino | 10.3.1 | logs estructurados |
| turbo | 2.11.6 | monorepo |
| vitest | 5.0.3 | tests unitarios y backtesting |
| @playwright/test | 1.63.0 | E2E (Chromium ya instalado en este entorno) |
| unpdf / mammoth | 1.8.1 / 1.13.0 | extracción PDF/DOCX (fase 7) |
| shiki | 4.5.0 | resaltado de código (fase 6) |
| tsx, eslint, prettier | 4.23.15 / 10.11.0 / 3.9.9 | tooling |

Pospuestos: stripe 23, bullmq 6, ioredis 6, electron 44, electron-vite 5, next-auth, @aws-sdk/client-s3, resend.

### 5.3 Estimación de costo por hora de llamada

Supuestos: dos canales STT (tú y ellos) durante 60 min; unas 40 frases de "ellos" por hora pasan por el clasificador; unas 20 respuestas generadas por hora con prompt de ~4.000 tokens de entrada (instrucciones + CV/perfil + RAG + últimos minutos de transcripción) y ~300 de salida; notas post-llamada con ~10.000 tokens de entrada.

**STT (por hora, dos canales):**

| Proveedor | Tarifa | Costo/hora |
|---|---|---|
| Deepgram Nova-3 multilingüe streaming | $0.0058/min (promo; vuelve a ~$0.0077) | $0.70 (hasta $0.92) |
| Deepgram Nova-3 monolingüe streaming | $0.0048/min (promo) | $0.58 |
| AssemblyAI Universal-Streaming | $0.15/hora por stream | $0.30 |

Transcribir solo el canal "ellos" reduce esto a la mitad. Para uso personal AssemblyAI es el más barato; Deepgram tiene mejor soporte de keyterms y endpointing configurable.

**LLM (por hora, clasificador + 20 respuestas + notas):**

| Modelo | Entrada / salida por 1M tokens | Costo/hora aprox. |
|---|---|---|
| GPT-4o mini | $0.15 / $0.60 | $0.02 |
| GPT-4.1 mini | $0.40 / $1.60 | $0.05 |
| Gemini 2.5 Flash | $0.30 / $2.50 | $0.05 |
| Claude Haiku 4.5 | $1.00 / $5.00 | $0.12 |
| Claude Sonnet 5.5 | $2.00 / $10.00 | $0.24 |
| Claude Opus 5.5 | $4.00 / $20.00 | $0.48 |

Con prompt caching en Claude (instrucciones + perfil fijos durante la llamada) la parte de entrada baja de forma notable; lo mediré en el backtesting.

**Total por hora de llamada:** entre $0.35 (AssemblyAI + GPT-4o mini) y $1.40 (Deepgram multilingüe + Opus 5.5). El producto de referencia cobra 1 crédito por hora, así que el margen comercial existe incluso con los modelos caros.

Fuentes de precios: [Deepgram Nova-3](https://convertaudiototext.com/blog/deepgram-nova-3-explained), [Deepgram pricing 2026](https://diyai.io/ai-tools/speech-to-text/deepgram-pricing-2026/), [AssemblyAI pricing](https://www.assemblyai.com/pricing.md), [GPT-4o mini](https://anotherwrapper.com/llm-pricing/gpt-4o-mini-2024-07-18), [GPT-4.1 mini](https://anotherwrapper.com/llm-pricing/gpt-4.1-mini-2025-04-14), [Gemini 2.5 Flash](https://anotherwrapper.com/llm-pricing/gemini-2.5-flash). Precios de Claude según la tabla oficial de modelos vigente.

## 6. Plan de backtesting (lo que hago yo mientras tú pruebas en vivo)

La idea: cada llamada en vivo tuya genera un archivo de sesión que yo puedo reproducir aquí de forma determinista, medir y comparar entre versiones del pipeline.

### 6.1 Qué exporta la app en cada sesión (JSONL)

Una línea por evento, con timestamp relativo al inicio:
- `audio.chunk` (solo si "guardar audio para evaluación" está activo; si no, se omite)
- `transcript.partial` y `transcript.final` con canal, texto, startMs, endMs, confianza
- `utterance.end` por canal
- `question.detected` con la salida de la heurística y del clasificador LLM
- `answer.started`, `answer.first_token`, `answer.done` con latencias y tokens
- `user.action` (Answer manual, Clear, Chat, Screenshot)
- `user.feedback` opcional: pulgar arriba/abajo por respuesta (lo añado a la UI; es lo que convierte tus llamadas en datos de evaluación)

### 6.2 Niveles de backtesting

| Nivel | Entrada | Qué mide | Necesita |
|---|---|---|---|
| 1. Heurística de preguntas | dataset de frases etiquetadas es/en (empiezo con 120, no 40) | precisión, recall, F1 por tipo (behavioral, technical, coding, objection, smalltalk) | nada |
| 2. Replay de transcripción | JSONL de tus sesiones con `FakeStt` | preguntas detectadas vs reales, falsos positivos, debounce correcto, orden de eventos | nada |
| 3. Clasificador y respuestas LLM | las mismas transcripciones contra el LLM real | tasa de "needsAnswer" correcta, calidad de respuesta con rúbrica (idea central primera, 3 a 5 viñetas, idioma correcto, no repite respuesta previa), costo y latencia por respuesta | clave LLM y host permitido |
| 4. STT sobre audio | WAV 16 kHz de tus llamadas de prueba o audio sintético (TTS) | WER por idioma, latencia audio a parcial, duplicación entre canales por eco | clave STT y host permitido |
| 5. E2E en Chromium | Playwright con un WAV reproducido en una pestaña y compartido con audio | el flujo completo crear sesión, compartir, recibir respuesta, notas | claves STT y LLM |

Los niveles 1 y 2 corren en CI con cada cambio y son mi "red de regresión". Los niveles 3 a 5 corren a demanda porque cuestan dinero.

### 6.3 Métricas y umbrales iniciales

- Detección de preguntas: recall ≥ 0.90 y precisión ≥ 0.80 sobre el dataset etiquetado. Prefiero algún falso positivo a perder una pregunta real.
- Smalltalk respondido: ≤ 5 % de las frases de cortesía generan respuesta.
- Latencia primer token: p50 < 1.2 s, p95 < 2.5 s (medida en el nivel 3).
- Duplicación entre canales: < 10 % de los segmentos de "me" aparecen también en "them".
- Costo por hora: reportado en cada corrida del nivel 3 para comparar modelos.

### 6.4 Protocolo para tus pruebas en vivo

1. Antes de la llamada: activar "Sesión de prueba" (guarda audio y transcripción completa).
2. Durante: usar pulgar arriba/abajo en cada respuesta y el botón Answer cuando el sistema no detectó una pregunta que sí lo era (ese clic queda registrado como "pregunta perdida").
3. Después: exportar el JSONL (y el WAV si aplica) y subirlo a `backtesting/datasets/sessions/`. Yo lo reproduzco, comparo con la versión anterior del pipeline y te devuelvo un reporte corto con qué mejoró y qué empeoró.

## 7. Lo que necesito de ti para los niveles 3 a 5

- Claves como variables de entorno del entorno de Claude Code (no por chat): `ANTHROPIC_API_KEY` y/o `OPENAI_API_KEY`, y `DEEPGRAM_API_KEY` o `ASSEMBLYAI_API_KEY`.
- Permitir en la política de red del entorno los hosts `api.deepgram.com` o `api.assemblyai.com`, y `api.openai.com` si eliges OpenAI. `api.anthropic.com` ya está permitido.
- Respuestas a las seis dudas de la sección 2 (o tu OK a los defaults).

## 8. Siguiente paso propuesto

Con tu OK arranco la Fase 0 con el alcance de la sección 3, y en la misma fase dejo listo `backtesting/` con el dataset del nivel 1 y el replay del nivel 2, para que desde la primera llamada en vivo ya tengamos datos comparables.
