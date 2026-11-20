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

## 073-B (fijado 2026-11-20)

Documentado también en `docs/openapi-brains.json`. Todo opcional: un cerebro
que no lo lea se porta como en 073-A.

### §3 `GET /api/brains/context` — campos nuevos

| Campo | Forma | Cuándo viaja |
|---|---|---|
| `humanGap` | `{ since, until, messages: [{ at, author: "lead"\|"humano", type, text \| null }] }` | Hubo un tramo atendido por una persona (de `handoffAt`/pausa manual a la reanudación) y la IA **todavía no** contestó después de reanudar. ≤20 mensajes, ≤2000 caracteres (lo último gana). Sin notas internas ni mensajes fallidos. El cerebro lo inyecta una vez y **no** lo guarda en su historial. |
| `humanAvailable` | `boolean` | El negocio configuró su horario humano (Ajustes → Agente o Blueprint `humanHours`). |
| `nextOpenAt` | `string (ISO UTC) \| null` | Con `humanAvailable`; `null` si está abierto o no abre en 14 días. |
| `llm.temperature` | `number` (0–2) | Siempre que `llm` no sea `null`. La fija la plataforma (Blueprint `bot.temperature`, default 0.4). |

> El contrato previo decía `humanHours: { available, nextOpenAt }`; se fijó
> en `humanAvailable`/`nextOpenAt` de primer nivel, como se pidió al arrancar
> la ronda.

El modelo de respaldo (`bot.fallbackModel`) **no** viaja al cerebro: el proxy
de `/api/brains/llm` lo agrega como `models: [principal, respaldo]` cuando el
proveedor es OpenRouter y el cuerpo no trae su propia lista.

### §4 `POST /api/brains/handoff` (y `/api/bot/handoff`)

- `summary?: string` — se recorta a 500 (no se rechaza) y queda como nota
  interna del sistema «Resumen del agente…». Llega aunque la conversación ya
  estuviera pausada.
- `reason: "opt_out"` — además de pausar, el CRM registra la baja
  (`contact.optOutAt`, origen `agente`), le envía al cliente la confirmación
  fija **una vez** y deja una nota interna. El cerebro no debe escribir nada
  más en ese turno.

### §5 Bloqueos nuevos (sin cambio de forma)

- `POST /api/brains/messages` con el contacto dado de baja → `409 ai_paused`
  (también cubre los seguimientos del cerebro).
- El despacho no sale con el contacto dado de baja ni por encima del tope
  anti-flood (25/h y 80/día por conversación, 500/día por negocio por defecto;
  Blueprint `bot.limits`). Al superar el tope: incidente `abuso` + nota interna;
  la IA sigue encendida.

### §6 Herramientas reservadas

`solicitar_baja` se suma a `RESERVADOS` (ningún módulo puede llamarse así).

## 073-C (fijado 2026-11-20)

### §7 Evento de despacho — campos nuevos (aditivos)

Documentados en `docs/openapi.json` (esquema `Mensaje`). Van al final de cada
mensaje y solo cuando aplican: un despacho sin cita ni tarjetas es byte a byte
el de antes.

| Campo | Forma | Cuándo |
|---|---|---|
| `messages[].replyTo` | `{ id, author: "lead"\|"negocio", type, text \| null }` (`text` ≤ 500) | El cliente respondió citando un mensaje que está en la conversación. |
| `messages[].contacts[].phones` | `string[]` (≤ 3 por tarjeta) | La tarjeta de contacto trae teléfonos. |

- Las **reacciones** (👍) se guardan en la bandeja como `type: "reaction"` y
  **no** se despachan (ni extienden la ventana de 24 h). Un cerebro que aun así
  reciba una (CRM anterior) debe ignorarla.
- Las **etiquetas** de horario (`label` de slots y citas) van en 12 h
  («lun 23 nov, 3:00 p. m.»). Lo que es dato (`startUtc`, `start_utc`) sigue
  en ISO: el cerebro reserva con eso, nunca con la etiqueta.

### §8 Lo que Nea garantiza desde 073-C (sin cambio de contrato)

- Un posible comprobante de pago termina en `handoff` con `summary` que
  empieza por «Posible comprobante de pago — validar en banco antes de
  confirmar.» (decisión #4).
- Una respuesta prometiendo un asesor sin `handoff` registra el handoff con
  `reason: "modelo"`. Una pregunta («¿te paso con un asesor?») o una oferta
  condicional («si quieres…») no es promesa y no lo dispara.
- Las citas de `next`/`last` del contexto llevan la hora en 12 h en `label`
  (el día sigue completo y relativo: «hoy lunes, 14 de septiembre, 10:30 a. m.»).
