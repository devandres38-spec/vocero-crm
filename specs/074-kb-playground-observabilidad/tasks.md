# Tasks: Spec 074 — KB de producción, «Probar mi agente», observabilidad BYOK y Laboratorio v2

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [contracts/brains-074.md](contracts/brains-074.md)
**Estado**: en implementación (2026-11-20), sin merge a `main`. Se numera 2.15.0 al cerrar.

Convenciones: `[crm]` `vocero-crm` · `[nea]` `nea-agent` · `[local]` gate en este equipo · `[CI]` · `[staging]`.

Gates locales: `[crm]` typecheck · lint · vitest (1 worker) — `[nea]` pytest (6 doradas B0). Nada de `next build`, Docker ni E2E en local.

## Bloque 0 — Spec-Kit
- [x] K00 `spec.md`, `plan.md`, `tasks.md`, `contracts/brains-074.md`

## Bloque 1 — KB de producción (D8)
- [x] K01 `[crm]` Migración `0038_kb_produccion` (kb_entry + agent_profile.resources + agent_playground_day + llm_usage), re-ejecutable
- [x] K02 `[crm]` `src/lib/kb.ts` (categorías, orden, render con título, tokens, esquema de enlaces) + `src/server/kb.ts`
- [x] K03 `[crm]` `/api/kb` POST/PATCH ampliados, `/api/kb/reorder`, `/api/kb/size` con tokens, `/api/agent/resources`
- [x] K04 `[crm]` Consumidores: `/api/bot/profile`, `/api/brains/context` (`knowledge[].title`, `resources`), Laboratorio (Blueprint `conocimiento`: sin cambios, los campos nuevos toman sus defaults)
- [x] K05 `[crm]` UI: edición inline, título/categoría, activar/fijar, reordenar, buscador/filtro, enlaces verificados, barra de tokens
- [x] K06 `[nea]` `recursos_saneados` (`app/datos.py`), título y `resources` desde el contexto, texto de enlaces oficiales en el prompt
- [x] K07 `[nea]` Prompt caching: prueba de prefijo estático común + `DELTAS_074` (6 doradas B0 intactas)
- [x] K08 Pruebas: orden/filtro, título, enlaces (CRM y Nea), tokens, rutas

## Bloque 2 — «Probar mi agente» (D9, #9)
- [x] K10 `[crm]` Ficha de ensayo + `requireBrain`/`withBrain` (solo lectura) + huecos sin oferta
- [x] K11 `[crm]` `src/server/playground.ts` (contexto sintético, cupo atómico en `agent_playground_day`, envío firmado a `/vocero/ensayo`)
- [x] K12 `[crm]` `POST/GET /api/agent/playground` (owner/admin, plataforma) + `metadata.bot.playgroundPerDay` (Blueprint)
- [x] K13 `[crm]` UI «Probar mi agente» (historial de sesión, reiniciar, restantes)
- [x] K14 Pruebas: aislamiento multi-org de la ficha, solo lectura por ruta, tope 40/día en BD, devolución del cupo, sin filas en la Bandeja

## Bloque 3 — Observabilidad BYOK y Laboratorio v2 (D9)
- [x] K20 `[crm]` `llm_usage` (en `0038`) + `src/server/llm-usage.ts` (registro best-effort, purga 90 días en el barrido)
- [x] K21 `[crm]` `pensarPorElCerebro` mide y registra (`source`, `dispatchId`, tokens, caché, latencia)
- [x] K22 `[crm]` `GET /api/agent/health` + panel de salud e incidentes
- [x] K23 `[crm]` Juez con `temperature: 0` (+ `source: lab`); total de casos dinámico en `lab-client`
- [x] K24 `[nea]` `X-Vocero-Dispatch` en las llamadas al modelo del turno
- [x] K25 Pruebas: parseo de `usage`, registro que no rompe, purga por lotes, resumen, juez a 0

## Bloque 4 — Cierre de 073-C
- [x] K30 `[nea]` `pending_send` en orden estricto por conversación dentro de la pasada + pruebas

## Cierre
- [x] K40 `docs/openapi-brains.json` (aditivo), CHANGELOG «Sin publicar» en ambos repos
- [x] K41 `[local]` typecheck · lint · vitest completo · pytest completo
- [x] K42 Push de `feat/074-kb-playground-observabilidad` en ambos repos, sin merge
- [ ] K43 `[CI]` build + E2E · K44 `[staging]` · K45 auditoría 074
