# Contrato `/api/brains/*` y despacho multi-organización (v1)

Auditado contra `nea-agent@f632397`. Normativo para `vocero-crm` 070. Solo crece
de forma aditiva (constitución, Principio X). Las cadenas `vocero:cerebro:v1`,
`x-vocero-*` y la ruta `/vocero/dispatch` no cambian.

## 1. Autenticación (todas las rutas)

```
Authorization: Bearer <credencial>
X-Vocero-Organization: <slug actual | organization.id>
credencial = base64url_sin_relleno(HMAC-SHA256(secreto_despliegue, "vocero:cerebro:v1:" + organization.id))
```

Orden de verificación en `requireBrain`:

1. `TENANCY` ≠ `multi` → **404 vacío**.
2. IP con ≥ 20 rechazos en 10 min (`token-fallido:<ip>`) → **429** sin tocar la base.
3. Falta cualquiera de las dos cabeceras → **401**.
4. Organización por slug **o** id; su `brain_deployment_id`; despliegue `activo`;
   descifrar secreto (caché en proceso ≤ 60 s, invalidada al rotar/pausar/reasignar);
   derivar y comparar con `timingSafeEqual`. Cualquier fallo → **401** con el
   mismo cuerpo `{"error":{"code":"unauthorized"}}` y se cuenta el rechazo.
5. Organización `suspendida` → **403** `organizacion_suspendida`.
6. Ámbito: `{ organizationId, deploymentId }`. Toda consulta posterior filtra
   por `organizationId` (vía `scoped()`).

Vector gemelo (fijado en ambos repos):
`secreto = "un-secreto-de-despliegue-largo-y-aburrido"`, `org = "org_abc123"` →
`_BqRKryMUdexcuLj_3RG1ARbgqr_LhXRSLJYmrw5VJ0`.

Errores: sobre del CRM `{"error":{"code","message"}}` (Nea lee `error.code` y
también `code` plano). **Excepción**: el 404 de la agenda apagada va **vacío**.

## 2. Superficie conversacional

| Ruta | Cuerpo / query | Éxito | Errores tipados |
|---|---|---|---|
| `GET /context` | `conversationId` (obligatorio; `identity`/`waIdentity` **no** se aceptan), `contextVersion=2` | 200: cuerpo de `/api/bot/context` (`contact`, `conversation`, `lead{…,nextStages}`, `booking`, `adOrigen`) + `agent` + `knowledge` + `llm` | 404 `not_found` |
| `POST /messages` | `{dispatchId, conversationId, text}` | **201** `{ok:true, messageId}`; replay idéntico → 200 con el mismo `messageId` | 422 `invalid_body`; 422 `despacho_desconocido`; 422 `fuera_de_ventana`; 409 `ai_paused` · `sandbox_violation` · `message_limit` · `cerebro_reasignado`; 404 |
| `PUT /ficha` | `{conversationId, ficha}` | 200 (igual que `/api/bot/ficha`) | 404, 422 |
| `POST /stage` | `{conversationId, stage}` | 200 (igual que `/api/bot/stage`) | 409 `etapa_no_permitida`·`herramienta_apagada`·`ai_paused`; 422 `etapa_desconocida` |
| `POST /handoff` | `{conversationId, reason}` (catálogo `cliente|modelo|error|ventana|hostilidad`) | 200 | 404, 422 |
| `POST /typing` | `{conversationId}` | 200 | 404 |
| `GET /media/{mediaId}` | `mediaId` = el del evento | 200 binario + `content-type` | 404 (incluye adjuntos de otra organización) |
| `POST /llm/{ruta}` | cuerpo OpenAI tal cual; solo `chat/completions` (otra ruta → 404) | status y cuerpo del proveedor | 402 `sin_credencial`; 504 `proveedor_sin_respuesta` |

### 2.1 `context`: campos que añade `/api/brains`

```jsonc
"agent": {            // = serializeBotProfile().profile
  "name", "tone", "instructions", "escalationRules", "greeting", "role", "tools",
  "coordinationFollowupEnabled": false        // 070: siempre false (D8)
},
"knowledge": [ {"kind":"qa","question","answer"} | {"kind":"block","content"} ],
"llm": { "path": "/api/brains/llm", "model": "<de Ajustes → IA>", "transcribeModel": "<o \"\">" } | null
```

`llm` es `null` si la organización **no** tiene credencial propia activa (nunca
se ofrece la del entorno). `transcribeModel` va `""` en 070: el CRM no sabe si
el modelo elegido oye, y Nea prefiere no transcribir antes que inventar. Con `null`, Nea no piensa y pasa a humano
(`sin_credencial`).

### 2.2 `messages`: idempotencia y despacho

- `dispatchId` debe existir en `dispatch` con el mismo `organizationId` y
  `conversationId` (cualquier estado salvo `descartado`, creado hace < 24 h).
- Si `dispatch.brain_deployment_id` ≠ despliegue del ámbito → 409
  `cerebro_reasignado` (no se envía).
- Clave `(organizationId, dispatchId, sha256(text))` en `brain_reply`: un
  turno puede mandar varios textos por despacho; un reintento del mismo texto
  devuelve el mensaje ya creado.

## 3. Agenda (`/api/brains/agenda/*`)

Módulo agenda efectivo apagado **en esa organización** → **404 vacío** en todas.

| Ruta | Entrada | Éxito | Errores |
|---|---|---|---|
| `GET /slots` | `conversationId`, `date?`, `agendaId?` | 200 `{slots:[…], query}`; registra oferta | 404 con sobre (conversación inexistente: la sonda `cv_sonda` concluye «encendida») |
| `POST /book` | `{conversationId, startUtc}` (+ v2: `idempotencyKey`, `dispatchId`, `brainGeneration`, `reminderConsent`) | **201** `{ok:true, booking:{id,startUtc,label,meetingLink,linkPending,…}}` | 409 `slot_taken`/`slot_not_offered` con `slots` |
| `PATCH /book` | `{conversationId, startUtc}` (+ v2: `selectionToken`, `confirmation`) | 200 `{ok:true, booking}` | 404 con sobre `no_booking`; 409 |
| `GET /bookings` | `conversationId` | 200 `{bookings:[{selectionToken,label,startUtc,revision}]}` | 404 |
| `POST /cancel` | `{conversationId, selectionToken, confirmation:true, idempotencyKey, …}` | 200 `{ok:true}` | 409 `confirmation_required`·`stale_selection`; 404 |
| `POST /followup` | `{conversationId, consent, …}` | — | 409 `followup_not_allowed` (070) |

`selectionToken` = `base64url(bookingId.revision).HMAC(BETTER_AUTH_SECRET, "aliantis-seleccion:v1:"+orgId+":"+…)`
— opaco, ligado a organización y conversación. `idempotencyKey` → `brain_operation`.

## 4. Despacho `multi` (CRM → Nea)

`POST {deployment.dispatch_url}` con cabeceras `content-type`,
`x-vocero-signature: sha256=<hex>`, `x-vocero-dispatch-id`,
`x-vocero-organization: <slug ?? id>`. Cuerpo = `armarEvento` de la 021 **más**,
al final y solo en `multi`:

```jsonc
"expiresAt": "<ISO: dispatch.createdAt + 10 min (VIDA_DESPACHO_MS)>"
// sin "capabilities" en 070 (Nea → agenda v1); sin "brainGeneration"
```

`mediaId` igual que en `single` (id de Graph), resuelto en `/media` siempre
dentro de la organización. Evento de borrado `conversation.deleted` sin cambios
de forma, al despliegue de **esa** organización.

## 5. Ensayo (`X-Vocero-Ensayo`)

No se emite en 070 (D9). Si llega la cabecera, se ignora: la petición se
atiende como una normal (Nea nunca la envía si el CRM no llamó
`/vocero/ensayo`).

## 6. Vectores gemelos

| Vector | CRM | Nea |
|---|---|---|
| Credencial derivada | `tests/unit/brains-credencial.test.ts` | `tests/test_multiorg.py` (existente) |
| Cuerpo `multi` + firma | `tests/unit/brains-despacho-gemelo.test.ts` | `tests/test_brains_gemelo.py` (nuevo) |
| `conversation.deleted` + firma | ídem | ídem |
| Tabla de rutas del cliente | `tests/unit/brains-rutas.test.ts` (rutas que existen) | `tests/test_brains_gemelo.py` (`RUTAS` ⊆ rutas del CRM) |
