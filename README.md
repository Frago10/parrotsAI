# CallPilot (parrotsAI)

Copiloto de IA en tiempo real para llamadas (Google Meet, Teams, Zoom en el navegador): transcribe la llamada, detecta preguntas, sugiere respuestas con tu contexto (instrucciones, CV, documentos) y genera notas al terminar.

La app es visible y honesta: no oculta ventanas ni procesos y pide consentimiento antes de transcribir. Está pensada para ventas, reuniones con clientes, soporte, práctica y entrevistas donde el uso de IA está permitido o informado.

## Arquitectura

```mermaid
flowchart LR
  subgraph Navegador["Chrome (apps/web, Next.js)"]
    UI[Workspace y sesión en vivo]
    CAP[Captura: pestaña compartida + micrófono]
    AW[AudioWorklet 16 kHz PCM16]
    CAP --> AW
  end
  AW -- "WS binario (canal me/them)" --> RT
  UI -- "WS JSON (protocolo Zod)" --> RT
  subgraph Realtime["apps/realtime (Fastify + ws)"]
    RT[Sesión en vivo]
    STT[SttProvider: Deepgram | Fake]
    DET[Detector de preguntas: heurística + clasificador LLM]
    ANS[Answerer en streaming + AbortController]
    NOTES[Notas post-llamada]
    LOG[Registro JSONL de sesión]
    RT --> STT --> DET --> ANS
    RT --> LOG
    RT --> NOTES
  end
  ANS --> LLM[(packages/ai: Anthropic | Fake)]
  NOTES --> LLM
  RT --> DB[(packages/db: Prisma + Postgres)]
  UI --> DB
  LOG --> BT[backtesting/: replay determinista y métricas]
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/web` | Next.js 16: workspace, lista de sesiones, pantalla en vivo, vista post-llamada |
| `apps/realtime` | Servidor WebSocket: audio -> STT -> detección de preguntas -> respuesta -> notas |
| `packages/shared` | Protocolo WS (Zod), heurística de preguntas, prompts versionados, catálogo de modelos |
| `packages/ai` | Interfaz `LlmProvider` con implementación Anthropic y simulador determinista |
| `packages/db` | Prisma 7 + Postgres: schema, migraciones, seed |
| `backtesting` | Dataset etiquetado es/en, runner de métricas y replay de sesiones JSONL |
| `docs` | Revisión del proyecto y plan de backtesting |

## Puesta en marcha

Requisitos: Node 22+, pnpm 10, PostgreSQL 16.

```bash
cp .env.example .env            # ajusta DATABASE_URL y, si las tienes, las claves de API
pnpm install
pnpm db:migrate                 # crea las tablas
pnpm db:seed                    # 11 sesiones de ejemplo
pnpm dev                        # web en http://localhost:3000, realtime en ws://localhost:4001/ws
```

Sin claves de API todo funciona con los proveedores simulados (`STT_PROVIDER=fake`, `LLM_PROVIDER=fake`): la transcripción se inyecta desde el panel de debug y las respuestas son deterministas. Con `DEEPGRAM_API_KEY` y `ANTHROPIC_API_KEY` en `.env` y `STT_PROVIDER=deepgram`, `LLM_PROVIDER=anthropic`, se usan los servicios reales.

## Comandos

```bash
pnpm lint         # ESLint en todos los paquetes
pnpm typecheck    # tsc --noEmit en todos los paquetes
pnpm test         # Vitest (unidades: heurística, prompts, créditos, proveedores)
pnpm backtest     # niveles 1 y 2 del backtesting, reporte en backtesting/reports/
```

## Backtesting

Cada sesión en vivo escribe un archivo JSONL en `data/sessions/<id>.jsonl` con transcripción, preguntas detectadas, respuestas, latencias y feedback del usuario. Esos archivos se reproducen con `pnpm backtest` para comparar versiones del pipeline. El detalle está en `docs/00-revision-y-plan-backtesting.md`.
