# 070 — Adjuntos por negocio, consentimiento con botones y «No acepto» que borra (bloque C)

**Pasos 3.3 a 3.5** del plan maestro (`RELEVO_ARQUITECTURA.md` §9). Implementa la parte de la spec **067** que le toca a este bloque (historias 2 y 3, D6 y D7, FR-003 sin `motivo` ni `clientMessageId`, FR-004 a FR-006) y la decisión **D11** de Aliantis. La 067 manda en todo lo que esta spec no cambia; aquí solo va lo nuevo y lo que se precisa contra el código.

Aprobado por Andres el 10-nov-2026 con P1 a P4. Spec-Kit en dos archivos (`procedimiento.md`): plan, modelo de datos y contrato son secciones de este archivo.

## Decisiones

- **D1. Adjuntos por negocio (P1).** Columna `privacy_profile.adjuntos`, **fuera de la huella** (la huella es la del filtro; esto lo decide Vocero). La registra Andres con `pnpm privacidad:sembrar`: por defecto **apagada** si el perfil filtra salud (`sensitive_terms` no nulo) y **encendida** si no (`--sin-filtro-salud`); `--adjuntos si|no` la fuerza. **Sin perfil, apagada** (D3 de la 068: sin revisión no se guarda).
- **D2. Qué hace «apagada».** Vale para lo que **entra del paciente** por el webhook (`ingestInboundMessage`, el único camino que crea adjuntos de pacientes: Instagram, Messenger y TikTok entran solo con texto). Un archivo (imagen, video, audio, documento, sticker) **no se descarga**: la fila de `media_asset` se crea con `wa_media_id` NULL, `file_name` NULL, `fetch_status = 'failed'` y `fetch_error = 'adjuntos_apagados'`. El mensaje entra a la bandeja («contenido no disponible», como cualquier adjunto fallido), abre la ventana y se despacha con su `type` y `mediaId: null`; el cerebro contesta con su regla de medios, como hoy. El pie de foto (ya filtrado) se conserva. Ubicaciones y tarjetas de contacto **no son archivos**: se guardan filtradas (D4) con los adjuntos encendidos o apagados. No aplica a los ecos del teléfono del negocio ni a lo que envía el equipo desde la bandeja: eso lo escribió el negocio.
- **D3. Botones.** Límites de `aliantis-core/src/whatsapp/sender.ts` y de la 067 (`contracts/bot-api-v2.md` §2): **de 1 a 3** botones; `id` de **1 a 256** caracteres; `title` de **1 a 20**; ids **únicos** y títulos **únicos**; con botones, `text` de **1 a 1024**. Fuera de eso, `422 invalid_body`. Solo WhatsApp; los demás canales, `409 canal_sin_botones` **antes** de llamar a nada (y antes del Laboratorio). Se envían por `sendText` con un `buttons` opcional (payload `interactive` de tipo `button`), no por `sendStructured` como decía el plan de la 067: es texto con la misma ventana, el mismo guardado y la misma cita; `sendStructured` crea un `media_asset`, que un mensaje con botones no tiene. El mensaje se guarda con `type = 'text'` y sus botones en `message.buttons`.
- **D4. Ubicación y contactos pasan por el filtro** (hueco que dejó el bloque B). Lista blanca: lo que no está aquí **se descarta**.
  - **`location`:** `latitude` y `longitude` (números, se conservan tal cual); `name` y `address` pasan por `classifyAndMask` (o `withoutReview` sin perfil). Se descartan `url` y cualquier otra llave.
  - **`contacts[]`:** de cada tarjeta quedan `name.formatted_name` y `name.first_name` (por el filtro) y `phones[].phone` (por el filtro: un teléfono se enmascara como `[telefono]`). Se descartan `name.last_name`, `middle_name`, `prefix`, `suffix`, `phones[].wa_id` y `phones[].type`, `emails`, `addresses`, `org`, `urls`, `birthday` y cualquier otra llave.
  - **Si un campo trae salud:** ese campo queda como `[mensaje con información de salud omitido]` y sus marcas (`salud` más `urgencia`, `sintoma`, `condicion` o `medicamento`) se suman a las del mensaje. Los demás campos se quedan como los dejó el filtro. Sin perfil, cada campo de texto queda `[mensaje omitido: no se pudo revisar]` con `sin_revisar`; las coordenadas se conservan (no son texto).
  - **Nombre del archivo:** `document.filename` pasa por el filtro igual que el pie de foto (otro hueco del bloque B).
  - Se aplica en los dos lugares del bloque B: en `filtrarPayload` (antes de `webhook_event`, con las marcas en `_privacidad`) y en la segunda red de la ingesta (`textoFiltrado`, cuando las marcas vienen `null`). Una sola función, `filtrarAdjuntoEstructurado`, para los dos.
- **D5. Consentimiento.** `POST /api/bot/consent` según la 067 §3: solo agrega; vale también en el Laboratorio. `GET /api/bot/context` devuelve `consent` (el último por tipo **del contacto**, ordenado por `created_at` y después `id`, descendente), al final del objeto.
- **D6. `forget` (D7 de la 067)**, en `src/server/inbox/olvidar.ts`, en una transacción:
  1. la conversación debe ser de la organización (si no, `404 not_found`);
  2. el **último** consentimiento `aviso_privacidad` **de esa conversación** debe tener `granted = false` (si no hay o es `true`: `409 sin_rechazo` y nada se borra);
  3. borra **todos** sus mensajes, los `media_asset` que ya nadie usa (mismo criterio de `eliminar.ts`: no los de un anuncio ni los de otro mensaje) y, **después del commit**, sus archivos;
  4. borra las filas de `webhook_event` de la organización que traían alguno de sus `wa_message_id` (función compartida `borrarEventosDeWebhook`, que busca el id entre comillas dentro del payload);
  5. **vacía la ficha del contacto** (`vaciarFicha`, igual que al eliminar un hilo): lo que el agente aprendió sin consentimiento no se queda. Precisión sobre la 067, que no la nombraba.
  6. conserva el contacto, la conversación vacía, el lead, sus etapas, la atribución del anuncio y los consentimientos; deja `unread_count = 0`;
  7. responde `200 { "deleted": <mensajes borrados> }`; repetirlo da `deleted: 0`. Publica `conversation.updated` y no manda `conversation.deleted`.
- **D7. Reconciliación del olvido (P2; revoca la D12 de la 067).** La D12 suponía que el cerebro no guarda texto. Guarda menos de lo que se creía, porque suelta el texto de lo ya procesado (P4 del 2.4b), pero conserva lo que retiene mientras espera el consentimiento, lo no procesado, los turnos, los leídos y el estado. Un aviso perdido deja eso vivo. Por eso cada `conversation.deleted` pasa por **`olvido_pendiente`**:
  - la ruta de eliminar inserta la fila (el evento ya armado, con su `eventId` como id) con `leased_until = ahora + 30 s` **antes** de avisar, y avisa como hoy;
  - si el cerebro confirma (`avisado`), borra la fila; si no, `attempts = 1` y `not_before = ahora + 1 min`;
  - **el worker del despacho** (`tanda`, `src/server/dispatch/worker.ts`) reintenta, después de los despachos, hasta 5 filas vencidas por pasada, cada una tomada con `for update skip locked` y lease de 30 s. Espera según el número de intentos: 1 min, 5 min, 30 min y después cada hora;
  - a los **7 días** desde `created_at` sin confirmar, `status = 'agotado'` y un aviso en el log con solo ids;
  - con el despacho apagado no hay a quién avisar: no se inserta nada (`avisarOlvido` responde `no_aplica`). Una fila que queda de antes se reintenta igual;
  - el mismo `eventId` en cada intento: el cerebro deduplica y su olvido es idempotente.
  - **Datos:** la fila guarda el evento firmado tal cual (`identity` incluida, porque el contrato gemelo la lleva). Es un teléfono o un BSUID, nunca texto, y vive como mucho 7 días más `agotado`; la retención del bloque E borra `agotado`.
- **D8. El cerebro olvida tras «No acepto» (P3).** Ver «Cerebro».

## Modelo de datos — migración `0029_consentimiento_y_olvido.sql`

Generada con `pnpm db:generate` desde `src/lib/db/schema.ts`. A mano solo se agrega el `update` del final (D1). Aditiva: no toca filas existentes, salvo el valor de `adjuntos`.

**Tabla nueva `consent`** (como el modelo de datos de la 067):

| Columna | Tipo | Nota |
| --- | --- | --- |
| `id` | `text` PK | prefijo `cns_` (`consent: "cns"` en `src/lib/db/ids.ts`) |
| `organization_id` | `text` NOT NULL | FK `organization`, `on delete cascade` |
| `contact_id` | `text` NOT NULL | FK `contact`, `on delete cascade` |
| `conversation_id` | `text` NULL | FK `conversation`, `on delete set null` |
| `kind` | `text` NOT NULL | `check (kind in ('aviso_privacidad','marketing'))` |
| `granted` | `boolean` NOT NULL | |
| `notice_version` | `text` NOT NULL | `check (char_length(notice_version) between 1 and 100)` |
| `source_message_id` | `text` NULL | sin FK: `forget` borra el mensaje y el registro queda |
| `created_at` | `timestamp` NOT NULL default `now()` | |

Índices: `consent_org_contact_kind_idx (organization_id, contact_id, kind, created_at)` y `consent_org_conv_kind_idx (organization_id, conversation_id, kind, created_at)`.

**`message`:** `button_id text NULL` (entrante: el id del botón tocado) y `buttons jsonb NULL` (saliente: `[{ id, title }]`). Sin índices. `client_message_id` **no** va aquí: bloque D, `0030` (P4).

**`privacy_profile`:** `adjuntos boolean NOT NULL default false`, y en la misma migración `update privacy_profile set adjuntos = true where sensitive_terms is null`.

**Tabla nueva `olvido_pendiente`:**

| Columna | Tipo | Nota |
| --- | --- | --- |
| `id` | `text` PK | el `eventId` del evento (`olv_…`) |
| `organization_id` | `text` NOT NULL | FK `organization`, `on delete cascade` |
| `conversation_id` | `text` NOT NULL | sin FK: la conversación ya no existe |
| `evento` | `jsonb` NOT NULL | el `EventoOlvido` tal como se firma |
| `status` | `text` NOT NULL default `'pendiente'` | `check (status in ('pendiente','agotado'))` |
| `attempts` | `integer` NOT NULL default 0 | |
| `not_before` | `timestamp` NOT NULL default `now()` | |
| `leased_until` | `timestamp` NULL | |
| `created_at` | `timestamp` NOT NULL default `now()` | |
| `updated_at` | `timestamp` NOT NULL default `now()` | |

Índice parcial: `olvido_pendiente_vivo_idx (not_before) where status = 'pendiente'`.

La prueba de la migración sobre datos la corre `e2e.yml` (las migraciones de `main`, filas, la `0029`, otra pasada).

## Contrato

Lo de la 067 §2 (`buttons`), §3 (`consent`), §4 (`forget`) y §6 (`consent` en el contexto), con estas precisiones:

| Ruta | Éxito | Errores |
| --- | --- | --- |
| `POST /api/bot/messages` con `buttons` | `200 { messageId }` (Laboratorio: `{ messageId, status: "sent" }`, sin enviar) | `422 invalid_body` (límites de D3) · `409 canal_sin_botones` · los de hoy (`ai_paused`, `window_closed`, `sandbox_violation`, `message_limit`, `502`) |
| `POST /api/bot/consent` | `201 { id, createdAt }` | `401` · `409 no_org` · `422 invalid_body` · `404 not_found` |
| `POST /api/bot/forget` | `200 { deleted }` | `401` · `409 no_org` · `422 invalid_body` (`reason` distinto de `no_acepta`) · `404 not_found` · `409 sin_rechazo` |
| `GET /api/bot/context` | `consent: { avisoPrivacidad, marketing }`, cada uno `{ granted, noticeVersion, at }` o `null` | sin cambios |

- `consent`: `kind` ∈ {`aviso_privacidad`, `marketing`}; `granted` booleano; `noticeVersion` de 1 a 100; `sourceMessageId` opcional, de 1 a 64.
- La organización se resuelve igual que en las demás rutas (`requireBotKey` + `resolveInstanceOrg`). La credencial por negocio es el bloque F (4.1).
- **Despacho:** `messages[].buttonId`, solo si existe, **después** de `privacyFlags` (el cuerpo gemelo no cambia). `contacts[].name` y `location.name/address` viajan ya filtrados.
- **Bandeja:** `serializeMessage` suma `buttons` (solo si hay) y el hilo los dibuja bajo el texto, como chips sin acción.
- `docs/openapi.json`, `AGENTS.md` y la enmienda de `specs/021-despacho-estandar/contracts/despacho.md` se ponen al día.

## Archivos

**Vocero**
- `src/lib/db/schema.ts`, `src/lib/db/ids.ts`, `drizzle/0029_*.sql` y su `meta/`.
- `src/server/privacy/adjuntos.ts` (nuevo): `filtrarAdjuntoEstructurado(kind, payload, politica) → { payload, marcas }`.
- `src/server/privacy/webhook.ts`: ubicación, contactos y `document.filename` en `filtrarMensajeWhatsapp`.
- `src/server/privacy/repositorio.ts`: `perfilVigente` también devuelve `adjuntos`.
- `src/server/inbox/ingest.ts`: `textoFiltrado` filtra el payload; `attachMediaAsset` respeta `adjuntos`; `button_id` al insertar.
- `src/server/inbox/send.ts`: `sendText` con `buttons`; `persistOutbound` guarda `buttons`; `serializeMessage` los expone.
- `src/server/lab/sandbox.ts`: `guardarRespuestaDePrueba` con `buttons`.
- `src/app/api/bot/messages/route.ts`: esquema y `canal_sin_botones`.
- `src/server/consent.ts` (nuevo) y `src/app/api/bot/consent/route.ts` (nuevo).
- `src/server/inbox/olvidar.ts` (nuevo) y `src/app/api/bot/forget/route.ts` (nuevo).
- `src/server/webhooks/borrar.ts` (nuevo): `borrarEventosDeWebhook(tx, org, waIds)`.
- `src/app/api/bot/context/route.ts`: `consent`.
- `src/server/brains/contract.ts`: `buttonId`.
- `src/server/brains/deliver.ts`: `buttonId` en la consulta de la ráfaga.
- `src/server/dispatch/olvidos.ts` (nuevo): insertar, avisar y reintentar.
- `src/server/dispatch/worker.ts`: `reintentarOlvidos` al final de `tanda`.
- `src/app/api/conversations/[id]/route.ts`: usa `olvidos.ts`.
- `src/lib/types.ts` y `src/components/inbox/message-thread.tsx`: botones en el hilo.
- `scripts/privacidad-sembrar.ts`: `adjuntos` y `--adjuntos si|no`.
- `scripts/e2e-consentimiento.mjs` (nuevo), `tests/e2e/us-consentimiento.md` (nuevo) y `.github/workflows/e2e.yml` (paso nuevo).
- Pruebas unitarias nuevas: `consentimiento.test.ts`, `olvidar.test.ts`, `olvidos.test.ts`, `privacidad-adjuntos.test.ts` y `botones.test.ts`. Ajustes: `despacho-contrato.test.ts` (la llave nueva) y las que comparen objetos enteros.

**Cerebro (`aliantis-brain`)**
- `src/dispatch/olvido.ts`: `olvidarConversacion(db, org, conv, { conservarPendientes })`.
- `src/conversation/process-turn.ts`: el cierre tras «No acepto».
- Su prueba.

## Cerebro: el punto exacto de cierre (P3)

El turno del «No acepto» guarda tres acciones en orden: `consentimiento` (rechazo) → `olvidar` (`POST /api/bot/forget`) → `mensaje` (el texto fijo). Cada una se anota `hecha` o `fallida` en `conversation_turns.acciones` al terminar (`ejecutarAcciones`).

- **El olvido del cerebro va después de `turns.finish`**, en `ejecutar()`, y solo si la acción `olvidar` quedó `hecha` y **ninguna** quedó `pendiente`. Así el texto fijo ya salió y quedó anotado. Si el olvido corriera antes, borraría el turno con el mensaje pendiente, y el texto se perdería o se mandaría dos veces.
- **El rastro es el propio turno:** mientras no se olvida, la fila del turno terminado con `olvidar: hecha` sigue ahí. Si el proceso cae entre `finish` y el olvido, la siguiente tarea de esa conversación lo ve en el paso 1 (`lastForConversation`, resultado distinto de `en_curso`, con `olvidar: hecha`) y olvida antes de cualquier otra cosa. El olvido borra esa fila: no se repite.
- **Con `conservarPendientes: true`** solo borra los despachos ya procesados (y sus leídos). Lo que el paciente escribió durante el turno sigue pendiente y abre una conversación nueva para el cerebro, que vuelve a pedir el aviso. Los turnos y el estado (`conversaciones`) se borran todos. `llm_calls` se conserva (sin texto, cuenta para el gasto), igual que en el olvido de hoy.
- Si `olvidar` quedó `fallida`, no hay olvido local: Vocero no borró.
- Un mensaje repetido si el proceso cae entre que Vocero envía el texto y el cerebro lo anota es el caso que resuelve `clientMessageId` (bloque D). Este bloque no lo empeora.

## Casos borde

- Botón con id y sin rótulo: se guarda el id como texto (como hoy) y en `button_id`.
- Botón de plantilla (`type: "button"`): `button_id` = `button.payload`.
- `consent` sobre una conversación de prueba: se permite. `forget` sobre una de prueba: también.
- `forget` sin ningún mensaje: `200 { deleted: 0 }`, si hay rechazo.
- Un rechazo y después una aceptación: el último gana, así que `forget` responde `409 sin_rechazo`.
- Un rechazo de **otra** conversación del mismo contacto no autoriza `forget` en esta.
- Un despacho pendiente de la conversación cuyos mensajes borró `forget`: `construirEvento` lo arma sin ellos o lo descarta («la conversación ya no existe»), como hoy.
- Un `webhook_event` que trae dos mensajes (de esta conversación y de otra): se borra entero. Sus mensajes ya se procesaron, y el otro queda en `message`. Meta casi nunca junta mensajes de dos personas en una entrega.
- Si Meta vuelve a entregar un evento cuya fila borró `forget` o eliminar, el mensaje vuelve a entrar. Pasa ya hoy con eliminar, y Meta solo reentrega lo que no recibió `200`.
- Con los adjuntos apagados, una descarga a demanda (`/api/media/[id]`) no puede bajar nada: `wa_media_id` es NULL.
- Un perfil sembrado de nuevo sin `--adjuntos` recalcula el valor por defecto.
- `olvido_pendiente` de una organización que se elimina: cae en cascada.

## Sabotajes (4)

1. `forget` borra sin un rechazo registrado (se quita la comprobación del paso 2).
2. `forget` borra de otra conversación u organización (se quita el filtro por conversación u organización).
3. `consent` se edita o se borra (un `update` sobre `consent`): lo atrapa el escaneo de solo agregar.
4. Con los adjuntos apagados, el archivo se descarga igual (se ignora `adjuntos` en `attachMediaAsset`).

## Verificación

- **En el PC:** `vitest run` de los archivos tocados, sabotajes, `prettier --check` y `eslint` de los archivos tocados, `tsc --noEmit` y `pnpm db:generate` (que no falte una migración).
- **En GitHub:** el CI de los dos repos y `e2e.yml` con la etiqueta. `e2e-despacho.mjs` debe seguir en 144/144. `e2e-consentimiento.mjs` cubre aviso → Acepto (consentimiento registrado, nada borrado), aviso → No acepto (rechazo, `forget`, solo queda el texto fijo y los `webhook_event` de esos mensajes ya no están), adjuntos apagados (imagen sin descargar, despacho con `mediaId: null`) y olvido con el cerebro caído (fila en `olvido_pendiente`, se recupera, el reintento llega y la fila se borra).
- Para no esperar 1 min en el E2E, el intervalo base del reintento sale de `OLVIDO_REINTENTO_MS` (por defecto 60000). El arnés lo baja a 1500.

## Lo que esta spec no hace

- `clientMessageId`, `GET /api/bot/history` ni `POST /api/bot/omit`: bloque D, migración `0030` (P4).
- `motivo: "seguridad"` y la salud con el Agente apagado: bloque D (paso 3.8).
- No muestra el consentimiento en la interfaz (fase 10). No re-filtra lo ya guardado (P2 del bloque B).
- No borra archivos ya descargados de negocios que pasen a `adjuntos = false`: el cambio vale desde ese momento.
