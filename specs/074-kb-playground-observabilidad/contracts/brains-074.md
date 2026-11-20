# Contrato 074 — Cambios aditivos entre `vocero-crm` y el cerebro

Todo lo de aquí **crece**: un cerebro que no lo conozca sigue funcionando igual.

## §1 Conocimiento: solo lo activo, en orden, con título

`GET /api/brains/context` → `knowledge[]` y `GET /api/bot/profile` → `kb`:

- Solo entradas con `enabled = true`. Orden: fijadas primero, luego
  `sort_order` ascendente, luego antigüedad.
- `knowledge[].title?: string` (≤120) — aditivo, solo cuando la entrada tiene
  título. En `kb` (texto) la entrada con título va precedida de `## título`.
  Sin título, byte a byte lo de antes.

## §2 Enlaces oficiales (`resources`)

| Superficie | Campo | Forma |
|---|---|---|
| `GET /api/brains/context` | `resources` | `[{ label, url }]` (≤10; `url` `https://`, ≤500; `label` ≤60). **Omitido si está vacío.** |
| `GET /api/bot/profile` | `resources` | Igual; `[]` si no hay (como siempre). |

El cerebro los trata como **datos** y como los únicos enlaces que puede
compartir. Nea descarta lo que no sea `https://` sin espacios.

## §3 Ficha de ensayo (`X-Vocero-Ensayo`)

`POST {dispatchUrl→/vocero/ensayo}` (lo manda el CRM, firmado con el secreto
del despliegue como un despacho) ya existe en Nea desde 071. Desde 074 el CRM
lo usa para «Probar mi agente»:

```json
{
  "type": "rehearsal",
  "organization": { "id": "org_…", "slug": "acme" },
  "rehearsal": { "token": "<ficha>" },
  "context": { "conversation": { "id": "cv_ensayo_…", "channel": "whatsapp" }, "contact": { "identity": "ensayo:…", "name": "Cliente de prueba" }, "agent": {…}, "knowledge": […], "resources": […], "llm": {…}, "booking": {…}? },
  "capabilities": [],
  "turns": ["texto del cliente"],
  "history": [{ "role": "customer" | "agent", "text": "…" }]
}
```

Con la ficha en `X-Vocero-Ensayo`, `/api/brains/*` acepta SOLO:

- `POST /api/brains/llm/chat/completions` (se registra como `source: "ensayo"`).
- `GET /api/brains/agenda/slots?conversationId=<la de la ficha>`: huecos
  reales **sin** registrar oferta.

Cualquier otra ruta con la ficha → **403** `{error:{code:"ensayo_solo_lectura"}}`.
Ficha inválida, vencida (10 min) o de otra organización → **401** (igual que
una credencial mala).

## §4 `X-Vocero-Dispatch` (opcional)

Nea puede mandar el `dispatchId` del turno en curso en cada
`POST /api/brains/llm/*` (y `/api/bot/llm/*`). El CRM lo guarda en
`llm_usage.dispatch_id` si tiene forma de id (≤64, `[\w-]`); si no, `null`.
Un CRM viejo la ignora.

## §5 Lo que no cambia

`/api/brains/messages`, handoff, ficha, etapa, agenda (fuera de la lectura de
huecos con ficha), despacho y firmas: igual que en 073.
