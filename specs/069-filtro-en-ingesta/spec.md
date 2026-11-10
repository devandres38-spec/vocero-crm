# Feature Specification: Nada se guarda crudo — el filtro en la ingesta, las marcas y la huella en el despacho

**Feature Branch**: `069-filtro-en-ingesta`

**Created**: 2026-11-10

**Status**: Bloque B del plan maestro (paso 3.2), aprobado por Andres el 2026-11-10 con P1 y P2 respondidas y un ajuste a la red de seguridad (abajo).

**Input**: D1 de Aliantis (filtro en los dos lados), brecha 1 de la auditoría (`webhook_event` guarda el payload entero; `message.text` crudo; el Laboratorio también), P1 de la spec 068 (la huella del perfil viaja en el despacho).

**Carril**: ciclo completo. Toca el modelo de datos (migración `0028`: `message.privacy_flags`) y el contrato publicado del despacho (dos llaves aditivas).

## Contexto

La spec 068 trajo el filtro de Aliantis a Vocero (`src/server/privacy/`, gemelo del cerebro) y el perfil de privacidad de cada negocio, sin conectarlos. Hoy todo texto de un paciente se guarda tal cual en dos sitios: `webhook_event.payload` (el cuerpo entero de Meta o Zernio, guardado **antes** de procesarse para poder reintentar) y `message.text`. Este paso hace que **nada llegue crudo a la base**, y que el cerebro reciba las marcas y sepa con qué perfil se filtró.

## Decisiones

- **D1. Se filtra al guardar el evento.** `guardarEvento` filtra el payload antes del `INSERT` en `webhook_event`, con el perfil del negocio. Cada mensaje de paciente queda con su texto filtrado y con sus marcas anotadas en el mismo payload (`_privacidad`). La huella del evento (`webhook_event.huella`, deduplicación) se sigue calculando sobre el cuerpo crudo: es un SHA-256, no el texto.
- **D2. Qué es texto de un paciente**, por forma de payload:
  - WhatsApp: `changes[field=messages].value.messages[]`: `text.body`, `button.text`, `interactive.button_reply.title`, `interactive.list_reply.title` y `description`, y el `caption` de `image`, `video`, `document`, `audio` y `sticker`.
  - Meta (Instagram y Messenger): `entry[].messaging[].message.text`, salvo los ecos (`is_echo`).
  - Zernio (Instagram, Messenger, TikTok): `message.text`, salvo lo saliente (`direction: "outgoing"`).
- **D3. Red de seguridad (con el ajuste de Andres).** Después, un barrido filtra cualquier campo `body`, `text`, `caption`, `title` o `description` que quede sin tocar en el payload. **Nunca entra** en: `referral` (la tarjeta del anuncio), los ecos del teléfono del negocio (`field: smb_message_echoes` y `message_echoes`, y cualquier objeto con `is_echo: true` o `direction: "outgoing"`), `statuses`, `errors` y `metadata`, ni en los campos que el filtro por forma ya revisó (como el rótulo de un botón conservado sin perfil). Un campo nuevo que Meta agregue mañana sale filtrado, sin marcas, pero nunca crudo.
- **D4. Sin perfil, no hay revisión.** Sin perfil de privacidad legible, cada texto de paciente queda `[mensaje omitido: no se pudo revisar]` con la marca `sin_revisar`; el rótulo de un botón se conserva (es el título que definió el bot; perderlo sería perder un "No acepto"). Igual que en el cerebro.
- **D5. La ingesta guarda las marcas y es la segunda red.** `ingestInboundMessage` exige las marcas del mensaje (parámetro obligatorio, `null` si el mensaje no pasó por `guardarEvento`). Con `null` filtra ella misma con el perfil del negocio: cubre el camino sin evento guardado (organización no resuelta) y cualquier llamada futura. Las marcas van a `message.privacy_flags`.
- **D6. El Laboratorio también.** Lo que escribe el "paciente" de prueba (`lab/runner.ts`) se filtra con el perfil del negocio antes de guardarse, con sus marcas.
- **D7. El despacho lleva marcas y huella** (contrato `despacho-v2`, solo aditivo): `messages[].privacyFlags` si el mensaje tiene marcas; `organization.privacyProfileHash` si el negocio tiene un perfil legible. Solo si aplican y al final de su objeto: el cuerpo gemelo de `tests/unit/despacho-contrato.test.ts` no cambia.
- **D8. El cerebro avisa si la huella no cuadra** (P1 de la 068): compara con la huella de su configuración y deja un aviso en el log, sin contenido; no bloquea, porque vuelve a filtrar con la suya.
- **D9. Lo saliente no se filtra:** las respuestas del bot, lo que escribe el personal en la bandeja y los ecos del teléfono del negocio no son texto de un paciente.

## User Scenarios & Testing

### Historia 1. Un mensaje de salud no llega crudo a ninguna tabla (P1)

1. **Dado** un negocio dental con perfil, **cuando** llega por WhatsApp "me duele la muela, mi correo es ana@mail.com", **entonces** ni `webhook_event.payload` ni `message.text` contienen el texto: queda `[mensaje con información de salud omitido]` con las marcas `salud`, `sintoma`.
2. Lo mismo por Instagram, Messenger y Zernio, y en el pie de una foto.

### Historia 2. La tarjeta del anuncio y los ecos quedan intactos (P1, ajuste de Andres)

1. **Dado** un mensaje que llega de un anuncio con `referral.body` que menciona un tratamiento, **cuando** se guarda, **entonces** `referral.body` queda igual (la tarjeta del anuncio se ve completa) mientras el texto del paciente se omite.
2. **Dado** un eco del teléfono del negocio con términos de salud, **entonces** queda intacto.

### Historia 3. Sin perfil, el texto no se guarda (P1)

1. **Dado** un negocio sin perfil, **cuando** llega un texto, **entonces** se guarda `[mensaje omitido: no se pudo revisar]` con `sin_revisar`, y un botón "No acepto" se conserva.

### Historia 4. El cerebro recibe las marcas y la huella (P1)

1. **Dado** un mensaje de salud, **cuando** se despacha, **entonces** el mensaje lleva `privacyFlags: ["salud", …]` y `organization.privacyProfileHash` es la huella del perfil del negocio.
2. **Dado** que el cerebro tiene otra configuración, **entonces** deja un aviso con las dos huellas y sigue.

### Historia 5. El Laboratorio no guarda texto sin filtrar (P2)

1. **Dado** una persona de prueba que dice algo de salud, **cuando** corre el Laboratorio, **entonces** el mensaje se guarda omitido y con marcas.

### Casos borde

- **Sin organización resuelta:** el evento no se guarda (como hoy) y la ingesta filtra por su cuenta (D5).
- **Un campo desconocido** con texto (`foo.text`): la red de seguridad lo filtra.
- **Un error de Meta** en `statuses[].errors[].title`: intacto (no es texto de un paciente).
- **Reproceso de un evento guardado:** el payload ya está filtrado y trae sus marcas; no se filtra dos veces.

## Requirements

- **FR-001** `filtrarPayload(payload, politica)` en `src/server/privacy/webhook.ts`: devuelve una copia filtrada y anotada, sin tocar el original (D1 a D4, D9).
- **FR-002** `guardarEvento` guarda solo la copia filtrada.
- **FR-003** `ingestInboundMessage` exige `marcas` (`string[] | null`) y `botonId` opcional; guarda `privacy_flags`; con `null` filtra (D5). Los cuatro canales leen las marcas anotadas.
- **FR-004** El Laboratorio filtra lo que escribe la persona de prueba (D6).
- **FR-005** Migración `0028_marcas_privacidad`: `message.privacy_flags text[] NULL`.
- **FR-006** Despacho: `messages[].privacyFlags` y `organization.privacyProfileHash` (D7, `contracts/despacho-v2-enmienda.md`).
- **FR-007** Cerebro: acepta `organization.privacyProfileHash` y avisa si no cuadra (D8).

## Success Criteria

- **SC-001** Con un payload de cada fuente que trae salud, correo, teléfono y documento, lo guardado en `webhook_event` y en `message` no contiene ninguna de esas frases.
- **SC-002** `referral.body` y un eco con salud quedan intactos (prueba fija).
- **SC-003** Revisión completa en verde en Vocero y en el cerebro, CI en verde, 4 de 4 sabotajes.
- **SC-004** La migración aplica sobre una base con datos.

## Huecos conocidos (aceptados por Andres)

- **Contactos y ubicaciones compartidos** (`media_asset.payload`: nombres, teléfonos, direcciones) se guardan como hoy hasta el **bloque C** (paso 3.3, política de adjuntos, D11).
- **Los mensajes que ya existen** en bases de desarrollo y demo no se re-filtran (no hay datos reales, D6). Si hiciera falta, un script antes del piloto.

## Lo que esta spec NO hace

- Adjuntos (bloque C), consentimiento con botones y `buttonId` en el despacho (bloque C), ficha y notas (bloque D), salud con el Agente apagado (bloque D), retención (bloque E).
- Re-filtrar lo ya guardado.
- Filtrar lo saliente (D9).
