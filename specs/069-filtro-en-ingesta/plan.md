# 069 — Plan

Spec: [spec.md](spec.md). Modelo: [data-model.md](data-model.md). Contrato: [contracts/despacho-v2-enmienda.md](contracts/despacho-v2-enmienda.md).

## Constitution Check

| Principio | Cumple | Cómo |
| --- | --- | --- |
| I. Seguridad | **Lo refuerza** | Ningún texto de paciente se guarda sin filtrar; los logs nuevos no llevan contenido |
| II. Soberanía | Sí | Sin terceros |
| III. Multi-tenancy | Sí | El perfil se lee con `scoped()` por la organización del evento |
| IV. Idempotencia | Sí | La huella del evento sigue sobre el cuerpo crudo; reprocesar no filtra dos veces |
| V y IX. Verificación | Sí | Pruebas por fuente, contrato gemelo, sabotajes, E2E con mocks |
| VI. Specs antes de código | Sí | Ciclo completo: esquema y contrato |

## Lo investigado en el código

- `recibirEvento` (`src/server/webhooks/recibir.ts`): resuelve la organización, `guardarEvento` y `after(procesarEvento)`. Sin organización, procesa el payload sin guardarlo (por eso D5).
- `procesarFuente` reparte: WhatsApp (`processMessagesValue` para `field: messages`, `processEchoesValue` para `smb_message_echoes`, estados de plantillas), Instagram y Messenger (forma Meta `entry[].messaging[]` o forma Zernio), Zernio (`processZernioPayload`, también TikTok).
- `ingestInboundMessage` tiene 5 llamadas (WhatsApp, Instagram ×2, Messenger, TikTok). El pie de foto viaja en `media.caption` (de `mediaInputFrom`), así que sale filtrado del payload.
- `lab/runner.ts` inserta cada línea de la persona como mensaje entrante.
- `armarEvento` es la única que arma el despacho; las llaves nuevas van al final y solo si aplican (021, 031, 033).
- El cerebro ya une las marcas de Vocero con las suyas (`filtrarMensajes`, `inbox-pg.ts`) y su esquema no es estricto: el orden de despliegue no importa.

## Diseño

- **`src/server/privacy/webhook.ts`**: `filtrarPayload(payload, politica)`. Copia (`structuredClone`), filtra por forma (WhatsApp, Meta, Zernio; las formas no se pisan, se aplican las tres) y anota `_privacidad: string[]` en cada mensaje de paciente. Un `WeakMap` registra qué campos ya revisó cada objeto. Después, la red de seguridad recorre el resto con las exclusiones de D3.
- **`src/server/privacy/repositorio.ts`**: `perfilVigente(org)` devuelve `{ politica, huella }` o `null` (la misma validación de antes); `perfilDePrivacidad` queda encima.
- **`src/server/privacy/filtrar.ts`**: `filtrarTexto(texto, politica, botonId)` → `{ text, marcas }` (`classifyAndMask` o `withoutReview`).
- **`guardarEvento`**: `perfilVigente` + `filtrarPayload` antes del `INSERT`.
- **Ingesta**: `marcasDe(objeto)` lee `_privacidad`; los cuatro canales la pasan. `ingestInboundMessage({ marcas, botonId })`: con `null` filtra texto y pie de foto.
- **Laboratorio**: `filtrarTexto` de cada línea antes del `INSERT`.
- **Despacho**: `privacy_flags` en `columnasDelMensaje`; la huella con `perfilVigente` en `construirEvento`.
- **Cerebro**: `organization.privacyProfileHash` opcional en `events.ts`; `inbox-pg.ts` compara con `perfilExportado(config).huella` y llama `onPerfilDistinto` (log `warn` en `cerebro.ts`).

## Pruebas

| Prueba | Qué fija |
| --- | --- |
| `privacidad-webhook.test.ts` | Cada fuente: nada crudo, marcas anotadas; `referral.body` y el eco intactos (ajuste de Andres); `statuses` intacto; sin perfil; red de seguridad con un campo desconocido; no toca el original |
| `privacidad-guardar-evento.test.ts` | Lo que llega al `INSERT` de `webhook_event` está filtrado; la huella es la del cuerpo crudo |
| `privacidad-ingesta.test.ts` | WhatsApp: guarda las marcas anotadas; sin anotación filtra; el botón sin perfil se conserva |
| `privacidad-laboratorio.test.ts` (o dentro de una existente) | La línea de la persona se guarda filtrada |
| `despacho-contrato.test.ts` | Cuerpo gemelo intacto; `privacyFlags` y `privacyProfileHash` al final, solo si aplican |
| Cerebro `inbox-pg.test.ts` | Huella que cuadra, ausente, distinta, sin configuración |
| E2E con mocks (`scripts/e2e-despacho.mjs`) | Un mensaje de salud llega omitido a la bandeja y al cerebro falso, con marcas |

## Sabotajes (4)

1. `guardarEvento` guarda el payload original.
2. La ingesta ignora las marcas y guarda el texto que recibe sin filtrar cuando vienen en `null`.
3. Sin perfil, `filtrarTexto` deja pasar el texto.
4. `armarEvento` no manda `privacyFlags`.

## Lo que no se hará

Ver «Lo que esta spec NO hace» y «Huecos conocidos» en `spec.md`.
