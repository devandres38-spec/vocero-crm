# 077 — Botones nativos en Instagram y Messenger (bloque I2, paso 4.7)

**Estado:** propuesta, en espera del visto bueno de Andres.
**Repos:** `vocero-crm` (esta spec), `aliantis-brain` (`specs/013-botones-meta/`) y `aliantis-core` (`decisiones.md` y `estado.md`).
**Contrato:** sí cambia `POST /api/bot/messages` (`buttons` deja de ser solo de WhatsApp). Sin migración, sin RLS nueva.

## Por qué

El negocio usa WhatsApp, Instagram y Messenger desde el inicio. Hoy, en Instagram y Messenger, nadie puede aceptar el aviso de privacidad, y el paciente se queda sin bot.

## Lo que hay hoy (revisado en el código, 11-nov-2026)

**Vocero**
- `src/app/api/bot/messages/route.ts`: si llegan `buttons` y el canal no es WhatsApp, responde `409 canal_sin_botones` y no envía nada. Pasa lo mismo en el Laboratorio.
- `src/server/inbox/send.ts` (`sendText`): lanza `canal_sin_botones` si hay botones y el canal no es WhatsApp. Instagram (`callInstagramSend`) y Messenger (`callMessengerSend`) solo reciben el texto.
- `src/server/instagram/send.ts`: el transporte de Meta envía a `graph.instagram.com/{versión}/{igUserId}/messages` con `{ recipient, message: { text } }`. Hay también un transporte de Zernio.
- `src/server/messenger/send.ts`: `buildMessengerSendBody` envía por `graphRequest` (`graph.facebook.com`, el mismo `META_GRAPH_BASE_URL` del mock) con `messaging_type`. También tiene un transporte de Zernio.
- `src/server/privacy/webhook.ts`: el filtro ya lee `message.quick_reply.payload` en `entry[].messaging[]`. Sin perfil legible, conserva el texto de un botón.
- **La ingesta no guarda el botón:**
  - `src/server/instagram/ingest.ts` (`processMetaInstagramPayload`) y `src/server/messenger/ingest.ts` (`normalizeMetaPagePayload`) no pasan `botonId` a `ingestInboundMessage`;
  - en WhatsApp sí se pasa;
  - la columna `message.button_id` ya existe.
- `persistOutbound` ya guarda los botones del saliente. La bandeja (`message-thread.tsx`) los dibuja sin mirar el canal.
- **El E2E:**
  - Messenger (fuente Meta) ya usa el mock de Graph (`wa-mock/graph`, que guarda en el *outbox*);
  - Instagram solo se prueba por Zernio: `IG_GRAPH_BASE_URL` existe, pero ningún E2E lo apunta a un mock.

**Cerebro** (`aliantis-brain`)
- `rules.ts` siempre manda el aviso con `CONSENT_BUTTONS` (`consentimiento:acepto` / `consentimiento:no_acepto`).
- `findConsentAnswer` acepta:
  - el botón;
  - lo escrito exacto `acepto`, `si acepto`, `si lo acepto` y `yo acepto`.

  **No hay rechazo escrito.**
- `turn/acciones.ts` (`traducirError`) trata el `409 canal_sin_botones` como un error de petición: el mensaje falla y **el cerebro deriva a una persona en el primer aviso**. El relevo decía «tras 3 avisos»: lo corrijo allá.

## Los límites de Meta (documentación oficial, leída el 11-nov-2026)

| | Messenger | Instagram |
| --- | --- | --- |
| Botones por mensaje | hasta 13 | hasta 13 |
| Título | 20 caracteres («long quick replies are truncated») | 20 caracteres, luego los corta |
| `payload` | 1000 caracteres | **no lo dice** |
| Tipos | `text`, `user_phone_number` y `user_email` | solo `text` |
| Al tocarlo, el webhook trae | `message.quick_reply.payload`, y `message.text` = el título | lo mismo |
| Notas | desaparecen con el siguiente mensaje | **no se ven en escritorio**; desaparecen al tocarlos |

Fuentes:
- `developers.facebook.com/docs/messenger-platform/send-messages/quick-replies`
- `…/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies`
- `…/messenger-platform/instagram/features/quick-replies`

**Lo que Meta no aclara** (lo trato como estimación):
- **Host y `messaging_type` de Instagram:** las dos páginas de Instagram se contradicen. La de «Instagram Login» usa `graph.instagram.com` sin `messaging_type`; la de Messenger Platform usa `graph.facebook.com` con `RESPONSE`. Vocero usa la de «Instagram Login», que es como conecta hoy (`graph.instagram.com`), y así se queda.
- No se documentan el largo del texto que lleva los botones ni si conviven con la etiqueta `HUMAN_AGENT`.

## Qué se hace

1. **El contrato** (`mensaje-del-bot.ts`, `docs/openapi.json`):
   - `buttons` vale en WhatsApp, Instagram y Messenger;
   - los límites siguen siendo los mismos en los tres: de 1 a 3 botones, `id` de 1 a 256, `title` de 1 a 20, ids y títulos únicos, y con botones el texto hasta 1024 caracteres;
   - también aplica el límite del canal: 1000 bytes en Instagram y 2000 en Messenger;
   - `409 canal_sin_botones` queda para TikTok y para Instagram o Messenger conectados **por Zernio** (su API no documenta botones).
2. **Capacidad por canal:** `capabilities.ts` gana `botones: boolean`. La ruta y `sendText` la consultan en vez de comparar con `"whatsapp"`, junto con la fuente de la conexión (`meta` sí, `zernio` no).
3. **El envío:**
   - **Instagram:** `sendViaMeta` añade `message.quick_replies: [{ content_type: "text", title, payload: id }]`;
   - **Messenger:** `buildMessengerSendBody` hace lo mismo;
   - el saliente guarda sus botones, como en WhatsApp. El Laboratorio guarda los botones en Instagram y Messenger igual que en WhatsApp.
4. **La ingesta:**
   - Instagram y Messenger (fuente Meta) pasan `message.quick_reply.payload` como `botonId`;
   - el texto que se guarda es el título, que ya pasó por el filtro con el id del botón (sin perfil se conserva, como en WhatsApp);
   - un `payload` de más de 256 caracteres no se guarda como botón: el mensaje entra como texto normal.
5. **El cerebro** (spec `013`):
   - el rechazo escrito exacto (pregunta 2);
   - ante un `409 canal_sin_botones`, reenvía el aviso sin botones en vez de derivar (pregunta 4).
6. **El mock y el E2E:**
   - el mock de Instagram (pregunta 3);
   - `e2e-consentimiento` gana una sección por Instagram y otra por Messenger.

## Casos borde

- **Instagram en escritorio no muestra los botones.** El paciente puede escribir «acepto» o «no acepto» (pregunta 2). El aviso no cambia de texto.
- **Sin perfil de privacidad legible,** lo escrito se guarda como `[mensaje omitido: no se pudo revisar]`, así que solo vale el toque del botón. Pasa igual en WhatsApp: no cambia.
- **Un toque en un botón viejo:** Meta los quita con el siguiente mensaje. Si llega uno, el cerebro lo trata como en WhatsApp (vale la última respuesta de la ráfaga).
- **Un `payload` que no es nuestro,** por ejemplo de un botón que la página mandó desde la app de Meta: se guarda como `button_id`, y el cerebro solo reconoce sus dos ids. Lo demás es texto normal.
- **Ecos (`is_echo`):** se siguen ignorando, igual que hoy.
- **El texto con botones mide más de lo que admite el canal** (1000 bytes en Instagram): da `422 invalid_body`, igual que hoy sin botones. El aviso actual mide unos 250 caracteres.
- **La etiqueta `HUMAN_AGENT`:** el cerebro siempre responde dentro de la ventana, así que el aviso no la lleva. Si una persona mandara botones fuera de la ventana… no puede: la bandeja no manda botones.
- **TikTok y Zernio:** siguen con el `409`. Con la pregunta 4, el cerebro reenvía el aviso sin botones y vale lo escrito.

## Lo que no cambia

- WhatsApp: ni el cuerpo `interactive`, ni los límites, ni la ingesta.
- Sin migración: `message.button_id` y los botones del saliente ya existen.
- La bandeja no gana botones para el personal.

## Sabotajes previstos

1. **Instagram sin botones:** quitar `quick_replies` del cuerpo de Instagram → falla la prueba unitaria del cuerpo y el E2E (el aviso sale sin botones).
2. **La ingesta no guarda el botón:** no pasar `botonId` en Messenger → falla la unitaria, y en el E2E «No acepto» sin perfil queda «no se pudo revisar» y no borra.
3. **Botones por Zernio:** dejar pasar `buttons` por Zernio → falla la prueba de la ruta (debe seguir el `409`).
4. **(cerebro) Coma ignorada:** que «no, acepto» cuente como rechazo → falla `rules.test.ts`.
5. **(cerebro) Se deriva como antes:** ante `canal_sin_botones` → falla la prueba de `acciones`.

## Preguntas para Andres (con mi recomendación)

1. **Límites.** Recomiendo dejar el contrato igual en los tres canales (de 1 a 3 botones, títulos de 20 e ids de 256) aunque Meta admita 13 en Instagram y Messenger. Así hay un solo contrato, el aviso usa 2 y el `payload` de Instagram no está documentado. Si un día se necesitan más, se sube solo para esos canales.
2. **Qué texto escrito cuenta.** Recomiendo:
   - **Aceptar:** igual que hoy (`acepto`, `si acepto`, `si lo acepto` y `yo acepto`).
   - **Rechazar, nuevo:** solo `no acepto`, `no lo acepto` y `yo no acepto`, exactos y normalizados (minúsculas, sin tildes, sin signos al final).
   - **Se vuelve a preguntar** (cuenta como un aviso más, hasta 3): si hay un signo entre «no» y «acepto» («no, acepto» o «no. acepto»), o si el texto es solo «no» o «sí».

   Rechazar borra la conversación, por eso solo vale lo exacto. Vale en los tres canales, también en WhatsApp.
3. **El mock de Instagram en el E2E.** Recomiendo reutilizar el mock de Graph existente (`/api/dev/wa-mock/graph`) apuntando `IG_GRAPH_BASE_URL` a él en `e2e.yml`. Ya quita la versión, guarda en el *outbox* y está detrás del `dev-guard` (404 en producción). Le añadiría lo mismo que hace Meta con `quick_replies`: rechazar más de 13, títulos de más de 20 y un `content_type` distinto de `text` en Instagram, para que un error nuestro no pase en verde. La otra opción es un mock propio de Instagram: más código, sin ganar nada.
4. **Canales sin botones (TikTok y Zernio).** Recomiendo que el cerebro, ante `409 canal_sin_botones`, reenvíe el mismo aviso sin botones (con la misma `clientMessageId` más un sufijo) y deje valer lo escrito, en vez de derivar al primer aviso. Hoy no se usan, pero así ningún canal deja al paciente sin aviso.
