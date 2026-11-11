# 071 — Ficha y notas sin salud, motivos, salud con el bot pausado, avisos, historial, omisión y envío idempotente (bloque D)

**Pasos 3.6, 3.7, 3.8 y 3.10** del plan maestro (`RELEVO_ARQUITECTURA.md` §9), más tres piezas de la spec **067** que no tenían bloque (P4 del bloque C): `GET /api/bot/history`, `POST /api/bot/omit` y `clientMessageId`. El paso **3.9 (retención)** queda fuera: es borrado de datos por fecha y va solo (bloque E). Decisiones de Aliantis: D2, D4, D9, D10, D12 y T2/P2 de la 067. Spec-Kit en dos archivos; la 067 manda en lo que esta spec no precisa.

**Estado:** plan para aprobar. Nada de esto está programado. Lo marcado **(estimación)** no se pudo verificar en el código.

## Riesgo de cada paso

| Paso | Riesgo | Por qué | Sabotajes |
| --- | --- | --- | --- |
| 3.7 Motivos | Bajo | Catálogo y rótulos | 1 (opcional) |
| 3.6 Ficha y notas | Delicado | Privacidad: texto libre del equipo | 2 |
| History | Delicado | Aislamiento: no puede salir una nota ni otra organización | 1 |
| Omit | Delicado | Privacidad y borrado acotado a ids explícitos | 2 |
| `clientMessageId` | Delicado | Contrato: un reintento no puede enviar dos veces | 3 |
| 3.8 Salud con el bot pausado | Delicado | Seguridad del paciente y contrato | 2 |
| 3.10 Avisos | Delicado | Privacidad: un aviso sin nombre, teléfono ni texto | 3 |

Ningún paso toca autenticación por negocio, RLS, dinero, ni borra datos por fecha. `omit` borra filas de `webhook_event`, pero solo las de ids explícitos de una conversación (como `forget` en el bloque C), no por lotes.

## Decisiones

- **D1. Motivos de Aliantis (3.7, D10 y D9 de la 067).** `HANDOFF_REASONS` (`src/server/bot/handoff.ts`) suma `salud`, `reclamo`, `no_entiende`, `agendar`, `tope_gasto` y `medios`: exactamente los que manda el cerebro (`aliantis-brain/src/vocero/motivos.ts`, tipo `MotivoVocero`). Sigue el fallback a `modelo` para lo desconocido. Sus rótulos van en `HANDOFF_LABEL` (`src/lib/analytics.ts`, Resultados) y `HANDOFF_LABELS` (`src/lib/eventos-hilo.ts`, hilo y panel). Sin migración: `handoff_reason` es `text` sin `check`.
- **D2. Ficha y notas sin salud (3.6, D12).** Todo texto libre pasa por `filtrarTexto` con la política del negocio **antes de guardarse**, lo escriba el cerebro o una persona del equipo:
  - `conversation_note.texto`: `crearNota` (`src/server/notas.ts`);
  - `contact.notes`: `POST /api/contacts` y `PATCH /api/contacts/[id]`;
  - `booking.notes`: `createBooking` y el bloqueo de agenda (`src/server/agenda/service.ts`), que llaman `POST /api/bookings` y `POST /api/bot/bookings`. Como el filtro va antes de guardar, la copia que viaja al conector (Google, Zoom) también sale filtrada;
  - los **valores** de texto de la ficha: `upsertFicha` (`src/server/bot/ficha.ts`), la única puerta, que usan el cerebro y la bandeja. Números y booleanos no se tocan. Las **llaves** no se filtran (la lista blanca de llaves es la fase 5).
  - Sin perfil legible, el texto queda `[mensaje omitido: no se pudo revisar]` (D3 de la 068). Lo ya guardado no se re-filtra.
  - **Efecto visible:** una nota del equipo como «tiene diabetes, cel 3001234567» queda guardada como `[mensaje con información de salud omitido]`, y una con solo el teléfono, como «cel [telefono]». Es el pilar 4, que nombra las notas. La respuesta de cada ruta devuelve el texto ya filtrado, que es lo que la pantalla muestra.
  - **El cerebro no escribe notas (D12):** `POST /api/bot/bookings` acepta `notes`, para no romper el contrato, pero **lo descarta** (P5).
- **D3. Salud con el bot pausado (3.8, D8 de la 067).** Con el Agente apagado (`agent_profile.enabled = false`) y una conversación real:
  - **Encolar** (`despacharAlCerebro`, `src/server/dispatch/encolar.ts`): hoy no se despacha. Ahora se despacha si el entrante trae la marca `salud`. La ingesta pasa `salud: marcas.includes("salud")`. Con una persona atendiendo (`handoff_at` o `ai_enabled = false`) no se despacha nada, como hoy.
  - **Entregar** (`procesar`, `src/server/dispatch/worker.ts`): si el Agente está apagado al entregar y ningún mensaje del evento trae `salud`, se descarta («agente apagado»). Si alguno la trae, el evento lleva `conversation.agentEnabled: false` al final de `conversation`, solo cuando aplica (el gemelo no cambia). El cerebro ya lo acepta (`agentEnabled: z.literal(false).optional()`).
  - **Contestar** (`POST /api/bot/messages`): con el Agente apagado y una conversación real, solo pasa `motivo: "seguridad"` y solo si hay un entrante con la marca `salud` posterior al último saliente con `ai_generated = true`. Si no: `409 agente_apagado`. Así cabe **un** mensaje de seguridad por cada entrante de salud. `ai_paused` gana sobre todo. Con el Agente encendido, `motivo` se acepta y no cambia nada. El Laboratorio queda fuera de la regla.
- **D4. Historial (D10 de la 067, §5).** `GET /api/bot/history?conversationId=…&limit=…`: `limit` de 1 a 50 (20 por defecto). Devuelve los últimos `limit` mensajes de la conversación, del más viejo al más nuevo, con `id`, `at` (`wa_timestamp` o `created_at`), `direction`, `type`, `text` (el guardado, ya filtrado), `origin` (`null` en los entrantes), `aiGenerated`, y `privacyFlags`, `buttonId` y `buttons` solo si hay. Nunca trae `conversation_note`. Precisión sobre el ejemplo de la 067: un saliente con botones tiene `type: "text"` (D3 de la 070), no `interactive`. El cerebro acepta cualquier `type`.
- **D5. Omisión (§4b de la 067).** `POST /api/bot/omit` `{ conversationId, messageIds (1 a 20), reason: "salud" }`. Solo actúa sobre **entrantes** de esa conversación y organización; un id que no cumple se ignora.
  - Cambia: `text` pasa a `[mensaje con información de salud omitido]` si no era nulo; `privacy_flags` suma `salud`; el `caption` del adjunto queda nulo; y se borran las filas de `webhook_event` que traían esos `wa_message_id` (`borrarEventosDeWebhook`, del bloque C).
  - Responde `200 { omitted }` con el número de entrantes válidos. Repetirlo da el mismo número y no cambia nada más.
  - Publica `conversation.updated` y un evento SSE nuevo, `message.updated`, con el mensaje serializado, para que una bandeja abierta reemplace el texto (P3). Es aditivo al contrato SSE.
- **D6. Envío idempotente (T2 de la 067, §2).** `clientMessageId` opcional en `POST /api/bot/messages`, de 1 a 128 caracteres. Columna `message.client_message_id` con un índice único parcial por organización.
  1. Antes de llamar a Meta se **reserva** la llave: se inserta el mensaje saliente con `status = 'pending'`, `wa_message_id` NULL y la llave (`on conflict do nothing`).
  2. Si la llave ya existe:
     - el mensaje no falló y tiene `wa_message_id`, o ya está `sent`, `delivered` o `read` (también uno del Laboratorio): `200 { messageId, repetido: true }` y **no se envía nada**;
     - está `pending`, sin `wa_message_id` y tiene menos de **2 minutos**: `409 mensaje_en_curso`;
     - está `failed`, o `pending` sin `wa_message_id` desde hace 2 minutos o más (el proceso cayó a medias, P4): se vuelve a reservar con un `update … where` condicional y se intenta otra vez.
  3. El envío reutiliza `sendText` con una opción nueva, `reservado: messageId`, para que `persistOutbound` **actualice** esa fila en vez de insertar otra. Si Meta rechaza, la fila queda `failed` con su error (visible en el hilo, como un adjunto fallido).
  4. Sin `clientMessageId`, todo sigue como hoy. En el Laboratorio, `guardarRespuestaDePrueba` guarda la llave y un repetido devuelve `repetido: true`.
  5. La llave es de un negocio: la misma en dos organizaciones son dos mensajes.
- **D7. Avisos por Telegram (3.10, D4).** Conector **opcional** (constitución II, ADR-001): bandera `AVISOS`, apagada por defecto, con el patrón de `src/server/agenda/flag.ts`. Es un trasplante adaptado de `aliantis-core/src/notify/`.
  - **Configuración (P1):** un solo bot de Aliantis, `TELEGRAM_BOT_TOKEN`, que va en el entorno del despliegue y nunca en el repo ni en el chat. Un grupo por negocio, en la tabla `aviso_canal`, que solo registra Andres con `pnpm avisos:grupo -- --organizacion <id> --chat <id>`. `TELEGRAM_API_BASE_URL` existe solo para el mock del E2E.
  - **Cuándo:** cada traspaso nuevo, al poner `handoff_at`: `POST /api/bot/handoff` y la caída a humano del despacho (`outbox.ts`, motivo `error`). **No** `manual_reply`: ahí el negocio ya contestó desde su teléfono (P2). Se inserta una fila `pendiente` en `aviso_traspaso` y el worker la envía en la siguiente tanda.
  - **Texto, sin datos del paciente** (sin nombre, teléfono ni texto; el nombre del negocio sí): `«{negocio}: nueva derivación ({motivo}). Ref. {8 primeros caracteres del id de la conversación} · {N} pendientes. Revisa la bandeja.»`. Los rótulos de motivo son los de D1.
  - **Seguimiento:** si la persona vuelve a escribir mientras el traspaso sigue abierto (`handoff_at` puesto) y el aviso ya salió: `«{negocio}: la persona de la ref. {ref} escribió otra vez.»`. **Como máximo uno cada 30 minutos por traspaso**, con un `update … where` condicional sobre `last_followup_at`.
  - **Reintentos:** el worker del despacho (`tanda`, después de los olvidos del bloque C) reintenta los `pendiente`. Un error no reintentable (token inválido o grupo inexistente) pasa a `fallido` de inmediato; uno pasajero, a los **60 minutos**. El log dice qué revisar y nunca lleva el token, el texto del aviso ni la URL.
  - **Casos sin envío:** sin `aviso_canal` para el negocio, la fila queda `omitido` con un aviso en el log. Con `AVISOS` apagado no se inserta nada.

## Modelo de datos — migración `0030_contrato_y_avisos.sql`

Generada con `pnpm db:generate`. **Aditiva:** solo columnas nulas e índices sobre columnas nuevas, y tablas nuevas. No transforma datos existentes.

**`message`:** `client_message_id text NULL` e índice único parcial `message_org_client_msg_uq (organization_id, client_message_id) where client_message_id is not null`.

**`aviso_canal`:**

| Columna | Tipo | Nota |
| --- | --- | --- |
| `organization_id` | `text` PK | FK `organization`, `on delete cascade` |
| `telegram_chat_id` | `text` NOT NULL | `check (telegram_chat_id ~ '^-?[0-9]{1,20}$')` |
| `created_at` / `updated_at` | `timestamp` NOT NULL default `now()` | |

**`aviso_traspaso`:**

| Columna | Tipo | Nota |
| --- | --- | --- |
| `id` | `text` PK | prefijo `avs` |
| `organization_id` | `text` NOT NULL | FK `organization`, `on delete cascade` |
| `conversation_id` | `text` NOT NULL | FK `conversation`, `on delete cascade` |
| `handoff_at` | `timestamp` NOT NULL | el `handoff_at` de la conversación al traspasar |
| `reason` | `text` NOT NULL | el motivo del catálogo |
| `status` | `text` NOT NULL default `'pendiente'` | `check (status in ('pendiente','enviado','fallido','omitido'))` |
| `attempts` | `integer` NOT NULL default 0 | |
| `notified_at` | `timestamp` NULL | |
| `last_followup_at` | `timestamp` NULL | |
| `created_at` / `updated_at` | `timestamp` NOT NULL default `now()` | |

Índices: único `aviso_traspaso_conv_handoff_uq (conversation_id, handoff_at)` (un aviso por traspaso) y parcial `aviso_traspaso_pendiente_idx (created_at) where status = 'pendiente'`.

## Contrato

| Ruta | Éxito | Errores nuevos |
| --- | --- | --- |
| `POST /api/bot/messages` (+ `motivo`, `clientMessageId`) | `200 { messageId }` · `200 { messageId, repetido: true }` | `409 agente_apagado` · `409 mensaje_en_curso` |
| `GET /api/bot/history` | `200 { conversationId, messages }` | `404 not_found` · `422 invalid_body` (`limit` fuera de rango) |
| `POST /api/bot/omit` | `200 { omitted }` | `404 not_found` · `422 invalid_body` |
| `POST /api/bot/handoff` | sin cambios | (catálogo ampliado, mismo fallback) |
| `POST /api/bot/bookings` | sin cambios | `notes` se descarta |

Todas resuelven la organización como hoy (`requireBotKey` + `resolveInstanceOrg`); la credencial por negocio es el paso 4.1. **Despacho:** `conversation.agentEnabled: false` solo cuando aplica, al final de `conversation`. **SSE:** `message.updated`. Se ponen al día `docs/openapi.json` (que tiene prueba), `AGENTS.md` y la enmienda de `specs/021-despacho-estandar/contracts/despacho.md`.

## Archivos

**Vocero, por paso:**

| Paso | Archivos |
| --- | --- |
| Migración | `src/lib/db/schema.ts`, `src/lib/db/ids.ts` (`avisoTraspaso: "avs"`), `drizzle/0030_*` |
| 3.7 | `src/server/bot/handoff.ts`, `src/lib/analytics.ts`, `src/lib/eventos-hilo.ts`, `docs/openapi.json` |
| 3.6 | `src/server/notas.ts`, `src/app/api/contacts/route.ts`, `src/app/api/contacts/[id]/route.ts`, `src/server/agenda/service.ts`, `src/app/api/bot/bookings/route.ts`, `src/server/bot/ficha.ts`; ayudante `filtrarTextoLibre(org, texto)` en `src/server/privacy/filtrar.ts` |
| History | `src/app/api/bot/history/route.ts` (nueva), `src/server/bot/historial.ts` (nuevo) |
| Omit | `src/app/api/bot/omit/route.ts` (nueva), `src/server/inbox/omitir.ts` (nuevo), `src/server/events/bus.ts`, `src/components/use-events.ts` y el cliente de la bandeja que ya maneja `message.media` |
| `clientMessageId` | `src/server/bot/mensaje-del-bot.ts`, `src/app/api/bot/messages/route.ts`, `src/server/inbox/send.ts` (`reservado`), `src/server/bot/envio-idempotente.ts` (nuevo), `src/server/lab/sandbox.ts` |
| 3.8 | `src/server/dispatch/encolar.ts`, `src/server/inbox/ingest.ts` (la marca), `src/server/dispatch/worker.ts`, `src/server/brains/contract.ts` y `deliver.ts` (`agentEnabled`), `src/app/api/bot/messages/route.ts` |
| 3.10 | `src/server/avisos/` (nuevo: `flag.ts`, `telegram.ts`, `avisos.ts`, `textos.ts`), `src/app/api/bot/handoff/route.ts`, `src/server/dispatch/outbox.ts`, `src/server/dispatch/worker.ts`, `src/server/inbox/ingest.ts` (el seguimiento), `scripts/avisos-grupo.ts` y `package.json`, `src/app/api/dev/telegram-mock/` (mock tras `dev-guard`), `.env.example`, `.github/workflows/ci.yml` (`AVISOS=on` en la configuración `completo`) |
| E2E | `scripts/e2e-contrato-aliantis.mjs` y `tests/e2e/us-contrato-aliantis.md` (los nombres de la 067), `.github/workflows/e2e.yml` |

**Cerebro:** sin cambios de código. Su cliente ya usa `history`, `omit`, `clientMessageId`, `motivo: "seguridad"` y estos motivos. Solo `CLAUDE.md`, por el método.

## Casos borde

- Un motivo nuevo con mayúsculas o espacios: se normaliza, como hoy.
- Una nota que queda vacía tras filtrar: no pasa, porque el filtro nunca deja vacío un texto no vacío.
- Una ficha con un valor que es solo un teléfono: queda `[telefono]`.
- Historial de una conversación sin mensajes: `messages: []`. De otra organización: 404.
- Omit con ids de salientes, de otra conversación o inexistentes: no cuentan. Con todos inválidos: `200 { omitted: 0 }`.
- Omit de un entrante con `text` nulo (una foto sin pie): `text` sigue nulo, suma `salud` y borra el `caption`.
- Dos peticiones simultáneas con la misma llave: el índice único deja pasar una; la otra recibe `409 mensaje_en_curso` o `200 repetido`.
- Una llave reusada con otro texto: es el mismo mensaje para Vocero y devuelve `repetido`. El contrato dice «el mismo mensaje»; no se compara el texto.
- Agente apagado, entrante de salud, y el cerebro manda dos mensajes de seguridad: el segundo da 409.
- Agente apagado con una persona atendiendo: nada se despacha y `messages` da `ai_paused`.
- Un traspaso de una conversación del Laboratorio: sin aviso.
- Varios traspasos de la misma conversación (vuelve al bot y se traspasa otra vez): un aviso por cada `handoff_at`.
- Telegram responde 429: es pasajero y se reintenta en la siguiente tanda (estimación: no se respeta `retry_after` más allá de eso).
- `AVISOS` encendido sin `TELEGRAM_BOT_TOKEN`: el log del arranque lo dice y las filas quedan `omitido`.

## Sabotajes (14)

- **3.6:** una nota interna que se guarda sin filtrar; un valor de ficha que se guarda sin filtrar.
- **3.7 (opcional):** `salud` que cae en `modelo` (el 14 de la 067).
- **History:** devuelve una nota interna o un mensaje de otra organización (15).
- **Omit:** toca un saliente o un mensaje de otra organización (20); deja la copia en `webhook_event` (21).
- **`clientMessageId`:** reservado después de llamar a Meta (17); un repetido que vuelve a enviar (18); la llave compartida entre organizaciones (19).
- **3.8:** despachar con el Agente apagado sin la marca `salud` (9); aceptar un segundo mensaje de seguridad para el mismo entrante (10).
- **3.10:** el aviso lleva el nombre o el teléfono del contacto; el seguimiento sin el freno de 30 minutos; el log del fallo con el token.

## Verificación

- **Por paso, en el PC:** las pruebas unitarias de su módulo; un commit por paso.
- **Al cerrar:** prettier y eslint de los archivos tocados, `tsc --noEmit` y `pnpm db:generate` sin diferencias. Después el CI en verde (con `AVISOS=on` en `completo`) y `e2e.yml` con la etiqueta.
- **En `e2e.yml`:** `e2e-despacho` (144) y `e2e-consentimiento` (32) siguen en verde, y el nuevo `e2e-contrato-aliantis.mjs` cubre:
  - salud con el Agente apagado: despacho con `agentEnabled: false`; un mensaje sin `motivo` da 409; con `motivo` pasa; un segundo da 409;
  - un texto normal con el Agente apagado no se despacha;
  - historial ordenado, sin notas;
  - omit: la bandeja muestra el texto omitido y `webhook_event` queda sin esas filas;
  - un `clientMessageId` repetido no llega dos veces al outbox del wa-mock;
  - un traspaso por `salud` con su rótulo;
  - una nota con salud guardada omitida;
  - el aviso de Telegram en el mock, sin nombre ni teléfono, y un seguimiento único.
- El freno de 30 minutos se prueba en unitarias con reloj inyectado; en el E2E solo se prueba que un segundo seguimiento inmediato no sale.

## Lo que esta spec no hace

- La retención (3.9): bloque E, solo.
- La lista blanca de llaves de la ficha y mostrar el consentimiento: fases 5 y 10.
- No re-filtra lo ya guardado.
- No cambia el cerebro.
