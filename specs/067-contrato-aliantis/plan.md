# 067 — Plan

Spec: [spec.md](spec.md). Contratos: [contracts/bot-api-v2.md](contracts/bot-api-v2.md) y [contracts/despacho-v2.md](contracts/despacho-v2.md). Modelo: [data-model.md](data-model.md).

## Constitution Check (antes del diseño)

| Principio | Cumple | Cómo |
| --- | --- | --- |
| I. Seguridad | Sí | Credencial derivada comparada en tiempo constante; ninguna llave sale en respuestas ni logs; `forget` exige un rechazo registrado |
| II. Soberanía | Sí | Sin terceros nuevos. Los botones salen por Graph, por `src/lib/meta/client.ts` |
| III. Multi-tenancy | **Lo refuerza** | Se elimina `resolveInstanceOrg`; cada petición del cerebro trae su organización y se verifica. `consent` lleva `organization_id` y se consulta con `scoped()` |
| IV. Idempotencia | Sí | `forget` repetido no hace nada; `consent` solo agrega; las llaves del despacho no cambian `dispatchId` |
| V y IX. Verificación | Sí | Pruebas unitarias, gemelos byte a byte, guiones E2E con cerebro falso y sabotajes (abajo) |
| VI. Specs antes de código | Sí | Ciclo completo: toca modelo de datos y contratos publicados |
| VII. Trazabilidad | Sí | Divergencias abajo; decisiones en `aliantis-core/docs/trabajo/decisiones.md` |
| VIII. Foco vertical | Sí | Todo es del canal de WhatsApp y del cerebro |

## Divergencias (gana Aliantis Core, documentadas)

1. **«Una instancia = un negocio»** (`AGENTS.md`) deja de valer: una instalación atiende a varios negocios (pilar 1 de Aliantis). Con una sola organización todo sigue igual (D3 de la spec).
2. **`POST /api/bot/reset` se restringe** al Laboratorio. Es contrato público, pero su documentación ya decía «reiniciar una conversación de pruebas»; un cerebro que lo usaba en conversaciones reales le quitaba la conversación a una persona.
3. **`POST /api/bot/messages` con el Agente apagado se restringe.** Antes, el interruptor solo frenaba el despacho y un cerebro podía escribir igual (por ejemplo, el seguimiento de Nea). Ahora solo pasa la frase de seguridad.
4. **El CRM borra mensajes a pedido del cerebro** (`forget`), no solo por acción del dueño (026). Lo exige la promesa de «No acepto» (Ley 1581) y queda acotado a un rechazo registrado.

Ninguna rompe a un cerebro que siga el contrato publicado con una sola organización, salvo los usos de 2 y 3 que contradicen los pilares.

## Fase 0 — Lo investigado en el código

- **Organización:** las 12 rutas de `src/app/api/bot/*` llaman `resolveInstanceOrg()` (`src/server/bot/auth.ts:93`): `select id from organization limit 1`, en caché del proceso.
- **Presupuesto y «quién responde»:** `checkRateLimit("bot-api", BOT_API_BUDGET)` y `markBotSeen()` son globales (`src/server/bot/auth.ts`, `src/server/bot/status.ts`).
- **Credencial derivada:** Nea (`app/multiorg.py`, `credencial_derivada`) y Vocero Cloud (`src/server/brains/deployment.ts`) usan `HMAC-SHA256(secreto, "vocero:cerebro:v1:{org_id}")` en base64url sin relleno, fijado en pruebas a ambos lados.
- **Botones:** `contenidoEntrante` (`src/server/inbox/ingest.ts:66`) guarda el rótulo y pierde el id. `sendStructured` (`src/server/inbox/send.ts:675`) ya manda payloads estructurados de WhatsApp (ubicación, contactos) y es el lugar natural para los interactivos.
- **Envío del bot:** `/api/bot/messages` solo valida `conversationId` y `text`; el gate de `ai_paused` relee la conversación; `is_test` va a `guardarRespuestaDePrueba` (`src/server/lab/sandbox.ts`).
- **Despacho:** `despacharAlCerebro` (`src/server/dispatch/encolar.ts`) sale si el Agente está apagado. `armarEvento` (`src/server/brains/contract.ts`) agrega llaves opcionales solo si aplican (`test`, `fileName`).
- **Motivos:** `HANDOFF_REASONS` en `src/server/bot/handoff.ts` (5 valores, fallback `modelo`); rótulos en `HANDOFF_LABEL` (`src/lib/analytics.ts`) y en `src/lib/eventos-hilo.ts`. Sin restricción en la base.
- **Borrado:** `eliminarConversacion` (`src/server/inbox/eliminar.ts`) ya sabe borrar adjuntos y archivos dentro de una transacción; `forget` reutiliza esas piezas, sin borrar contacto, lead ni conversación.
- **`webhook_event`:** guarda el `payload` completo (`src/server/webhooks/eventos.ts`), sin columna de `wa_message_id`. `forget` busca las filas de la organización cuyo payload contiene esos ids (la tabla vive 7 a 30 días; el costo es bajo).
- **`aliantis-core`:** límites de botones en `src/whatsapp/sender.ts` (3 botones, título 20, id 256, cuerpo 1024); `consents` en `src/db/schema.ts`; «No acepto» borra con `deleteByConversation` y cierra (`process-turn.ts`); marcas en `privacyFlagsOf` (`src/privacy/privacy-filter.ts`).

## Fase 1 — Diseño

### Autenticación por organización

- `src/server/bot/auth.ts`: `requireBotKey(req)` pasa a `requireBot(req): Promise<{ organizationId } | Response>`. Resuelve con la cabecera y la credencial derivada, o con la regla de una sola organización (contando organizaciones, sin caché que esconda la segunda). Una sola función para las 12 rutas: una prueba escanea `src/app/api/bot/` y falla si alguna ruta usa otra cosa.
- `credencialDerivada(secreto, orgId)` pura, en `src/server/brains/credencial.ts`, con su prueba gemela fijada con el mismo vector que Nea (`org_abc123`).
- Presupuesto con llave `bot-api:{org}`; `markBotSeen(orgId)`.

### Botones y consentimiento

- `bodySchema` de `messages` suma `buttons` y `motivo`. Con `buttons`, `sendStructured` gana `kind: "buttons"` (payload `interactive` de tipo `button`). Solo WhatsApp: el resto, `409 canal_sin_botones` antes de llamar a nada.
- La ingesta guarda `button_id` (de `button.payload` o `interactive.*_reply.id`).
- `src/server/consent.ts`: `registrarConsentimiento` y `ultimoConsentimiento`. Ruta `src/app/api/bot/consent/route.ts`. El contexto suma `consent`.

### Segunda red de salud (P2, agregado el 10-nov-2026)

- `src/app/api/bot/omit/route.ts` y `src/server/inbox/omitir.ts`: en una transacción, actualiza `message.text`, `privacy_flags` y el `caption` del adjunto solo para entrantes de la conversación y la organización, y borra los `webhook_event` que los traían (la misma búsqueda que `forget`). Publica `message.updated`.
- La frase sale del mismo módulo de privacidad que usa la ingesta (fase 3.1), para que sea idéntica byte a byte.

### Envío idempotente (T2, agregado el 9-nov-2026)

- `bodySchema` de `messages` suma `clientMessageId`. Con llave, el envío inserta primero la fila del mensaje en `pending` con `client_message_id` (índice único parcial por organización) y solo después llama a Meta. Si la inserción choca: con la fila en `sent`, `delivered` o `read`, `200` con su `messageId` y `repetido: true`; en `failed`, la reutiliza y reintenta; en `pending`, `409 mensaje_en_curso`.
- Hoy `sendText` (`src/server/inbox/send.ts`) persiste el mensaje después de llamar a Meta: con llave, el orden se invierte en ese camino. Sin llave, no cambia.
- El Laboratorio (`guardarRespuestaDePrueba`) aplica la misma reserva.

### Forget

- `src/server/inbox/olvidar.ts`: en una transacción, verifica el último `aviso_privacidad` de la conversación (`granted = false`), borra los mensajes, los `media_asset` y los `webhook_event` que los traían; fuera de la transacción, los archivos (como 026). Publica `conversation.updated`.

### Salud con el Agente apagado

- `despacharAlCerebro`: con el Agente apagado, encola solo si el entrante tiene `salud` en `privacy_flags`, y el evento lleva `agentEnabled: false` (`armarEvento` suma la llave opcional).
- `/api/bot/messages`: con el Agente apagado y conversación real, exige `motivo: "seguridad"` y un entrante con `salud` posterior al último saliente con `ai_generated = true`.
- Hasta la fase 3.2 nadie llena `privacy_flags`: el comportamiento con el Agente apagado es el de hoy. Las pruebas siembran las marcas a mano.

### Historial, marcas y motivos

- `src/app/api/bot/history/route.ts` sobre `message` con `scoped()`, `limit` acotado, orden de llegada.
- `armarEvento` suma `privacyFlags` y `buttonId` por mensaje, solo si existen.
- `HANDOFF_REASONS`, `HANDOFF_LABEL` y los rótulos del hilo suman los seis motivos.

### Reset

- `src/app/api/bot/reset/route.ts`: lee `is_test`; si es `false`, `409 solo_laboratorio` antes de tocar nada.

### Documentación

- `docs/openapi.json` (y su copia servida), `AGENTS.md` (tabla de `/api/bot/*`, invariantes, «una instancia = un negocio»), enmienda en `specs/021-despacho-estandar/contracts/despacho.md` apuntando a este contrato.

## Pruebas

- **Unitarias (Vitest, sin base):** credencial derivada (vector gemelo); resolución de organización (las seis filas de la tabla de `bot-api-v2.md`); esquema de `messages` con botones (límites y unicidad); regla de seguridad; `armarEvento` con y sin llaves nuevas (**el cuerpo gemelo actual no cambia**); catálogo de motivos y fallback; escaneo: ninguna ruta de `/api/bot/*` sin `requireBot`; escaneo: nada hace `update`/`delete` sobre `consent`.
- **Prueba de aislamiento (con base):** dos organizaciones; cada ruta de `/api/bot/*` con la credencial de una no lee ni escribe en la otra.
- **E2E con mocks y cerebro falso** (`tests/e2e/us-contrato-aliantis.md` + `scripts/e2e-contrato-aliantis.mjs`): aviso con botones, tocar «No acepto», consentimiento, `forget`, texto final; Agente apagado con y sin salud; `reset` real rechazado; dos organizaciones.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm build && pnpm test`, en las dos configuraciones del CI.

## Sabotajes (método de `aliantis-core/docs/trabajo/procedimiento.md`)

Cada uno debe hacer fallar al menos una prueba. Uno no detectado se investiga.

1. Volver a resolver la organización con la primera de la tabla.
2. Aceptar `BOT_API_KEY` sin cabecera con dos organizaciones.
3. Aceptar la credencial de A con la cabecera de B.
4. Cambiar un carácter de la cadena `vocero:cerebro:v1`.
5. Presupuesto global en vez de por organización.
6. `forget` sin exigir el rechazo.
7. `forget` que borra el consentimiento, el contacto o el lead.
8. `forget` que no borra los `webhook_event`.
9. Despachar con el Agente apagado sin la marca `salud`.
10. Aceptar un segundo mensaje de seguridad para el mismo entrante.
11. Mandar `privacyFlags` vacío en vez de omitir la llave (rompe el gemelo).
12. Perder el `button_id` en la ingesta.
13. `reset` permitido en una conversación real.
14. `salud` cayendo en `modelo`.
15. El historial devolviendo una nota interna o un mensaje de otra organización.
16. Botones aceptados en Instagram.
17. `clientMessageId` reservado después de llamar a Meta (un reintento simultáneo envía dos veces).
18. Un `clientMessageId` repetido que vuelve a enviar.
19. La llave compartida entre organizaciones.
20. `omit` que toca un mensaje saliente o de otra organización.
21. `omit` que deja la copia en `webhook_event`.

## Del lado del cerebro

`aliantis-brain` especifica su parte en su propia spec (fase 1.2–1.3 del plan maestro): verificación del despacho, credencial derivada con el mismo vector gemelo, cliente de estas rutas y el orden `consent` → `forget` → `messages`. Las fases 1 y 2 del cerebro trabajan contra un Vocero simulado que cumple estos contratos; la implementación real en Vocero llega en las fases 3 y 4.

## Constitution Check (después del diseño)

Sin cambios respecto al inicial. Las cuatro divergencias quedan escritas arriba y en `RELEVO_ARQUITECTURA.md`.
