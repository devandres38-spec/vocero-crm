# 073 — Autenticación por negocio: llave derivada y App Secret por negocio (bloque F, pasos 4.1 y 4.2)

**Estado:** aprobada por Andres (10-nov-2026); programada con su «sigue» (11-nov-2026). Decisiones base: D13 (llave derivada por organización, cabecera y tope por negocio) y D14 (App Secret por negocio, cifrado; firma obligatoria en producción) de Aliantis; brechas N1 y N2 del relevo. El contrato de `/api/bot/*` ya está fijado en `specs/067-contrato-aliantis/contracts/bot-api-v2.md`, sección 1: esta spec lo implementa, no lo cambia.

## Lo verificado en el código (10-nov-2026)

**`/api/bot/*` (paso 4.1)**
- `src/server/bot/auth.ts`: `requireBotKey(req)` compara la `BOT_API_KEY` cruda (tiempo constante) y `resolveInstanceOrg()` devuelve la **primera organización de la tabla** (`limit 1`, sin orden, en caché del proceso). Lo llaman las 16 rutas de `src/app/api/bot/` (`openapi.json` es pública) (33 usos de `resolveInstanceOrg`).
- El presupuesto es **uno global** (`bot-api`, 1200/min) y «quién responde» (`markBotSeen`) es **una marca global**.
- **El cerebro ya habla el contrato nuevo:** `aliantis-brain/src/vocero/client.ts` manda `X-Vocero-Organization` y `credencialDerivada(secreto, org)` (modo `derivada` por defecto), con su vector gemelo (`org_abc123` → `_BqRKryMUdexcuLj_3RG1ARbgqr_LhXRSLJYmrw5VJ0`). **Contra el Vocero de hoy, cada llamada del cerebro real da 401:** Vocero solo acepta la llave cruda. Los E2E pasan porque su cerebro falso (`scripts/lib/cerebro-falso.mjs`) usa la llave cruda.
- El despacho Vocero → cerebro ya va firmado con `BOT_API_KEY` y lleva `organization.id`; no cambia.

**Webhooks de Meta (paso 4.2)**
- `isValidSignature` (`src/server/inbox/webhook.ts`) devuelve `true` si no hay secreto: la firma es **opcional y global** (`META_APP_SECRET`). La usan las rutas de WhatsApp, Instagram y Messenger.
- El segmento secreto de la URL (`META_WEBHOOK_VERIFY_TOKEN`) es **uno para toda la instalación**. Con una app de Meta por cliente, en el Business del cliente (pilar 1), **el cliente ve esa URL**. Sin firma por negocio, quien la conozca puede inyectar eventos a nombre de otro negocio: por eso la firma con el App Secret de cada negocio es la capa que de verdad aísla.
- `meta_credentials` no guarda App Secret. El cifrado AES-256-GCM ya existe (`encryptSecret`, `decryptSecret` en `src/lib/crypto`).
- `resolverOrganizacion(fuente, payload)` (`src/server/webhooks/organizacion.ts`) ya sabe a qué negocio va cada entrega (número, WABA, cuenta de IG o página), con los mismos buscadores que la ingesta.
- El mock de WhatsApp (`src/server/dev/wa-mock-inbound.ts`) firma con la `META_APP_SECRET` global.
- Zernio (conector opcional, apagado por defecto) ya verifica su propia firma con un secreto por cuenta, pero también es opcional.
- Embedded Signup usa una app global (`META_APP_ID`, `META_APP_SECRET`) y queda apagado sin esas variables: con una app por cliente y sin Tech Provider (pilar 1), no aplica.

## Respuestas de Andres (10-nov-2026)

1. **`META_APP_SECRET` global:** deja de proteger los webhooks; solo vale el secreto de cada negocio.
2. **Registro del App Secret:** solo Andres, con `pnpm meta:secreto`, leyéndolo sin eco por la entrada estándar.
3. **Segmento secreto de la URL:** se queda como está (uno por instalación).
4. **Llave cruda con un solo negocio:** se conserva por compatibilidad, **con aviso en el registro**; con dos o más, `409`.
5. **Zernio:** firma obligatoria en producción con la misma regla (aunque no se usará: sin TikTok).
6. **Formato del App Secret:** 32 caracteres hexadecimales; se confirma con una app real.
7. **Canales desde el inicio:** WhatsApp, Instagram y Facebook Messenger (sin TikTok ni Zernio). Los botones nativos de Instagram y Messenger son un bloque aparte, después de la fase 4 (relevo, «Bloque I2»).

## ¿Una app de Meta para los tres canales? (validación del diseño de `meta_app`)

- **Lo que dice Meta** (documentación revisada el 10-nov-2026):
  - todas las notificaciones se firman con HMAC-SHA256 en `X-Hub-Signature-256` usando «el App Secret de tu app» ([Webhooks, configuración](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup));
  - una app puede tener varios casos de uso «si son compatibles entre sí», y los incompatibles salen en gris al crearla ([Crear una app](https://developers.facebook.com/documentation/development/create-an-app.md)). La documentación no dice si WhatsApp, Messenger e Instagram caben juntos en una sola app;
  - la API de Instagram **con inicio de sesión de Instagram** muestra su propio **«Instagram app ID» e «Instagram app secret»**, y solo admite una configuración de Instagram por app ([Caso de uso de Instagram](https://developers.facebook.com/documentation/development/create-an-app/instagram-use-case.md)). No dice si sus webhooks se firman con ese secreto o con el de la app de Meta.
- **Lo que usa Vocero:** Instagram por `graph.instagram.com` (precisamente el inicio de sesión de Instagram, `src/server/instagram/send.ts`) y Messenger por `graph.facebook.com`, como WhatsApp.
- **Conclusión (estimación hasta probar con una app real):** no se puede suponer un solo secreto por negocio. Puede haber una app por canal, y aun en una sola app, Instagram puede firmar con su propio secreto.
- **Diseño:** el secreto se guarda **por negocio y por canal** (`whatsapp`, `instagram`, `messenger`). Si los tres canales comparten app, Andres registra el mismo secreto con `--canal todos`. La ruta de cada webhook verifica con el secreto de **su** canal. Sirve para las dos realidades sin otra migración.
- **Se confirma en la prueba con una app real** (alta del primer negocio): qué secreto firma los webhooks de Instagram y si los tres canales caben en una sola app. El resultado se anota en `decisiones.md`.

## Riesgo de cada paso

| Paso | Riesgo | Sabotajes |
| --- | --- | --- |
| T2 Migración `meta_app` y `pnpm meta:secreto` | Medio (secreto nuevo, migración aditiva) | 1 |
| T3 (4.1) `requireBot` y las 16 rutas | **Crítico** (autenticación por negocio) | 4 |
| T4 (4.2) Firma por negocio y obligatoria en producción | **Crítico** (autenticación por negocio) | 4 |
| T5 E2E con dos negocios | — | — |

## Decisiones

- **D1. `requireBot(req)`** reemplaza a `requireBotKey` y `resolveInstanceOrg`: devuelve `{ organizationId }` o la respuesta de error, con **exactamente** las seis filas de `bot-api-v2.md` §1:

  | Petición | Resultado |
  | --- | --- |
  | Cabecera de una organización que existe + su credencial | Esa organización |
  | Cabecera + credencial de otra, o la `BOT_API_KEY` cruda | `401` |
  | Cabecera de una organización que no existe | `401` (no revela si existe) |
  | Sin cabecera, `BOT_API_KEY`, **una** organización | Esa (compatibilidad) |
  | Sin cabecera, `BOT_API_KEY`, **dos o más** | `409 organizacion_requerida` |
  | Sin cabecera y sin llave válida | `401`, y freno por IP como hoy |

  La regla de compatibilidad **cuenta** las organizaciones en cada petición (sin caché: una segunda organización la apaga al instante). `credencialDerivada` pura en `src/server/brains/credencial.ts`, con el mismo vector gemelo del cerebro. Comparación en tiempo constante.
- **D2. Presupuesto y «quién responde» por negocio:** `bot-api:{org}` (1200/min por organización); los fallos siguen frenados por IP. `markBotSeen(org)` y `botLastSeenAt(org)` por organización.
- **D3. Las 16 rutas** de `src/app/api/bot/` pasan a `requireBot`; `resolveInstanceOrg` desaparece. Un guardarraíl escanea `src/` y falla si alguna ruta de `/api/bot/*` no llama `requireBot` o si alguien vuelve a escribir `resolveInstanceOrg`. `/api/bot/llm` acepta la credencial en `Authorization: Bearer` con la cabecera de organización (el SDK de OpenAI manda cabeceras fijas).
- **D4. Tabla `meta_app`**, una fila por **negocio y canal** (ver la validación de arriba): `organization_id` y `canal` (`whatsapp`, `instagram` o `messenger`) como llave primaria, `app_id` (opcional, informativo), `secret_cipher`, `secret_iv`, `secret_tag` y fechas. El secreto nunca sale en respuestas ni en registros; solo se muestran sus últimos 4.
- **D5. `pnpm meta:secreto -- --organizacion <id> --canal whatsapp|instagram|messenger|todos [--app <app_id>]`** lo registra Andres (`todos` guarda el mismo secreto en los tres canales): lee el secreto de la entrada estándar sin eco (nunca como argumento, para que no quede en el historial), valida que sean 32 caracteres hexadecimales (formato del App Secret de Meta: estimación, se confirma con una app real) y lo guarda cifrado. Imprime solo los últimos 4.
- **D6. Verificación en los webhooks de WhatsApp, Instagram y Messenger:** segmento secreto de la URL → cuerpo crudo → JSON → `resolverOrganizacion` → el secreto de **ese** negocio para **ese** canal → firma sobre el cuerpo crudo → recién ahí se guarda (`recibirEvento` recibe la organización ya resuelta). Una entrega que no se puede asignar a un negocio se descarta con 200, como hoy.
- **D7. Firma obligatoria en producción** (`NODE_ENV=production` y mocks apagados): sin secreto registrado para ese negocio → `401` y no se guarda; el registro dice el negocio, nunca el cuerpo. Fuera de producción, la firma se exige si el negocio tiene secreto (así el E2E prueba el camino real) y se omite si no. La `META_APP_SECRET` global deja de usarse para los webhooks (ver pregunta 1).
- **D7b. Zernio** (respuesta 5): la misma regla. En producción, una cuenta de Zernio sin secreto → `401`; su secreto por cuenta ya existe (spec 030).
- **D7c. Aviso de compatibilidad** (respuesta 4): cada petición autenticada con la llave cruda deja un aviso en el registro (una vez por minuto como mucho), sin la llave.
- **D8. Ajustes → Webhook** muestra, por negocio y canal, si la firma está activa (sí o no y los últimos 4), sin el secreto.
- **D9. El mock de WhatsApp** firma con el secreto del negocio del número (solo con mocks), para que el E2E recorra la verificación real.
- **D10. El cerebro no cambia de código:** ya manda la cabecera y la credencial derivada. El E2E pasa el cerebro falso y los arneses a la credencial derivada; una comprobación deja la llave cruda con una sola organización (compatibilidad).

## Modelo de datos — migración `0032_autenticacion_por_negocio.sql`

- Tabla `meta_app` (D4), llave primaria `(organization_id, canal)`, con FK a `organization` (`on delete cascade`). Solo agrega: ninguna fila existente cambia.
- Prefijo de id: no hace falta (la llave es `organization_id`).

## Archivos

- `src/server/brains/credencial.ts` (nuevo): `credencialDerivada`.
- `src/server/bot/auth.ts`: `requireBot`, presupuesto por negocio; se van `requireBotKey` y `resolveInstanceOrg`. `src/server/bot/organizaciones.ts` (nuevo): las dos consultas de organización, aparte para simularlas en las pruebas de cada ruta.
- `src/server/bot/status.ts`: «quién responde» por negocio.
- Las 16 rutas de `src/app/api/bot/`.
- `src/lib/db/schema.ts`, `drizzle/0032_…`.
- `src/server/whatsapp/app-secret.ts` (nuevo): guardar y leer el secreto de un negocio.
- `scripts/meta-secreto.ts` (nuevo) y `package.json` (`meta:secreto`).
- `src/server/webhooks/firma.ts` (nuevo): `verificarFirmaMeta(canal, payload, cuerpo, cabecera)`; `src/server/webhooks/obligatoria.ts` (nuevo): `firmaObligatoria()`, aparte para que Zernio lo use sin ciclo de importaciones; `src/server/webhooks/organizacion.ts`: `organizacionesDeLaEntrega` (todas las de una entrega). `isValidSignature` no cambia.
- `src/server/zernio/dispatch.ts`: la regla de producción (D7b).
- `src/app/api/webhooks/{wa,ig,messenger}/[webhookToken]/route.ts` y `src/server/webhooks/recibir.ts` (acepta la organización resuelta).
- `src/app/api/settings/webhook/route.ts` y su pantalla.
- `src/server/dev/wa-mock-inbound.ts`.
- `scripts/lib/credencial.mjs` (nuevo), `scripts/lib/cerebro-falso.mjs` y los `bot()` de los arneses de `e2e.yml`: credencial derivada.
- `scripts/e2e-multinegocio.mjs` (nuevo), `tests/e2e/us-multinegocio.md`, `.github/workflows/e2e.yml`.
- Pruebas: `tests/unit/bot-auth-negocio.test.ts`, `tests/unit/webhook-firma-negocio.test.ts`, el guardarraíl de rutas y las pruebas existentes que simulaban `resolveInstanceOrg` (4 archivos) o `bot/auth` (6).
- `docs/openapi.json` (seguridad), `AGENTS.md`, `.env.example` (la `META_APP_SECRET` ya no protege los webhooks).

## Casos borde

1. La credencial de A con la cabecera de B → 401, y A no recibe nada.
2. Cabecera con el slug en vez del id → 401 (el contrato exige el id).
3. Una segunda organización aparece mientras el cerebro usa la llave cruda → la siguiente petición da 409, sin reiniciar.
4. La organización se borra → su credencial deja de valer (401).
5. Un negocio en su presupuesto no frena a otro.
6. Webhook con la firma de otro negocio → 401, nada guardado.
7. Webhook con entradas de dos negocios en la misma entrega → se rechaza (una app es de un solo cliente; no se mezcla).
8. Webhook de un número que nadie conectó → 200, descartado sin guardar (como hoy).
9. Producción sin secreto registrado → 401 y aviso en el registro con el negocio; Meta reintenta y Andres lo ve en Ajustes → Webhook.
10. Cuerpo que no es JSON → 200 sin guardar, como hoy (la firma no se puede asignar a un negocio).
11. El secreto mal escrito al registrarlo (no son 32 hex) → rechazado, la base no cambia.
12. Un negocio con secreto de WhatsApp pero no de Instagram: en producción, sus webhooks de Instagram → `401`; los de WhatsApp siguen.
13. Un webhook de Messenger firmado con el secreto de WhatsApp de otra app del mismo negocio → `401` (cada canal, su secreto).

## Sabotajes (9)

1. `meta:secreto` guarda el secreto sin cifrar → falla su prueba.
2. `requireBot` acepta la llave cruda con cabecera → falla la fila 2.
3. `requireBot` ignora la cabecera y toma la primera organización → falla la prueba de dos negocios.
4. La regla de compatibilidad sin contar organizaciones (caché) → falla el caso borde 3.
5. Presupuesto global en vez de por negocio → falla el caso borde 5.
6. Firma opcional en producción → falla el caso borde 9.
7. Verificar con el secreto global, o con el de otro canal, en vez del del negocio y su canal → fallan los casos borde 6 y 13.
8. Guardar el evento antes de verificar la firma → falla «nada guardado».
9. Aceptar una entrega con dos negocios → falla el caso borde 7.

## Verificación

- **En el PC:** `vitest run` de lo tocado, los sabotajes 1 a 9, prettier y eslint de lo tocado, `tsc --noEmit` y `pnpm db:generate`.
- **En el CI:** Vocero completo en las dos configuraciones; el cerebro no cambia.
- **`e2e.yml`** (etiqueta `e2e`): los cuatro arneses de siempre, ya con la credencial derivada, la migración sobre datos (`0032`) y el nuevo `e2e-multinegocio.mjs`:
  - dos negocios con su credencial;
  - cruce de credenciales → 401;
  - llave cruda con dos negocios → 409;
  - un webhook firmado por cada negocio llega a su bandeja;
  - uno firmado con el secreto equivocado → 401 y nada en `webhook_event` ni en `message`.

## Lo que esta spec no hace

- No cambia el contrato (ya está en la 067) ni el cerebro.
- No toca Embedded Signup (app global, apagado sin variables).
- No hace el alta de negocios ni los topes (bloque G), ni RLS (bloque H).
- No cambia el segmento secreto de la URL (respuesta 3).
- No agrega los botones nativos de Instagram y Messenger: van en el bloque I2.
