# Contrato — `/api/bot/*` v2 (cerebro → CRM)

Enmienda aditiva al contrato de `/api/bot/*` (`docs/openapi.json`). Lo que no aparece aquí no cambia. Tres cambios restringen algo que antes se permitía; están marcados con **⚠ restringe** y justificados en `../plan.md` («Divergencias»).

## 1. Autenticación por organización (todas las rutas)

```
X-Vocero-Organization: org_…          (el id, nunca el slug)
X-API-Key: <credencial>               (o Authorization: Bearer <credencial>)
```

```
credencial(org) = base64url_sin_relleno( HMAC-SHA256( BOT_API_KEY, "vocero:cerebro:v1:" + org_id ) )
```

Es la misma credencial derivada de Vocero Cloud. La cadena de dominio es contrato entre repositorios: un byte distinto da `401` en todo.

| Petición | Resultado |
| --- | --- |
| Cabecera de una organización que existe + su credencial | Autenticada en esa organización |
| Cabecera + credencial de otra organización, o la `BOT_API_KEY` cruda | `401 unauthorized` |
| Cabecera de una organización que no existe | `401 unauthorized` (no revela si existe) |
| Sin cabecera, `BOT_API_KEY`, la instalación tiene **una** organización | Autenticada en esa (compatibilidad) |
| Sin cabecera, `BOT_API_KEY`, la instalación tiene **dos o más** | `409 organizacion_requerida` |
| Sin cabecera y sin llave válida | `401` (y freno por IP, como hoy) |

- Comparación en tiempo constante, como hoy.
- **Presupuesto por organización:** 1200 llamadas por minuto **por organización** (`bot-api:{org}`). Los fallos de autenticación siguen frenados por IP.
- «Quién responde» (`markBotSeen`) se marca por organización.

## 2. `POST /api/bot/messages`

```json
{
  "conversationId": "cv_…",
  "text": "Antes de seguir, ¿aceptas nuestro aviso de privacidad? …",
  "buttons": [
    { "id": "aviso_acepto", "title": "Acepto" },
    { "id": "aviso_no_acepto", "title": "No acepto" }
  ],
  "motivo": "seguridad"
}
```

| Campo | Nuevo | Reglas |
| --- | --- | --- |
| `buttons` | sí, opcional | 1 a 3. `id`: 1 a 256 caracteres; `title`: 1 a 20. Ids y títulos únicos. Con botones, `text` hasta 1024 caracteres. Fuera de eso: `422 invalid_body` |
| `motivo` | sí, opcional | Solo `"seguridad"`. Ver «Agente apagado» |

- **Canal sin botones** (Instagram, Messenger, TikTok): `409 canal_sin_botones`, nada se envía.
- **Laboratorio** (`is_test`): se guarda con sus botones y no se envía, como hoy. La regla del Agente apagado no aplica a las conversaciones de prueba.
- El mensaje guardado lleva sus botones (`message.buttons`) y la bandeja los muestra.

**⚠ restringe: Agente apagado** (`agent_profile.enabled = false`), en una conversación real:

| Caso | Resultado |
| --- | --- |
| Sin `motivo` | `409 agente_apagado` |
| `motivo: "seguridad"` y hay un entrante con la marca `salud` posterior al último saliente del bot | Se envía |
| `motivo: "seguridad"` y no lo hay (ya se contestó, o no hubo salud) | `409 agente_apagado` |

Con el Agente encendido, `motivo` se acepta y no cambia nada. `ai_paused` (persona atendiendo) sigue igual y gana sobre todo lo demás.

## 3. `POST /api/bot/consent` (nuevo)

```json
{
  "conversationId": "cv_…",
  "kind": "aviso_privacidad",
  "granted": false,
  "noticeVersion": "aviso-2026-11-a1b2c3",
  "sourceMessageId": "msg_…"
}
```

- `kind`: `aviso_privacidad` o `marketing`. `noticeVersion`: 1 a 100 caracteres. `sourceMessageId`: opcional; el mensaje que contiene la respuesta (puede borrarse después: no es llave foránea).
- `201 { "id": "cns_…", "createdAt": "…" }`.
- Solo agrega. No hay edición ni borrado por esta API.
- `404 not_found` si la conversación no es de la organización.

## 4. `POST /api/bot/forget` (nuevo)

```json
{ "conversationId": "cv_…", "reason": "no_acepta" }
```

- **Exige un rechazo:** el último consentimiento `aviso_privacidad` de esa conversación debe tener `granted: false`. Si no: `409 sin_rechazo`, nada se borra.
- **Borra:** todos los mensajes de la conversación, sus adjuntos (fila y archivo, con `deleteMediaFile`) y las filas de `webhook_event` de la organización que traían esos `wa_message_id`.
- **Conserva:** el contacto, la conversación (vacía), el lead, sus etapas y los consentimientos.
- `200 { "deleted": <número de mensajes> }`. Repetirlo da `deleted: 0`.
- Publica `conversation.updated`. No manda `conversation.deleted`: quien lo pidió es el cerebro.
- **Orden esperado del cerebro:** `consent` (rechazo) → `forget` → `messages` con el texto fijo de «no acepta». Ese texto es lo único que queda.

## 5. `GET /api/bot/history` (nuevo)

```
GET /api/bot/history?conversationId=cv_…&limit=20
```

- `limit`: 1 a 50, por defecto 20. Los últimos `limit` mensajes, devueltos en orden de llegada (el más viejo primero).

```json
{
  "conversationId": "cv_…",
  "messages": [
    {
      "id": "msg_…",
      "at": "2026-11-09T15:00:00.000Z",
      "direction": "in",
      "type": "text",
      "text": "[mensaje con información de salud omitido]",
      "origin": null,
      "aiGenerated": false,
      "privacyFlags": ["salud", "urgencia"]
    },
    {
      "id": "msg_…",
      "at": "2026-11-09T15:00:04.000Z",
      "direction": "out",
      "type": "interactive",
      "text": "Antes de seguir, ¿aceptas…",
      "origin": "ai",
      "aiGenerated": true,
      "buttons": [{ "id": "aviso_acepto", "title": "Acepto" }]
    }
  ]
}
```

- `privacyFlags`, `buttonId` y `buttons`: solo si hay.
- El texto es el guardado: ya filtrado desde la fase 3.2.
- Nunca incluye notas internas (`conversation_note`) ni datos de otra conversación.
- `404 not_found` si la conversación no es de la organización.

## 6. `GET /api/bot/context`

Llave nueva:

```json
"consent": {
  "avisoPrivacidad": { "granted": true, "noticeVersion": "aviso-…", "at": "…" },
  "marketing": null
}
```

El último registro de cada tipo para el contacto, o `null` si no hay ninguno.

## 7. `POST /api/bot/handoff`

`reason` sigue siendo texto libre con fallback a `modelo`. El catálogo suma:

| Motivo | Rótulo (Resultados y el hilo) | Equivale en `aliantis-core` |
| --- | --- | --- |
| `salud` | Información de salud: la atiende una persona | `salud` (también cuando la segunda red marcó `urgencia`: no se afirma urgencia) |
| `reclamo` | Reclamo del cliente | `reclamo` |
| `no_entiende` | El agente no entendió | `no_se` |
| `agendar` | Quiere agendar | `agendar` |
| `tope_gasto` | Se alcanzó el tope de gasto del agente | `tope_gasto` |
| `medios` | Envió un adjunto | `medios` |

Equivalencias sin motivo nuevo: `pedido_paciente` → `cliente`, `errores` → `error`, `otro` → `modelo`. `bot_pausado` no se usa: con el Agente apagado el CRM no despacha (salvo salud) y la bandeja ya es de una persona.

## 8. `POST /api/bot/reset` — ⚠ restringe

En una conversación con `is_test = false`: `409 solo_laboratorio`, sin cambios. En el Laboratorio, igual que hoy.

## 9. Códigos nuevos

| Código | HTTP | Cuándo |
| --- | --- | --- |
| `organizacion_requerida` | 409 | Varias organizaciones y no vino la cabecera |
| `canal_sin_botones` | 409 | `buttons` en un canal que no los admite |
| `agente_apagado` | 409 | Agente apagado y el mensaje no es de seguridad válido |
| `sin_rechazo` | 409 | `forget` sin un rechazo registrado |
| `solo_laboratorio` | 409 | `reset` en una conversación real |
