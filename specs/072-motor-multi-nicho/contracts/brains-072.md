# Contrato `/api/brains/*` — delta 072

Delta **aditivo** sobre [070/contracts/brains.md](../../070-cerebro-multiorg/contracts/brains.md)
y [071/contracts/brains-071.md](../../071-cerebro-aliantis-produccion/contracts/brains-071.md).
Nada existente cambia de nombre, forma ni código de estado. Auth, cabeceras
(`X-Vocero-Organization` = id de la organización) y credencial derivada
`vocero:cerebro:v1` sin cambios.

## 1. `GET /api/brains/context` y `GET /api/bot/context` (072-A)

Campo nuevo de primer nivel, **ausente o `null`** si el negocio no definió campos:

```jsonc
{
  "...": "cuerpo de siempre",
  "fichaSchema": {
    "version": 1,
    "fields": [
      { "key": "fecha_evento", "label": "Fecha del evento", "type": "date", "required": true,
        "description": "Día del evento, aunque sea aproximado" },
      { "key": "tipo_evento", "label": "Tipo de evento", "type": "select", "required": true,
        "options": ["Boda", "Corporativo", "Cumpleaños", "Otro"] },
      { "key": "num_invitados", "label": "Número de invitados", "type": "number", "required": true }
    ]
  }
}
```

| Campo | Regla |
|---|---|
| `fields` | 1..20, en el orden en que se piden |
| `key` | `^[a-z][a-z0-9_]{1,39}$`, ≠ `notas`, única |
| `type` | `text \| number \| date \| select \| boolean` (Nea descarta tipos desconocidos) |
| `options` | solo `select`, 1..30 cadenas ≤60 |
| `description` | opcional, ≤160, una línea |

Los valores siguen viniendo en `contact.ficha` como hoy (`date` = `AAAA-MM-DD`).
**No** se envía el id del Vertical Pack (D12).

## 2. `PUT /api/brains/ficha` y `PUT /api/bot/ficha` (072-A)

Petición sin cambios. Respuesta: la ficha completa como hoy **más**, solo si
algo se descartó:

```jsonc
{ "...": "ficha completa", "ignored": [ { "key": "num_invitados", "reason": "no_es_numero" } ] }
```

`reason` ∈ `no_es_numero | fecha_invalida | opcion_invalida | no_es_booleano | texto_largo | no_es_texto`
(auditoría 072-A: el esquema ve el valor CRUDO, así que un texto de más de 500
o un objeto en un campo del esquema se reportan en vez de perderse en silencio;
`PATCH /api/contacts/[id]` también devuelve `ignored`).
Nunca 422 por un valor; sin esquema la respuesta es idéntica a 2.11.0.

## 3. `GET /api/brains/context` — `moduleTools` (072-B)

Solo en `/api/brains/context` (en `single` no hay módulos). Ausente si no hay
ninguna herramienta de módulos efectivos.

```jsonc
"moduleTools": [
  {
    "name": "diagnostico_eco",
    "module": "diagnostico",
    "effect": "lectura",
    "description": "Devuelve el texto recibido y la hora del negocio. Solo para pruebas internas.",
    "parameters": { "type": "object", "properties": { "texto": { "type": "string", "maxLength": 200 } },
                    "required": ["texto"], "additionalProperties": false }
  }
]
```

| Regla | Valor |
|---|---|
| `name` | `^[a-z][a-z0-9_]{2,47}$`, empieza por `<module>_` |
| Reservados (CRM y Nea) | `update_ficha`, `move_stage`, `propose_slots`, `book_session`, `reschedule_session`, `list_bookings`, `cancel_session`, `coordination_consent`, `route_out`, `handoff`, `notas` |
| Cantidad | ≤8 por negocio |
| `parameters` | JSON Schema `type: object`, ≤4 KB serializado; total ≤12 KB |
| `effect` | `lectura \| escritura` (informativo para Nea; la idempotencia la hace el CRM) |

Nea ofrece cada herramienta con clave `modulo:<module>` y la descarta (log
`warning`, sin tumbar el turno) si incumple cualquier regla o choca con su
registro nativo.

## 4. `POST /api/brains/tools/{name}` (072-B) — NUEVA

```http
POST /api/brains/tools/diagnostico_eco
Authorization: Bearer <credencial derivada>
X-Vocero-Organization: <organization.id>
Content-Type: application/json

{ "conversationId": "cv_…", "dispatchId": "dsp_…", "args": { "texto": "hola" } }
```

| Código | `error.code` | Cuándo |
|---|---|---|
| 200 | — | Ejecutó (o repetición idempotente): `{ "ok": true, "result": {…}, "estado": "hecho" \| "en_curso" }` o error funcional `{ "ok": false, "error": "…", "detalle": "…" }` |
| 401 | `unauthorized` | Credencial inválida (igual que el resto; Nea → `CrmRechazo`) |
| 403 | `organizacion_suspendida` | Igual que el resto |
| 404 | `tool_not_found` | No existe, o su módulo no está encendido para ESTE negocio (cuerpo idéntico) |
| 404 | `not_found` | Conversación de otra organización o inexistente |
| 409 | `ai_paused` | IA apagada o `handoffAt` en la conversación |
| 413 | `payload_too_large` | Cuerpo >16 KB |
| 422 | `invalid` / `invalid_args` | Sobre inválido / `args` no cumplen el esquema (`details.path`) |
| 504 | `tool_timeout` | El manejador pasó de 8 s |
| 500 | `internal` | Sobre JSON de `withBrain` |

**Idempotencia** (`effect: "escritura"`): clave = `sha256(dispatchId + "\n" + name + "\n" + JSON canónico de args)`.
Una repetición devuelve la respuesta guardada (200) sin ejecutar; si la
primera sigue en curso, `{ "ok": true, "estado": "en_curso", "result": {} }`.
Una ejecución que terminó en 504/500 queda `fallida` y la repetición vuelve a ejecutar.

**Resultado**: ≤4 KB serializado. Convenciones para módulos:
`result.enviadoAlCliente: true` cuando el CRM ya le envió algo al cliente (el
bot no lo repite); `estado: "en_curso"` cuando el trabajo sigue en segundo plano.

**Mapeo en Nea** (`CrmClient.call_tool`): 200 → el cuerpo tal cual al modelo;
404 → `{"ok": false, "error": "herramienta_no_disponible"}`; 409 →
`{"ok": false, "error": "ai_paused"}`; 422 → `{"ok": false, "error": "argumentos_invalidos", "detalle": …}`;
504/5xx/timeout 10 s → `{"ok": false, "error": "crm_error", …}`; 401/403 → `CrmRechazo` (terminal).

## 5. Compatibilidad cruzada

| CRM \ Nea | Nea 071 | Nea 072 |
|---|---|---|
| CRM 2.11 | hoy | Sin `fichaSchema`/`moduleTools`: comportamiento 071, dorados B0 |
| CRM 2.12 (072-A) | Ignora `fichaSchema` e `ignored` | Ficha dinámica |
| CRM 2.13 (072-B) | Ignora `moduleTools` | Ficha dinámica + herramientas de módulo |
