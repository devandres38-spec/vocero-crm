# Guion E2E — US3: Agente (perfil e interruptor)

> Conducido con Playwright (MCP) contra `pnpm dev` con ai-mock
> (`OPENROUTER_BASE_URL` → `/api/dev/ai-mock`), `BOT_API_KEY` y
> `AGENT_COALESCE_MS=2000`.
>
> **036 — el CRM no trae agente.** Lo que antes probaba este guion (respuesta
> con IA, agrupación, `move_stage`, handoff por frase) era el turno dentro del
> proceso, que se fue. Ese comportamiento es del cerebro: en Nea, con su
> propia suite. Aquí queda lo que el CRM sí hace: guardar el perfil y el
> conocimiento que el cerebro lee, y decidir con el interruptor si se le
> despacha. 080: la llave de IA es de Aliantis (entorno); Ajustes → IA salió
> del negocio y el proxy `/api/bot/llm` está apagado.

## Preparación

1. En `/agent`: agregar una entrada P/R al KB ("¿Hacen envíos?" → "Sí, a todo
   México en 2-5 días").
   ✅ El contador de tamaño del KB refleja la entrada.
   ✅ `GET /api/bot/profile` con la key trae la entrada en `kb` (`P:`/`R:`).

## El interruptor (036)

2. **Sin cerebro** (app sin `BRAIN_DISPATCH_URL`): encender el interruptor.
   ✅ `PUT /api/agent/profile {enabled:true}` → **409** `sin_cerebro`; la
   pantalla dice qué falta y el interruptor sigue apagado. La tarjeta «Quién
   responde» dice que Vocero funciona como bandeja manual, sin rojo.
3. Un inbound → aparece en la bandeja y nadie contesta solo; el operador
   contesta a mano.
4. **Con cerebro** (`BRAIN_DISPATCH_URL` + `BRAIN_HEALTH_URL` hacia un cerebro
   sano; el de `scripts/e2e-despacho.mjs` sirve): encender → 200. Un inbound
   se despacha (guion `us-despacho.md`). Apagar → 200 siempre, y el siguiente
   inbound se queda en la bandeja (`warning: "apagado"`).

## Caminos infelices

5. **Handoff**: con la conversación traspasada (`POST /api/bot/handoff` o
   pausa desde el panel), un inbound no se despacha. «Reactivar IA» desde el
   panel lo vuelve a permitir.
6. **080 — Ajustes → IA fuera del negocio (D3, N9)**: como `owner`, `admin` o
   `member`, `GET`/`PUT`/`DELETE /api/settings/ai`, `POST /api/settings/ai/test`
   y `POST /api/settings/ai/models` → **404**; `/settings/ai` → 404; el menú
   de Ajustes no tiene «IA» y la pantalla Agente no habla de «tu proveedor».
   ✅ `GET /api/bot/profile` → `llm: null` y `POST /api/bot/llm/chat/completions`
   → **404** `proxy_apagado`. Lo prueba `scripts/e2e-despacho.mjs`.
