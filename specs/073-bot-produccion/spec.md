# Feature Specification: Bot de Producción — Cero silencios, Humano↔Bot, seguridad y Colombia

**Feature Branch**: `feat/073-bot-produccion` (en `vocero-crm` y `nea-agent`, creadas desde `main`)
**Created**: 2026-11-19
**Status**: Aprobada (D1–D7, D10 y las 10 respuestas de producto, 2026-11-19) — en implementación (Ronda 073-A)
**Carril**: **Ciclo completo** (Principio VI): migraciones aditivas (`0035_bot_incident` en el CRM, `010_reanudacion` en Nea), crecimiento aditivo de `/api/brains/messages` y de los motivos de handoff, y un cambio coordinado entre los dos repositorios.
**Constitución**: 2.0.0 (Principios I, III, IV, V, VI, IX, X, XI; restricción «Contratos entre repositorios»).
**Repos**: `vocero-crm` · `nea-agent`.
**Auditado contra**: `vocero-crm@a86916d` y `nea-agent@fc36f91` (`main` tras 2.13.1).
**Insumo**: `../DIAGNOSTICO-BOT-COLOMBIA-KB.md` (P-1…P-12) y el análisis crítico del 2026-11-19.
**Contrato**: [contracts/brains-073.md](contracts/brains-073.md).
**Fuera de esta spec**: KB de producción, «Probar mi agente», `llm_usage` + panel de incidentes y Laboratorio v2 → **Spec 074** (D8, D9).

---

## 1. Qué queremos lograr

El Bot (Nea + toda la superficie de despacho, bandeja y handoff del CRM) tiene que
aguantar producción real en Colombia antes del primer módulo comercial. Hoy se cae
de cuatro maneras que el cliente final sí ve:

1. **Silencio negro**: el cliente escribe y nadie contesta — ni el bot ni una
   persona, porque nadie se enteró (P-2, P-4, `post_handoff` sin reintento).
2. **Apagón permanente de la IA por un fallo pasajero**: un redeploy de 15–60 s
   en Coolify deja `aiEnabled=false` en todos los chats activos (P-8); una
   llave sin saldo llena la bandeja de handoffs falsos con motivo «modelo»
   (punto ciego n.º 1).
3. **Respuestas obsoletas o perdidas**: `pending_send` entrega 23 h después; un
   rechazo permanente de Meta se reintenta 24 h (P-11c); un `sendText` fallido
   no deja rastro en la bandeja.
4. **Ceguera**: nadie ve qué falló, cuándo ni en qué conversación.

Y después: continuidad Humano↔Bot, seguridad conversacional y anti-flood (073-B), y
calidad conversacional + localización Colombia (073-C).

## 2. Partición (aprobada)

| Ronda | Contenido | Por qué en este orden |
|---|---|---|
| **2.13.1** (hecha) | `_quiza_por_los_extras`, `has_knowledge`, `LLM_MAX_TOKENS`, `parseFichaValue`, `computeScore`, `marcarEscribiendo` | Bugs de una línea, sin contrato. Fusionada (`a86916d`/`fc36f91`). |
| **073-A** | Cero silencios y cero apagones: P-2, P-3, P-8, P-11(c), handoff resiliente, cascada por 402, `bot_incident`, cierre ordenado y reanudación de Nea | Mayor riesgo de producción. Casi todo backend, contrato aditivo mínimo. |
| **073-B** | Humano↔Bot (P-1, D1), nota/resumen de handoff, filtro «Atención humana», inyección y anti-flood (P-9, D4), opt-out Ley 1581 y horario humano (P-12, D6 parcial) | Usa los motivos nuevos y `bot_incident` de A. Contrato aditivo (`humanGap`, horario). Primer `DELTAS_073`. |
| **073-C** | P-5, P-6, P-7, guardrails post-turno (incl. `<think>`), `confirmacion.py`, localización Nea + CRM, 12 h en presentación, `es_CO` | Cambia texto del chasis: va después de B para tocar `DELTAS_073` una sola vez. |

## 3. Respuestas de producto aprobadas (2026-11-19)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Pausa al responder desde Bandeja | **Siempre** pausa, reutilizando `manual_reply` (sin botón extra). → 073-B |
| 2 | Auto-reactivación | **No** tras pausa humana. **Sí** evitar que un fallo técnico transitorio apague `aiEnabled` para siempre. → 073-A |
| 3 | Despacho caducado por caída del cerebro | `bot_incident` + nota interna **sin apagar `aiEnabled`**: el siguiente mensaje del cliente vuelve a intentar con IA. → 073-A |
| 4 | Comprobante de pago (Nequi/Daviplata/Bancolombia) | Handoff obligatorio + nota «posible comprobante — validar en banco antes de confirmar». → 073-C |
| 5 | Topes anti-flood | Los fija la plataforma (`/platform`, Blueprint por plan). Defaults **25/h y 80/día por conversación; 500/día por organización**. → 073-B |
| 6 | Opt-out (Ley 1581) | Bloquea IA, plantillas y seguimientos; respuesta humana permitida dentro de la ventana con banner; **no** se revierte con un mensaje cualquiera. → 073-B |
| 7 | Horario humano | Uno por negocio, con toggle de festivos de Colombia (Ley Emiliani). → 073-B |
| 8 | Modelo fallback | Lo fija la plataforma con `models: [principal, fallback]` de OpenRouter, oculto al cliente. → 073-B (cableado) |
| 9 | «Probar mi agente» | Usa la BYOK del cliente; 40 mensajes/día por organización. → 074 |
| 10 | `temperature` | La fija la plataforma, default **0.4**, oculta al cliente. Nea la lee del entorno (073-A) y del perfil cuando el CRM la mande (073-B). |

**Modelo de producción**: GLM-5.3-Flash vía OpenRouter (multimodal, tool-calling).
- `LLM_MAX_TOKENS=2048` con una repetición al doble ante `finish_reason=length` (2.13.1, aprobado).
- 073-C: el filtro post-turno bloquea `<think>…</think>` si el proveedor lo emite en `content`.

---

## 4. Ronda 073-A — Cero silencios y cero apagones

### Historias

**US-A1 — El cliente nunca queda en silencio negro (P1).**
Si el bot no puede contestar —agotó las rondas de herramientas, el modelo no da
texto, la respuesta es inválida dos veces, el proveedor rechaza la llamada—, la
conversación pasa a una persona con un motivo que dice la verdad.

- AS-1: con `MAX_TOOL_ROUNDS` agotado, Nea hace UNA llamada final **sin herramientas**; si trae texto, lo envía; si no, handoff `error`.
- AS-2: el reintento tras `_respuesta_invalida` corre **sin herramientas** (no repite efectos: citas, ficha, etapa).
- AS-3: un 402 del proveedor (o `sin_credencial` del CRM) termina en handoff **`sin_saldo`**, no `modelo` ni `error`.
- AS-4: si `post_handoff` falla tras la despedida, se reintenta en el turno y, agotado, queda en la cola durable (`pending_send`, tipo `handoff`) hasta 24 h.

**US-A2 — Un fallo pasajero no apaga la IA (P1).**
- AS-5: un redeploy del cerebro de hasta ~3 min no caduca los despachos: el outbox reintenta 6 veces con espera 2 → 120 s (solo red/429/5xx), dentro de `VIDA_DESPACHO_MS` (10 min).
- AS-6: si aun así el despacho caduca (o el cerebro lo rechaza), se registra `bot_incident` + nota interna en la conversación y **`aiEnabled` sigue en `true`**: el siguiente mensaje del cliente vuelve a despacharse.
- AS-7: Nea, al recibir SIGTERM, deja de reclamar despachos y espera los turnos en curso hasta `NEA_SHUTDOWN_GRACE_SECONDS` (25 s).
- AS-8: al arrancar, un despacho que quedó a medias **sin haber enviado nada ni ejecutado herramientas** se vuelve a correr (hasta 2 veces); con efectos, handoff como hoy.
- AS-9: el worker del CRM entrega hasta 4 despachos en paralelo, máximo 2 por organización: un cerebro colgado de un negocio no frena a los demás.

**US-A3 — Sin saldo no hay cascada (P1).**
- AS-10: en modo plataforma, con la llave de IA del negocio pausada (`paused_no_credit`/`paused_invalid_token`) o sin configurar, `despacharAlCerebro` **no encola**; registra `bot_incident` (`sin_saldo` o `sin_credencial`, agrupado por hora) y la conversación queda en la bandeja **sin** handoff falso.

**US-A4 — Lo que no sale, se ve; lo viejo, no sale (P2).**
- AS-11: `/api/brains/messages` responde **422 `envio_permanente`** cuando Meta rechaza el envío de forma permanente (con el código de Meta en `message`) y **503 `meta_unavailable`** cuando es pasajero.
- AS-12: Nea trata `400/404/413/422` del envío como terminales: no reintenta ni encola; handoff `error`.
- AS-13: `pending_send` caduca a los **15 min** (`PENDING_SEND_MAX_MINUTES`): al caducar, handoff `error` y la respuesta NO se entrega.
- AS-14: un `sendText` que falla en Meta/Zernio deja el mensaje `failed` en la bandeja (como ya hacían los adjuntos), visible para el operador.

**US-A5 — Lo que falla, queda registrado (P2).**
- AS-15: tabla `bot_incident` (organización, conversación opcional, tipo, detalle, conteo, primera/última vez, clave de agrupado) con purga a los 90 días en el barrido existente.
- AS-16: motivos de handoff nuevos `sin_saldo`, `opt_out`, `abuso` en el catálogo de ambos repos, con su etiqueta en la bandeja y en Resultados. Un CRM viejo los recibe como `modelo` (fallback ya existente): compatible.

**US-A6 — El modelo responde estable (P2).**
- AS-17: `temperature` por defecto **0.4** (`LLM_TEMPERATURE`), sobreescribible por el perfil/configuración del negocio cuando el CRM la mande. Si el proveedor la rechaza (400 que la nombra), se apaga 1 h igual que los ajustes de velocidad.
- AS-18: errores `400/401/402/403/422` del proveedor se cortan **sin reintentar** (salvo el 400 de los ajustes, que reintenta sin ellos, y el de visión) con causa tipada; `429` y `5xx` reintentan con jitter respetando `Retry-After` (tope 10 s).

### Requisitos funcionales (073-A)

- **FR-A01** Nea nunca termina un turno con lead esperando sin texto enviado ni handoff registrado (o encolado).
- **FR-A02** Ningún fallo técnico transitorio del lado del CRM pone `aiEnabled=false`.
- **FR-A03** Todo despacho caducado, toda llave pausada que frena despachos y todo envío permanente fallido deja un `bot_incident`.
- **FR-A04** Las migraciones son aditivas y re-ejecutables; los contratos solo crecen.
- **FR-A05** Las 6 doradas B0 (y las de 071/072) siguen idénticas byte a byte: 073-A no cambia el texto del prompt.

### Criterios de éxito (073-A)

- SC-A1: matar Nea 60 s con chats activos no deja ninguna conversación con `aiEnabled=false` (staging).
- SC-A2: una llave sin saldo con 50 mensajes entrantes produce 0 handoffs y ≤1 incidente por hora.
- SC-A3: 0 respuestas entregadas con más de 15 min de retraso.
- SC-A4: gates locales verdes (typecheck, lint, Vitest 1 worker, pytest) y CI/staging verdes antes de fusionar.

### Fuera de 073-A
Pausa desde Bandeja y `humanGap` (073-B), anti-flood (073-B), filtro «Atención
humana» (073-B), panel de incidentes (074), cambios de texto del chasis (073-B/C).

---

## 5. Ronda 073-B — Humano↔Bot y seguridad (resumen; se detalla al arrancarla)

- **D1** `sendText` desde la Bandeja pausa con `manual_reply` (helper compartido con el eco de `ingest.ts`). El contexto trae `humanGap`: los mensajes de asesor y cliente desde `handoffAt` hasta la reanudación (≤20 mensajes, ≤2000 caracteres), que Nea inyecta UNA vez como nota de sistema, sin guardarlos en `bot_message`.
- **D2 (resto)** Nota interna de handoff con `summary` (≤500 caracteres, aditivo en `POST /api/brains/handoff`); filtro «Atención humana» en la Bandeja por `handoffAt`.
- **D4** Datos no confiables (nombre, titular del anuncio, PDF, ficha) en bloques delimitados y saneados; marcadores del sistema con prefijo que el lead no puede escribir y neutralización del texto del lead. Anti-flood en `encolar.ts` contando la tabla `dispatch` (25/h, 80/día por conversación; 500/día por org; configurables en Blueprint) → no despacha + nota + `bot_incident` `abuso`.
- **D6 (parte)** Horario humano por negocio (tipo `Interval` existente) + festivos CO opcionales → `humanAvailable`, `nextOpenAt` en el contexto. Opt-out: `contact.optOutAt`/`optOutSource`, detector determinista en el CRM + tool `solicitar_baja`; bloquea IA, plantillas y seguimientos; handoff `opt_out`.
- Modelo fallback y `temperature` desde `/platform` (Blueprint) hacia el perfil del cerebro.
- `DELTAS_073` (primer bloque) sobre los dorados B0.

## 6. Ronda 073-C — Calidad conversacional y Colombia (resumen)

- **D5** Marcador de imagen en pasado; política de comprobantes (handoff + nota, decisión #4); máx. 3 imágenes por turno; `replyTo` y teléfonos de vCard (aditivos); partición por límite del canal; descarte de respuesta si llegó un despacho más nuevo sin efectos; reacciones a la bandeja sin despacho.
- **D6 (resto)** Ventana de 20 mensajes con presupuesto; separador «— N días después —» solo con hueco > 6 h; `max_mensajes` de `stall` apagado sin agenda; stickers como relleno por tipo.
- **D7** Validador post-turno: promesas de cita/handoff sin la herramienta con éxito, nombres de herramientas, `<tool_call>`, notas parciales y **`<think>…</think>`** → corrección sin herramientas. `confirmacion.py` (URL con puntuación, profesional, Maps). `dia_confirmado` validado. `hostility.py`/`stall.py` con léxico colombiano y pruebas negativas (*parce*, *qué chimba*). Mexicanismos fuera vía `DELTAS_073`. `es_CO` desde `region.locale`, `formatPhone` con libphonenumber, 12 h solo en presentación (el JSON sigue en 24 h).

## 7. D10 — Contratos, migraciones y doradas

- Contratos: solo aditivos ([contracts/brains-073.md](contracts/brains-073.md)). En 073-A: códigos `envio_permanente` (422) y `meta_unavailable` (503) en `POST /api/brains/messages`; motivos `sin_saldo`, `opt_out`, `abuso` aceptados en `POST /api/brains/handoff` y `/api/bot/handoff`. `/api/bot/messages` (raíz) no cambia.
- Migraciones: CRM `0035_bot_incident` (tabla nueva); Nea `010_reanudacion` (columnas nuevas con default en `dispatch_inbox` y `pending_send`). Re-ejecutables.
- Doradas: los dorados B0 **nunca** se regeneran; los cambios de texto de 073-B/C se declaran en `DELTAS_073` y se aplican encima, como `DELTAS_071`.
