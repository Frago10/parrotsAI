# Sesiones JSONL para el nivel 2

Cada archivo `.jsonl` de esta carpeta es una sesión completa en el formato `SessionLogEventSchema`
(`packages/shared/src/sessionLog.ts`): una línea JSON por evento (`session.start`, `transcript.final`,
`utterance.end`, `question.heuristic`, `answer.*`, `user.action`, `user.feedback`, `session.end`...).
El replay (`pnpm --filter @callpilot/backtesting level2`) reproduce los `transcript.final` del canal
`them` y los `utterance.end` a través de `QuestionPipeline` con un reloj virtual y compara lo detectado
con la verdad de referencia.

## Archivos incluidos

| Archivo | Contenido |
|---|---|
| `demo-ventas.jsonl` | Llamada de ventas sintética en español (20 segmentos, objeciones, aclaración, respuesta forzada, feedback). |
| `demo-ventas.labels.json` | Etiquetas humanas `{ segmentId: needsAnswer }` para esa sesión. |
| `demo-entrevista.jsonl` | Entrevista sintética en inglés (22 segmentos, behavioral, technical, coding). Sin etiquetas: la referencia sale de los eventos `question.heuristic`. |

## Verdad de referencia

1. Si existe `<nombre>.labels.json` junto al JSONL, se usa como referencia: un objeto
   `{ "<id del transcript.final>": true | false }` donde `true` significa "esta intervención de la otra
   parte merecía una respuesta sugerida". Los segmentos que no aparecen en el archivo caen al punto 2.
2. Si no, la referencia son los eventos `question.heuristic` del propio archivo con `needsAnswer: true`
   (lo que el servidor decidió en vivo). Sirve para detectar regresiones, no para medir calidad absoluta.

Para etiquetar una sesión real a mano, copia los `id` de los eventos `transcript.final` con
`channel: "them"` y marca cuáles eran preguntas u objeciones reales.

## Cómo exportar una sesión real

El servidor realtime escribe cada sesión en vivo en `data/sessions/<sessionId>.jsonl` (ruta relativa a
la raíz del repo; configurable con `SESSION_LOG_DIR` en `.env`). El archivo se completa al terminar la
llamada (`session.end`).

```bash
# 1. Localiza la sesión (el id es el de la URL de la sesión en la app web)
ls -t data/sessions/ | head

# 2. Cópiala aquí con un nombre descriptivo
cp data/sessions/<sessionId>.jsonl backtesting/datasets/sessions/2026-10-01-demo-cliente-x.jsonl

# 3. (Opcional) etiquétala a mano
#    backtesting/datasets/sessions/2026-10-01-demo-cliente-x.labels.json

# 4. Reprodúcela
pnpm --filter @callpilot/backtesting level2 datasets/sessions/2026-10-01-demo-cliente-x.jsonl
# o todas las de la carpeta:
pnpm --filter @callpilot/backtesting level2
```

Antes de subir una sesión real revisa que la transcripción no contenga datos personales que no quieras
versionar; el audio nunca se guarda en el JSONL.
