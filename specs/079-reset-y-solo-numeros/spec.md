# 079 — `reset` solo en el Laboratorio y «solo estos números» (bloque K)

Fase 5 de Aliantis, pasos 5.4 (N3) y 5.5. Seguridad: va aparte del resto. Solo toca `vocero-crm`; el cerebro no cambia (ver «El cerebro»).

## Por qué

- **N3 (brecha alta de la auditoría):** `POST /api/bot/reset` vale en cualquier conversación. Reactiva la IA, borra el traspaso a una persona y devuelve el lead a la primera etapa. Con la llave del cerebro, una conversación real que atiende una persona puede volver al bot sin que nadie lo decida.
- **«Solo estos números»:** el reemplazo de `ALLOWED_WA_IDS` de `nea-agent` para el piloto. Con la lista encendida, el bot atiende solo a los números de la lista; los demás quedan para una persona, como con el Agente apagado.

## Lo que hay hoy (verificado en el código, 12-nov-2026)

- **`src/app/api/bot/reset/route.ts:21-94`:**
  - busca la conversación por negocio y pone `aiEnabled: true`, `handoffAt: null` y `handoffReason: null`;
  - lleva el lead a la primera etapa con `moveLeadToStage(source: "sistema")`;
  - no mira `isTest`.
- **Nadie lo llama hoy:**
  - el Laboratorio (`src/server/lab/runner.ts:239-339`) crea una conversación `isTest` nueva por caso y al final la olvida;
  - el cerebro tiene `reiniciarPrueba` (`aliantis-brain/src/vocero/client.ts:216`), pero ningún turno lo usa;
  - su simulador ya responde `409 solo_laboratorio` fuera de prueba (`test/support/vocero-simulado.ts:360-368`).
- **El despacho tiene dos puertas:**
  - al encolar, `despacharAlCerebro` (`src/server/dispatch/encolar.ts:19-81`), llamado desde `ingestInboundMessage` (`src/server/inbox/ingest.ts:598`) para WhatsApp, Instagram, Messenger y Zernio. Revisa la IA pausada, el traspaso, `isTest` y el Agente encendido o el negocio pausado, con la excepción de salud (D9);
  - al entregar, `procesar` (`src/server/dispatch/worker.ts:214-285`) revisa de nuevo la pausa y el Agente (`evento.conversation.agentEnabled`, `src/server/brains/deliver.ts:277`), porque pudieron cambiar durante la ventana de agrupado.
- **La identidad del contacto:** `contact.wa_identity` es el teléfono normalizado con `normalizeMx` (`521…` → `52…`) en WhatsApp, `bsuid:<id>`, `ig:<IGSID>` o la de Messenger. `normalizeImportPhone` (`src/lib/contact-import.ts:114`) exige el código de país.
- **No existe ninguna lista de números:** `privacy_profile.allowlist` es de términos del filtro de salud.

## Qué cambia

### 1. `reset` solo en el Laboratorio (5.4)

- **Fuera de prueba:** `POST /api/bot/reset` sobre una conversación con `is_test = false` responde `409 solo_laboratorio` y no toca nada: ni la IA, ni el traspaso, ni la etapa, ni el evento.
- **Mismo código que ya espera el simulador del cerebro.** Con `is_test = true`, igual que hoy.
- **Orden de las respuestas:** `404 not_found` (no existe o es de otro negocio) antes que `409 solo_laboratorio`.

### 2. «Solo estos números» (5.5)

- **Dónde vive:** en Vocero, en `agent_profile` (respuesta pendiente 1). Migración `0036`:
  - `solo_numeros_activo boolean NOT NULL DEFAULT false`;
  - `solo_numeros text[] NOT NULL DEFAULT '{}'`;
  - `CHECK (cardinality(solo_numeros) <= 50)`.

  Ya está bajo la RLS de `agent_profile`.
- **Formato de los números:** solo dígitos, con código de país, de 11 a 15 dígitos y normalizados con `normalizeMx`. Se guardan sin repetidos.
- **Quién la cambia:** `PUT /api/agent/profile` recibe `soloNumeros: { activo, numeros }`, y solo un rol con `canConfigure` puede cambiarla (403 si no).
  - Cada número inválido da `422 numero_invalido`, con el número en el mensaje.
  - Encenderla con la lista vacía da `422 lista_vacia`.
  - `GET` la devuelve.
- **La regla:** una función pura `permitidoPorLista(lista, identidad)` en `src/server/dispatch/solo-numeros.ts`.
  - Con la lista apagada, todo pasa.
  - Con la lista encendida, pasa solo una identidad que es un teléfono (solo dígitos, ya normalizado) y está en la lista.
  - `ig:`, Messenger, TikTok y `bsuid:` no pasan (respuesta pendiente 2).
- **Las dos puertas:**
  - **al encolar:** `despacharAlCerebro` lee `wa_identity` del contacto y el perfil; fuera de la lista no encola;
  - **al entregar:** `procesar` vuelve a revisar con lo que trae el evento (`contact.identity`) y la lista leída en `construirEvento`. Si ya no pasa, descarta con el motivo «fuera de la lista de números».
- **El Laboratorio (`is_test`) no se filtra:** no tiene número real.
- **Salud (respuesta pendiente 3):** igual que con el Agente apagado (D9), lo marcado con salud de un número fuera de la lista **sí** se despacha, para que salga la frase de seguridad. Todo lo demás de ese número no le llega al cerebro.
- **Fuera de la lista no pasa nada más:** el mensaje queda en la bandeja para una persona. No hay aviso de privacidad ni consentimiento, porque el bot no habló.
- **La pantalla:** en la configuración del Agente, un interruptor «Solo estos números (piloto)» y un campo con un número por línea. Explica que con la lista encendida Instagram, Messenger y TikTok no reciben respuesta del agente.

### 3. Permiso de `PUT /api/agent/profile` (respuesta pendiente 4)

Hallazgo fuera del plan: hoy cualquier miembro del negocio puede encender o apagar el Agente, porque la ruta no revisa `canConfigure`; `preset` sí lo revisa. Se propone exigir `canConfigure` a toda la ruta (`403 forbidden`), como `preset`.

## El cerebro

No cambia el código:
- el simulador ya devuelve `409 solo_laboratorio`;
- `reiniciarPrueba` no se usa en ningún turno;
- la lista filtra antes del cerebro.

No hay PR en `aliantis-brain`. No cambian el prompt ni el decisor, así que no hay medición real.

## Contrato y documentación

- **`docs/openapi.json`:** `/api/bot/reset` con el 409, y `soloNumeros` en el perfil del Agente.
- **`README.md` y `AGENTS.md`:** la regla de la lista y el `reset` del Laboratorio.
- **`aliantis-core`:** `decisiones.md` y `estado.md`, en el último PR del bloque.
- **`RELEVO_ARQUITECTURA.md`:** N3 queda cerrada, en un PR del espacio solo si la tabla de brechas lo necesita.

## Pruebas

- **Unitarias:**
  - la ruta de `reset` (409 fuera de prueba sin tocar nada, 200 en prueba, 404 antes que 409);
  - `permitidoPorLista` (apagada, encendida, `521` contra `52`, `ig:` y `bsuid:`);
  - `despacharAlCerebro` y `procesar` con la lista (incluidas salud e `is_test`);
  - la validación del perfil (`numero_invalido`, `lista_vacia`, 403 sin `canConfigure`, sin repetidos);
  - la migración.
- **E2E en `e2e.yml`:**
  - en `e2e-contrato-aliantis.mjs`, una sección `resetYSoloNumeros()`:
    - `reset` sobre una conversación real da 409, y la conversación sigue traspasada;
    - sobre `is_test` da 200;
    - con la lista encendida: un número de la lista llega al cerebro simulado, otro no, y uno fuera de la lista con salud sí llega;
    - al apagarla, vuelve a llegar;
  - en `e2e-rls.mjs`: la lista de un negocio no se lee ni se cambia desde otro.
- **Todos los demás guiones de `e2e.yml`, iguales.**

## Sabotajes (en borrador, uno por uno con pausa, se cierran sin merge)

1. Quitar la revisión de `isTest` en `reset`.
2. `procesar` sin revisar la lista: un número sacado durante la ventana llega igual.
3. Comparar la lista sin `normalizeMx`: `521…` deja de casar con `52…`.
4. Quitar `canConfigure` del cambio de la lista.

## Fuera de alcance

- Una lista por canal, con identidades de Instagram o Messenger.
- Un comando `/reset` escrito por el cliente.
- El Laboratorio con la llave de Aliantis y el tope diario: es el bloque L.
