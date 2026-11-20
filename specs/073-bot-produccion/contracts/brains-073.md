# Contrato 073 — Cambios aditivos entre `vocero-crm` y el cerebro

Todo lo de aquí **crece**: un cerebro que no lo conozca sigue funcionando igual.

## 073-A

### §1 `POST /api/brains/messages` — fallos del canal

| Antes | Ahora | Cuándo |
|---|---|---|
| 502 `{error:{code: <código interno>}}` | **422** `{error:{code: "envio_permanente", message}}` | Meta/Zernio rechazó el envío y reintentar no lo cambia (destinatario inválido, re-engagement `131047`, número no disponible `131026`, token caducado…). `message` incluye el código de Meta cuando existe. |
| 502 | **503** `{error:{code: "meta_unavailable", message}}` | El canal no está disponible ahora (5xx de Meta, red). Reintentable. |

- Los demás códigos no cambian (`404 not_found`, `409 ai_paused|sandbox_violation|message_limit|cerebro_reasignado`, `422 fuera_de_ventana|invalid_body|despacho_desconocido`, `403 organizacion_suspendida`).
- `POST /api/bot/messages` (instancia raíz) **no cambia** (`docs/openapi.json` intacto: 502).
- Un cerebro viejo trata 422/503 como cualquier error no-409: compatible.

Lectura recomendada para el cerebro: `422` (que no sea `fuera_de_ventana`) y
`400/404/413` → terminal, sin reintento ni cola; `5xx/503/429` → reintentable.

### §2 Motivos de handoff

`POST /api/brains/handoff` y `POST /api/bot/handoff` aceptan además:

| `reason` | Significado |
|---|---|
| `sin_saldo` | El proveedor de IA rechazó la llave por saldo (402) o el CRM no tiene credencial. |
| `opt_out` | El cliente pidió no recibir más mensajes (Ley 1581). Se usa desde 073-B. |
| `abuso` | Flood/abuso detectado. Se usa desde 073-B. |

Un CRM anterior los convierte en `modelo` (fallback de siempre, nunca 422).

## 073-B (previsto, se fija al arrancar la ronda)

- `GET /api/brains/context` → `humanGap?: { since, messages: [{ at, author: "lead"|"humano", text }] }`, `humanHours?: { available, nextOpenAt }`.
- `POST /api/brains/handoff` → `summary?: string` (≤500).
- Perfil/config del cerebro → `llm.temperature?`, `llm.fallbackModel?`.
