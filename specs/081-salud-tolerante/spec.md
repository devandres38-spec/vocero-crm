# 081 — Filtro de salud tolerante a errores de escritura: el espejo (bloque M2)

Fase 6 de Aliantis, bloque M2 (P7 del bloque M). Privacidad, Ley 1581: **va solo**. El diseño completo, la medición y las preguntas están en `aliantis-brain/specs/016-salud-tolerante/spec.md`; aquí va solo lo que cambia en Vocero.

> Aprobada por Andres el 12-nov-2026, junto con la spec 016 del cerebro (P1 a P4). P2 entra: cambian la huella del perfil y `perfil-privacidad-demo.json`.

## Por qué

Vocero filtra antes de guardar (mensajes en `inbox/ingest.ts:621`, `webhook_event` en `webhooks/eventos.ts:78`, Laboratorio en `lab/runner.ts:289`, notas y ficha en `privacy/filtrar.ts:45`) con una copia del filtro del cerebro (spec 068). Si el cerebro tolera errores de escritura y Vocero no, «tengo una infesion» se guardaría en la bandeja aunque el cerebro lo omita. Los vectores gemelos lo impiden: el cambio entra en los dos lados o en ninguno.

## Qué cambia

Copias mecánicas, con la regla de la 068 (solo cambian la cabecera, que dice el commit del cerebro, y las importaciones; no se editan a mano):

| Archivo de Vocero | Copia de (`aliantis-brain`) |
| --- | --- |
| `src/server/privacy/phonetic.ts` (nuevo) | `src/privacy/phonetic.ts` |
| `src/server/privacy/palabras-reales.ts` (nuevo, generado allá) | `src/privacy/palabras-reales.ts` |
| `src/server/privacy/health-terms.ts` | `src/privacy/health-terms.ts` |
| `tests/unit/fixtures/privacy-corpus.ts` | `test/fixtures/privacy-corpus.ts` (`WITH_HEALTH_TYPOS` y `NEAR_HEALTH`) |
| `tests/unit/fixtures/privacidad-vectores.json` | `test/fixtures/privacidad-vectores.json` (byte a byte) |

Y además: la huella nueva en `tests/unit/privacidad-gemela.test.ts`, y las metas de las dos listas nuevas en `tests/unit/privacidad-corpus.test.ts`.

**No cambia:** el esquema, las migraciones, el formato del perfil de privacidad (sigue en 1), las rutas ni la interfaz. Si Andres aprueba P2 de la 016 (tres términos nuevos), cambia la huella del perfil y se regenera `src/server/privacy/perfil-privacidad-demo.json` desde el cerebro.

## Verificación

- En el PC: `vitest run` de `privacidad-gemela`, `privacidad-corpus`, `privacidad-webhook`, `privacidad-adjuntos`, `privacidad-perfil` y `texto-libre`; eslint de los archivos tocados (sin prettier: reformatea archivos enteros); `tsc --noEmit`.
- En GitHub: CI en verde y `e2e.yml` (etiqueta `e2e`: cambia el filtro de la ingesta).
- Sabotaje S7 de la 016: cambiar una regla solo en la copia de Vocero rompe `privacidad-gemela.test.ts`.
