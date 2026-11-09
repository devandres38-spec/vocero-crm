# Contrato — Despacho v2 (CRM → cerebro)

Enmienda aditiva a `specs/021-despacho-estandar/contracts/despacho.md`. La firma, las cabeceras, los reintentos y `conversation.deleted` no cambian.

**Regla de compatibilidad:** cada llave nueva viaja **solo si aplica**, al final del objeto que la contiene, como `test` y `fileName`. Un despacho sin nada nuevo es idéntico byte a byte al de hoy: el cuerpo y la firma gemelos de `tests/unit/despacho-contrato.test.ts` no cambian.

## Llaves nuevas

### `conversation.agentEnabled`

```json
"conversation": { "id": "cv_…", "channel": "whatsapp", "aiEnabled": true, "windowOpen": true, "windowExpiresAt": "…", "agentEnabled": false }
```

- Solo viaja con valor `false`: cuando el interruptor del Agente está apagado y aun así se despacha porque un mensaje de la ráfaga trae la marca `salud` (D8 de la spec).
- Va después de `windowExpiresAt` y antes de `test`. Las dos llaves no coinciden en la práctica: una conversación de prueba no pasa por esta regla.
- **Qué debe hacer el cerebro:** solo la regla de salud (frase fija con `motivo: "seguridad"` y traspaso con `salud`). Nada más: el CRM rechaza cualquier otro mensaje (`409 agente_apagado`).

### `messages[].privacyFlags`

```json
{ "id": "msg_…", "at": "…", "type": "text", "text": "[mensaje con información de salud omitido]", "mediaId": null, "privacyFlags": ["salud", "urgencia"] }
```

- Solo si el mensaje tiene marcas. Valores: `salud`, `urgencia`, `sintoma`, `condicion`, `medicamento`, `sin_revisar`, `correo`, `telefono`, `documento`, `tarjeta`. Son los de `privacyFlagsOf` en `aliantis-core/src/privacy/privacy-filter.ts`.
- `text` ya viene filtrado (desde la fase 3.2). El cerebro vuelve a filtrar como defensa.
- Va al final del mensaje, después de `contacts`.

### `messages[].buttonId`

```json
{ "id": "msg_…", "at": "…", "type": "text", "text": "No acepto", "mediaId": null, "buttonId": "aviso_no_acepto" }
```

- Solo si el cliente tocó un botón. `text` sigue siendo el rótulo, como hoy.
- Va después de `privacyFlags`, si las dos existen.

## Cuándo se despacha (cambio)

| Agente | Persona atendiendo | La ráfaga trae `salud` | Se despacha |
| --- | --- | --- | --- |
| Encendido | No | Da igual | Sí (como hoy) |
| Apagado | No | Sí | **Sí, con `agentEnabled: false`** |
| Apagado | No | No | No (como hoy) |
| Da igual | Sí | Da igual | No (como hoy) |
| Laboratorio | — | — | Lo despacha el Laboratorio, como hoy |

## Lo que no cambia

- La firma: `HMAC-SHA256(cuerpo_crudo, BOT_API_KEY)`. El cerebro verifica con el secreto del despliegue y lee el negocio de `organization.id`. Para contestar usa la credencial derivada de ese id (`bot-api-v2.md`, sección 1).
- `X-Vocero-Organization` en el despacho sigue llevando el slug o el id, como hoy. El cerebro usa `organization.id` del cuerpo, no la cabecera.
- `conversation.deleted`: igual.
