# 084 — Motivo `sin_respuesta` y Laboratorio sin traspasos innecesarios (bloque P3)

**Estado:** aprobada por Andres el 13-nov-2026 dentro del plan del bloque P3 («que el bot atienda en lugar de pasar el chat al equipo»), con las 5 recomendaciones de su sección 5. Rama `feat/084-motivo-sin-respuesta`. La otra mitad está en `aliantis-brain/specs/022-bot-atiende/`.

**Origen:** en el Laboratorio del Preview (Academia Futuro), 11 de 12 casos terminaron con el chat pasado al equipo. Cada traspaso pone `ai_enabled=false`: el bot calla en esa conversación hasta que una persona lo devuelva. El cerebro deja de pasar el chat por una pregunta sin dato (ofrece pasarla y solo la pasa si el cliente confirma o insiste) y manda un motivo nuevo, `sin_respuesta`.

**Orden de despliegue:** Vocero se une y se despliega **primero**. Un Vocero viejo convierte `sin_respuesta` en `modelo` (`toHandoffReason`) sin romperse.

**Riesgo:** bajo. No hay migración: `conversation.handoff_reason` es `text` sin `check` en la base (como en la 071) y `lab_case.hallazgos` es `jsonb`. `pnpm db:generate` lo confirma («No schema changes»).

## Hoy (verificado contra el código el 13-nov-2026, `main` en `29e5f53`)

- `src/server/bot/handoff.ts`: `HANDOFF_REASONS` con fallback a `modelo`.
- Rótulos por motivo en tres tablas: `HANDOFF_LABELS` (`src/lib/eventos-hilo.ts`, el hilo y el panel), `HANDOFF_LABEL` (`src/lib/analytics.ts`, Resultados, que agrupa por la clave) y `MOTIVO_DEL_AVISO` (`src/server/avisos/textos.ts`).
- `no_entiende` se rotula «El agente no supo responder»: mezcla «no entendí» con «no tengo ese dato».
- Juez del Laboratorio: hallazgos `alucinacion | fuera_de_kb | debio_escalar | tono`. Su prompt dice que, sin precio o duración, «pasar a una persona es lo correcto», y `renderNegocio` rotula el precio faltante «no configurado (responde una persona)».

## Diseño

- **D1. Motivo `sin_respuesta`:** en `HANDOFF_REASONS`, en el enum de TypeScript de `schema.ts` y en las tres tablas de rótulos: «Pregunta que el asistente no tenía publicada». Resultados lo cuenta aparte de `no_entiende`. El contrato (`specs/067-.../bot-api-v2.md` §7) lo suma.
- **D2. Personas:** las descripciones de `pregunton_precios`, `fuera_de_kb`, `errores_modismos` y `sin_rumbo` dicen que el bot responde con honestidad y ofrece pasar la pregunta, sin pasar el chat por su cuenta; `pide_humano` escala cuando pide una persona, no antes. Los guiones no cambian.
- **D3. Juez:** hallazgo nuevo `derivo_sin_necesidad`, el inverso de `debio_escalar` (enum de `Verdict`, prompt y rótulo «Pasó al equipo sin necesidad» en `lab-client.tsx`). El prompt explica cuándo un traspaso hace falta y que, con un dato faltante, lo correcto es decirlo sin inventarlo ni negarlo y ofrecer pasar la pregunta. `renderNegocio`: «precio: no publicado (el agente lo dice y ofrece pasar la pregunta)».

## Criterios de aceptación

- **CA-1** `toHandoffReason("sin_respuesta")` → `sin_respuesta`; tiene rótulo en Resultados, el hilo y el aviso, distinto del de `no_entiende`.
- **CA-2** `Verdict` acepta `derivo_sin_necesidad` y el prompt del juez lo explica.
- **CA-3** El prompt ya no dice que un precio faltante se resuelve pasando a una persona.
- **CA-4** E2E del despacho (`e2e.yml`) en verde.

## Fuera de alcance

- La derivación suave (el bot sigue activo con una pregunta pendiente para el equipo): bloque aparte, necesita un endpoint nuevo en el contrato 067.
- El catálogo unificado (EXP-1).
