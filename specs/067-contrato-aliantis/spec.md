# Feature Specification: Contrato v2 con el cerebro de Aliantis

**Feature Branch**: `067-contrato-aliantis`

**Created**: 2026-11-09

**Status**: Especificada antes de escribir código. Solo especificación: la implementación se reparte en las fases 3, 4 y 5 del plan maestro (`../../../RELEVO_ARQUITECTURA.md`, sección 9).

**Input**: paso 0.2 del plan maestro de la adopción. Decisiones D1, D2, D7, D8, D9, D10 y D13 aprobadas por Andres el 2026-11-09 (`aliantis-core/docs/trabajo/decisiones.md`, «Plan de la adopción»), y las brechas N1, N3, N4 y N5 de la auditoría.

**Carril**: ciclo completo (Principio VI). Toca el modelo de datos (migración `0027`: tabla `consent` y tres columnas en `message`) y dos contratos publicados: `/api/bot/*` y el evento de despacho.

**Subordinación**: este fork sigue los 6 pilares de Aliantis Core (`../../CLAUDE.md`). Donde esta spec diverge de la constitución de Vocero o del contrato original, la divergencia está escrita en `plan.md` («Divergencias»).

## Contexto

El cerebro de Aliantis (`aliantis-brain`) reemplaza a Nea. Sigue una arquitectura distinta: el LLM solo elige comandos que valida zod, el código arma el texto, y lo crítico (salud, consentimiento, pedir una persona) es determinista. Para eso necesita del CRM cosas que el contrato actual no da:

- **Una instalación atiende a varios negocios**, y hoy las 12 rutas de `/api/bot/*` escriben en la primera organización de la tabla (`resolveInstanceOrg`, `limit 1`).
- **El aviso de privacidad se acepta con botones** (Acepto / No acepto), y hoy `/api/bot/messages` solo manda texto, la ingesta pierde el id del botón y no hay dónde registrar el consentimiento ni cómo borrar la conversación cuando alguien no acepta.
- **La salud sale antes que todo, aunque el bot esté pausado**, y hoy con el Agente apagado no se despacha nada.
- **El cerebro necesita las marcas de privacidad** de cada mensaje (`salud`, `urgencia`, `sin_revisar`…) para aplicar sus reglas fijas, y el historial filtrado para decidir, sin guardar su propia copia de los mensajes.
- **Los motivos de traspaso** de Aliantis (salud, reclamo, tope de gasto…) hoy caen sin aviso en `modelo`.
- **`/api/bot/reset` vale en conversaciones reales**: reactiva la IA y borra el traspaso que hizo una persona.

## Decisiones

- **D1. Todo es aditivo.** Nada se quita ni se renombra. Las llaves nuevas del despacho viajan **solo si aplican**, como ya hacen `test` y `fileName`: el cuerpo y la firma gemelos de `tests/unit/despacho-contrato.test.ts` no cambian.
- **D2. Un negocio, una credencial.** El cerebro contesta con `X-Vocero-Organization: <org id>` y la credencial derivada `HMAC-SHA256(BOT_API_KEY, "vocero:cerebro:v1:{org_id}")` en base64url sin relleno. Es exactamente la de Vocero Cloud (`credencial_derivada` en Nea, `src/server/brains/deployment.ts` en Cloud), para no inventar un segundo formato. Un error del cerebro con un negocio no puede escribir en otro.
- **D3. Compatibilidad con una sola organización.** Sin la cabecera, `BOT_API_KEY` sigue valiendo **solo si la instalación tiene exactamente una organización**. Con dos o más, la petición sin cabecera responde `409 organizacion_requerida`. Nunca se vuelve a elegir «la primera».
- **D4. El despacho sigue firmado con `BOT_API_KEY`.** El cerebro lo verifica con el secreto del despliegue y lee el negocio de `organization.id` del cuerpo. Igual que Cloud.
- **D5. Las marcas de privacidad las calcula el CRM** al guardar (fase 3 del plan maestro) y viajan con cada mensaje. El cerebro vuelve a filtrar como defensa (D1 de Aliantis).
- **D6. El consentimiento vive en el CRM.** Es un registro legal del negocio responsable: se guarda en una tabla de solo agregar y el contexto lo devuelve. Las reglas de cuándo pedirlo siguen en el cerebro.
- **D7. «No acepto» borra los mensajes de esa conversación,** igual que `aliantis-core` (`deleteByConversation`): filas, adjuntos y su copia en `webhook_event`. Se conservan el contacto, el lead y el registro del consentimiento. El CRM solo borra si hay un rechazo registrado para esa conversación: un error del cerebro no puede vaciar una conversación ajena.
- **D8. Salud con el Agente apagado.** Si un entrante trae la marca `salud`, se despacha aunque el interruptor del Agente esté apagado, con `conversation.agentEnabled: false`. Con el Agente apagado, `/api/bot/messages` solo acepta un mensaje con `motivo: "seguridad"` por cada entrante marcado con salud. Con una persona atendiendo (`handoff_at` o `ai_enabled = false`) no se despacha nada, igual que en `rules.ts` de Aliantis.
- **D9. Motivos de traspaso ampliados** con los de Aliantis: `salud`, `reclamo`, `no_entiende`, `agendar`, `tope_gasto`, `medios`. El catálogo sigue aplicándose con fallback (un motivo raro no puede costar el traspaso). No hace falta migración: `handoff_reason` no tiene restricción en la base.
- **D10. Historial por el CRM.** `GET /api/bot/history` devuelve los últimos mensajes de una conversación, ya filtrados. El cerebro no guarda una copia: una sola retención y un solo borrado (D2 de Aliantis).
- **D11. `reset` solo en el Laboratorio.** En una conversación real responde `409 solo_laboratorio`. Solo una persona devuelve una conversación al bot.
- **D12. Sin endpoint de reconciliación para `conversation.deleted`** (brecha N6). Con D10 el cerebro ya no guarda texto de la conversación; lo que guarda (pendientes, punto de control, costo) está indexado por `conversation.id`, que no se reutiliza, y su retención lo borra. Se revisa si la fase 3 encuentra otra cosa.

## User Scenarios & Testing

### Historia 1. El cerebro atiende a varios negocios sin cruzarlos (P1)

**Por qué**: es la brecha más grave. Sin esto, la instalación multi-tenant escribe en el negocio equivocado.

**Prueba independiente**: dos organizaciones en la misma base; el cerebro falso escribe con la credencial de una y comprueba que la otra no ve nada.

1. **Dado** dos organizaciones A y B, **cuando** el cerebro llama `POST /api/bot/messages` con `X-Vocero-Organization: A` y la credencial de A sobre una conversación de A, **entonces** el mensaje sale en A.
2. **Dado** lo mismo, **cuando** usa la credencial de A con la cabecera de B, **entonces** responde `401` y no escribe nada.
3. **Dado** la credencial y la cabecera de A, **cuando** pide una conversación de B, **entonces** responde `404` (no existe para A).
4. **Dado** dos organizaciones, **cuando** llega una petición con `BOT_API_KEY` y sin cabecera, **entonces** responde `409 organizacion_requerida`.
5. **Dado** una sola organización, **cuando** llega una petición con `BOT_API_KEY` y sin cabecera, **entonces** funciona como hoy.
6. **Dado** que A agotó su presupuesto por minuto, **cuando** B llama, **entonces** B no recibe `429`.

### Historia 2. Aviso de privacidad con botones y consentimiento registrado (P1)

1. **Dado** una conversación de WhatsApp con la ventana abierta, **cuando** el cerebro manda `text` con `buttons` (1 a 3), **entonces** sale un mensaje interactivo con esos botones, y la bandeja lo muestra con sus botones.
2. **Dado** un canal que no admite botones (Instagram, Messenger, TikTok), **cuando** el cerebro manda `buttons`, **entonces** responde `409 canal_sin_botones` y no envía nada (el cerebro manda el texto sin botones).
3. **Dado** que el cliente toca «Acepto», **cuando** entra el webhook, **entonces** el mensaje se guarda con el rótulo como texto y el id del botón en `buttonId`, y el despacho lo lleva.
4. **Dado** un consentimiento registrado con `POST /api/bot/consent`, **cuando** el cerebro pide el contexto, **entonces** `consent.avisoPrivacidad` trae el último (`granted`, `noticeVersion`, `at`).

### Historia 3. «No acepto» borra la conversación (P1)

1. **Dado** un rechazo registrado (`granted: false`) para la conversación, **cuando** el cerebro llama `POST /api/bot/forget`, **entonces** se borran sus mensajes, adjuntos (archivo y fila) y los eventos de webhook que los traían, y se conservan el contacto, el lead y el consentimiento.
2. **Dado** que no hay rechazo registrado, **cuando** llama `forget`, **entonces** responde `409 sin_rechazo` y no borra nada.
3. **Dado** el borrado hecho, **cuando** el cerebro envía el texto fijo de «no acepta», **entonces** es el único mensaje que queda en la conversación.

### Historia 4. Salud aunque el bot esté pausado (P1)

1. **Dado** el Agente apagado y un entrante con la marca `salud`, sin persona atendiendo, **entonces** se despacha con `conversation.agentEnabled: false`.
2. **Dado** el Agente apagado y un entrante sin la marca, **entonces** no se despacha (como hoy).
3. **Dado** el Agente apagado, **cuando** el cerebro manda un mensaje sin `motivo: "seguridad"`, **entonces** responde `409 agente_apagado`.
4. **Dado** el Agente apagado y un entrante con salud sin contestar, **cuando** el cerebro manda uno con `motivo: "seguridad"`, **entonces** sale; **cuando** manda un segundo para el mismo entrante, **entonces** responde `409 agente_apagado`.
5. **Dado** una persona atendiendo, **entonces** no se despacha nada, con salud o sin ella.

### Historia 5. Marcas de privacidad e historial (P1)

1. **Dado** un entrante guardado con marcas, **entonces** el despacho lleva `privacyFlags` en ese mensaje; sin marcas, no lleva la llave.
2. **Dado** una conversación, **cuando** el cerebro pide `GET /api/bot/history?conversationId=…`, **entonces** recibe los últimos 20 mensajes (máximo 50 con `limit`) en orden de llegada, con dirección, tipo, texto ya filtrado, origen, marcas y `buttonId`/`buttons` si los hay. Sin notas internas.

### Historia 6. Motivos de traspaso de Aliantis (P2)

1. **Dado** `POST /api/bot/handoff` con `reason: "salud"`, **entonces** la conversación queda con motivo `salud` y Resultados y el hilo lo rotulan («Información de salud: la atiende una persona»), sin afirmar urgencia.
2. **Dado** un motivo fuera del catálogo, **entonces** cae en `modelo`, como hoy.

### Historia 7. `reset` solo en el Laboratorio (P2)

1. **Dado** una conversación `is_test`, **cuando** el cerebro llama `reset`, **entonces** funciona como hoy.
2. **Dado** una conversación real, **entonces** responde `409 solo_laboratorio` y no cambia nada.

### Casos borde

- Un botón cuyo webhook trae id pero no rótulo: se guarda con el id como texto (como hoy) y `buttonId`.
- `forget` sobre una conversación de prueba: se permite.
- `forget` dos veces: la segunda no encuentra nada que borrar y responde `200` con `deleted: 0` (idempotente).
- Un despacho por salud con el Agente apagado que falla tres veces: cae a humano con motivo `error`, como cualquier despacho.
- La credencial derivada de una organización que se elimina deja de valer, porque no hay organización con ese id.

## Requirements

### Funcionales

- **FR-001**: toda ruta de `/api/bot/*` resuelve la organización con la cabecera y la credencial derivada (D2), o con la regla de una sola organización (D3). `resolveInstanceOrg` desaparece.
- **FR-002**: el presupuesto de llamadas y la marca de «quién responde» son por organización.
- **FR-003**: `POST /api/bot/messages` acepta `buttons` (1 a 3; `id` hasta 256 caracteres, `title` hasta 20, ambos únicos; con botones, `text` hasta 1024) y `motivo` (`"seguridad"`). Límites de Meta según `aliantis-core/src/whatsapp/sender.ts`, verificados en nov-2026 (estimación: Meta puede cambiarlos).
- **FR-004**: la ingesta guarda el id del botón tocado en `message.button_id` y el despacho lo lleva como `buttonId`, solo si existe.
- **FR-005**: `POST /api/bot/consent` registra un consentimiento (solo agregar). `GET /api/bot/context` devuelve el último por tipo.
- **FR-006**: `POST /api/bot/forget` borra lo de D7 solo con un rechazo registrado para esa conversación.
- **FR-007**: con el Agente apagado se despacha solo lo marcado con `salud` (D8), y `messages` aplica la regla de un mensaje de seguridad por entrante.
- **FR-008**: `message.privacy_flags` se expone como `privacyFlags` en el despacho (solo si no está vacío) y en el historial. Valores del contrato: `salud`, `urgencia`, `sintoma`, `condicion`, `medicamento`, `sin_revisar`, `correo`, `telefono`, `documento`, `tarjeta`.
- **FR-009**: `GET /api/bot/history` según la historia 5.
- **FR-010**: el catálogo de motivos incluye los de D9, con sus rótulos en Resultados y en el hilo.
- **FR-011**: `POST /api/bot/reset` responde `409 solo_laboratorio` en una conversación real.
- **FR-012**: `docs/openapi.json`, `AGENTS.md` y el contrato del despacho quedan al día; el contrato de esta spec manda.

### Entidades

- **Consentimiento** (`consent`): de qué contacto y conversación, tipo (`aviso_privacidad` o `marketing`), si se otorgó, versión del aviso, mensaje de origen y cuándo. Nunca se edita ni se borra con la conversación.
- **Mensaje**, con tres datos nuevos: marcas de privacidad, id del botón tocado y botones enviados.

## Success Criteria

- **SC-001**: la prueba de aislamiento con dos organizaciones falla si una ve o escribe en la otra, y pasa con el cambio.
- **SC-002**: el cuerpo y la firma gemelos de `despacho-contrato.test.ts` y `olvido-contrato.test.ts` no cambian.
- **SC-003**: cada historia tiene su guion en `tests/e2e/` y su arnés con un cerebro falso, en verde contra la app con mocks.
- **SC-004**: los sabotajes de `plan.md` los detecta alguna prueba, todos.

## Lo que esta spec NO hace

- **No filtra privacidad**: define dónde viajan las marcas. El filtro en la ingesta y en `webhook_event` es la fase 3.2, con su propia spec.
- **No construye RLS, App Secret por negocio, alta de organizaciones ni el panel de Andres** (fase 4).
- **No toca la ficha ni las notas** (D12 de Aliantis, fase 3).
- **No cambia la agenda** (D19, fase 8).
- **No toca el proxy `/api/bot/llm`** más allá de resolver la organización: el cerebro de Aliantis no lo usa (D3 de Aliantis).
- **No muestra el consentimiento en la interfaz**: la ficha del contacto lo mostrará en la fase 10.
