# Feature Specification: Cerebro multi-organización (`/api/brains/*`)

**Feature Branch**: `feat/070-cerebro-multiorg`
**Created**: 2026-11-17
**Status**: Draft — diseño pendiente de aprobación (no se ha cambiado código)
**Carril**: **Ciclo completo** (Principio VI): migración `0029_cerebros`,
contrato publicado nuevo (`/api/brains/*`, evento de despacho en `multi`) y
cambio coordinado en el repositorio del cerebro.
**Constitución**: 2.0.0 (Principios I, II, III, IV, VIII, X; Restricciones
«Superficies de organización única», «Contratos entre repositorios»).
**Repos**: `vocero-crm` (todo el trabajo) · `nea-agent` (una línea de ruta y
pruebas gemelas; ver D3).
**Contrato de referencia**: [contracts/brains.md](contracts/brains.md),
auditado contra `nea-agent@f632397` (`app/crm_brains.py`, `app/multiorg.py`,
`app/ensayo.py`, `app/dispatch.py`, `app/dispatch_worker.py`, `app/agenda.py`,
`app/crm.py`, `app/tools.py`).

## Problema

Desde la 069, con `TENANCY=multi` los negocios operan su bandeja **a mano**: el
despacho de organización única está apagado y `/api/bot/*` responde 404. Nea ya
sabe atender a N negocios con un solo contenedor (`VOCERO_MODE=cloud` +
`CRM_ORGANIZATION` vacía): verifica despachos con el secreto de su despliegue,
deriva la credencial de cada organización y contesta por `/api/brains/*`. Lo que
falta está en el CRM:

- no existe ningún endpoint `/api/brains/*`;
- no hay dónde registrar un despliegue de cerebro ni su secreto, ni cómo
  asignárselo a un negocio;
- el despacho no sabe a qué cerebro mandar cada organización;
- no hay pruebas que garanticen que un cerebro con la credencial de A no puede
  leer ni escribir nada de B.

## Auditoría del contrato (lo que Nea espera hoy)

Resumen; el detalle normativo está en [contracts/brains.md](contracts/brains.md).

| Nea llama | Método | Ruta en el CRM | Notas del cliente |
|---|---|---|---|
| `precargar` / `get_context` | GET | `/api/brains/context?conversationId=&contextVersion=2` | 404 → sin turno; 5xx/429 → caída; lee `agent`, `knowledge`, `llm` además del cuerpo de `/api/bot/context` |
| `send_message` | POST | `/api/brains/messages` | **exige `dispatchId`**; acepta cualquier 2xx; 409 tipado; 422 `fuera_de_ventana` = ventana cerrada |
| `put_ficha` | PUT | `/api/brains/ficha` | 200 |
| `move_stage` | POST | `/api/bot/stage` ⚠️ | **no está en `RUTAS`**: hoy en cloud sale a `/api/bot/stage` (404 en `multi`). Ver D3 |
| `post_handoff` | POST | `/api/brains/handoff` | `reason` ya normalizada al catálogo `cliente|modelo|error|ventana|hostilidad` |
| `post_typing` | POST | `/api/brains/typing` | best-effort, timeout 8 s |
| `get_media` | GET | `/api/brains/media/{mediaId}` | streaming, tope 16 MB |
| `sondear_agenda` | GET | `/api/brains/agenda/slots?conversationId=cv_sonda` | **404 vacío = agenda apagada**; 404 con sobre / 401 = existe |
| `get_availability` / `consultar_huecos` | GET | `/api/brains/agenda/slots?conversationId=[&date][&agendaId]` | registra la oferta; `{slots, query}` |
| `create_booking` / `reschedule_booking` | POST / PATCH | `/api/brains/agenda/book` | 409 `slot_taken`/`slot_not_offered` con `slots`; respuesta `{ok, booking:{…}}` |
| `list_bookings` | GET | `/api/brains/agenda/bookings?conversationId=` | solo con capacidad `agenda_v2` |
| `cancel_booking` | POST | `/api/brains/agenda/cancel` | solo con `agenda_v2`; `selectionToken` + `idempotencyKey` |
| `set_coordination_consent` | POST | `/api/brains/agenda/followup` | solo con `agent.coordinationFollowupEnabled` |
| `OpenAiLlm` | POST | `/api/brains/llm/chat/completions` | credencial derivada como API key + `X-Vocero-Organization` |
| ensayo | — | lectura con `X-Vocero-Ensayo` | solo si el CRM llama `POST {nea}/vocero/ensayo` (ver D9) |

Autenticación en todas: `Authorization: Bearer <credencial>` +
`X-Vocero-Organization: <slug o id>`, con
`credencial = base64url_sin_relleno(HMAC-SHA256(secreto_despliegue, "vocero:cerebro:v1:" + organizationId))`
(vector fijado en Nea: `_BqRKryMUdexcuLj_3RG1ARbgqr_LhXRSLJYmrw5VJ0`, verificado
con Node).

Entrada a Nea: `POST {despliegue}/vocero/dispatch` firmado
`X-Vocero-Signature: sha256=<hex HMAC(secreto_despliegue, cuerpo)>`. En
multi-organización Nea **exige** `organization.id` (422 sin él), valida
`expiresAt` si viene, entiende `type: "conversation.deleted"` y activa la agenda
v2 solo si `capabilities` trae `"agenda_v2"`. `/health` de Nea dice
`mode: "multiorg"` y `llm: "crm"`.

## User Scenarios & Testing

### User Story 1 — Registrar despliegues de cerebro (Priority: P1)

Un Super-Admin abre `/platform/cerebros`, registra «Nea Producción» con su URL
de despacho; el CRM genera el secreto maestro y lo muestra **una sola vez** para
pegarlo en `CRM_BRAIN_SECRET` de Nea (o el Super-Admin pega uno existente).
Pulsa «Probar» y ve si `/health` responde y en qué modo.

**Independent Test**: crear un despliegue, copiar el secreto, probar salud
contra una Nea `multiorg` → «Sano · multiorg · llm crm»; la base guarda el
secreto cifrado y solo sus últimos 4 caracteres en claro.

**Acceptance Scenarios**:
1. **Given** un Super-Admin, **When** registra un despliegue con URL válida,
   **Then** se crea con secreto generado (≥ 32 bytes), se muestra una vez, se
   guarda cifrado con `ENCRYPTION_KEY` y queda auditado `cerebro_creado`.
2. **Given** un despliegue, **When** se pulsa «Probar», **Then** el CRM hace
   `GET` a la URL de salud (por defecto `{origen}/health`) con timeout 5 s y sin
   seguir redirecciones, y muestra estado, `version`, `mode` y `llm`; un modo
   distinto de `multiorg` se avisa («este cerebro atiende a un solo negocio»).
3. **Given** un despliegue, **When** se rota el secreto, **Then** el anterior
   deja de valer de inmediato en ambas direcciones y queda auditado.
4. **Given** un despliegue con negocios asignados, **When** se intenta borrar,
   **Then** se rechaza; se puede **pausar** (deja de despachar a todos).
5. **Given** cualquier lectura (panel, REST, MCP, Blueprint, logs), **Then** el
   secreto nunca aparece (solo `secretLast4`).

### User Story 2 — Asignar un cerebro a un negocio (Priority: P1)

Desde la ficha del negocio (pestaña «Agente») o el `FormularioBlueprint`, el
Super-Admin elige qué despliegue atiende a ese negocio, o «Sin cerebro (bandeja
manual)».

**Acceptance Scenarios**:
1. **Given** un negocio sin cerebro, **When** se le asigna un despliegue activo,
   **Then** a partir del siguiente mensaje entrante se despacha a ese cerebro
   (si `agent_profile.enabled` y la conversación tiene IA) y queda auditado
   `cerebro_asignado`.
2. **Given** un negocio reasignado de D1 a D2, **When** D1 intenta contestar con
   su credencial, **Then** recibe 401 (la credencial de D1 ya no vale para ese
   negocio).
3. **Given** el Blueprint, **When** se lee o aplica, **Then** `brain` es
   `{ deployment: "<id>" } | null`, sin secretos; aplicar un id inexistente o
   pausado es error de validación.

### User Story 3 — Autenticación del cerebro por organización (Priority: P1)

**Acceptance Scenarios**:
1. **Given** la credencial derivada de A con el secreto del despliegue asignado
   a A y `X-Vocero-Organization` = slug o id de A, **Then** la petición se
   atiende en el ámbito de A.
2. **Given** la credencial de A con la cabecera de B, o la de B con la de A, o
   una credencial derivada con el secreto de otro despliegue, o el secreto
   maestro en crudo como Bearer, **Then** 401 uniforme (mismo cuerpo, sin decir
   si la organización existe).
3. **Given** un negocio suspendido, **Then** 403 `organizacion_suspendida`.
4. **Given** `TENANCY` vacía o `single`, **Then** todo `/api/brains/*` es 404
   vacío (simetría con `/api/bot/*` en `multi`).
5. **Given** ≥ 20 credenciales rechazadas desde una IP en 10 min, **Then** 429
   antes de tocar la base (mismo limitador que tokens `alp_`).

### User Story 4 — Despacho por organización (Priority: P1)

**Acceptance Scenarios**:
1. **Given** `TENANCY=multi`, un negocio activo con cerebro asignado y activo,
   agente encendido y conversación con IA, **When** entra un mensaje, **Then**
   se encola y se entrega a `{despliegue}/vocero/dispatch` firmado con el
   secreto del despliegue, con `organization:{id, slug}` y `expiresAt`.
2. **Given** negocio suspendido, sin cerebro, cerebro pausado o agente apagado,
   **Then** no se despacha y el mensaje queda en la bandeja (igual que hoy).
3. **Given** una conversación eliminada, **Then** se envía
   `conversation.deleted` al cerebro asignado de **esa** organización.
4. **Given** el Laboratorio de un negocio en `multi`, **Then** las
   conversaciones de prueba se despachan a su cerebro con `conversation.test`.
5. **Given** `TENANCY` vacía, **Then** el despacho es idéntico a la 2.9.0
   (`BRAIN_DISPATCH_URL` + `BOT_API_KEY`, cuerpo gemelo sin cambios).

### User Story 5 — Superficie conversacional `/api/brains/*` (Priority: P1)

`context`, `messages`, `ficha`, `stage`, `handoff`, `typing`, `media/{id}` y
`llm` con las formas que Nea consume (ver contrato).

**Acceptance Scenarios** (selección; el resto en el contrato):
1. `context` devuelve el cuerpo de `/api/bot/context` + `agent` (perfil +
   `coordinationFollowupEnabled:false`), `knowledge` (`qa` y `block`) y `llm`
   (`{path:"/api/brains/llm", model, transcribeModel}`) **solo** si la
   organización tiene credencial de IA propia activa; sin ella, `llm: null`.
2. `messages` exige un `dispatchId` que exista para **esa** organización y
   **esa** conversación; repetir el mismo `(dispatchId, texto)` devuelve el
   mismo mensaje sin reenviarlo (idempotente); ventana cerrada → 422
   `fuera_de_ventana`; IA en pausa → 409 `ai_paused`; éxito → 201.
3. `llm` reenvía al proveedor con la llave BYOK de **esa** organización y nunca
   con la del entorno (`OPENROUTER_*`); sin llave → 402 `sin_credencial`.
4. `media/{id}` solo sirve adjuntos de mensajes de esa organización.

### User Story 6 — Agenda por el cerebro (Priority: P2)

**Acceptance Scenarios**:
1. Con el módulo agenda apagado en ese negocio, toda `/api/brains/agenda/*`
   responde **404 vacío**; encendido, una conversación inexistente da 404 con
   sobre (la sonda de Nea concluye «disponible»).
2. `slots` registra la oferta contra la conversación (como `/api/bot/availability`).
3. `book` POST reserva solo lo ofrecido (409 `slot_not_offered` con la lista
   vigente); PATCH reprograma; respuesta `{ok:true, booking:{…}}`, 201 al crear.
4. `bookings` y `cancel` cumplen la forma v2 (`selectionToken` opaco,
   `idempotencyKey`, `confirmation`), pero la capacidad `agenda_v2` **no se
   anuncia** en el despacho en esta fase (D7).
5. `followup` responde 409 `followup_not_allowed` mientras
   `coordinationFollowupEnabled` sea `false` (D8).

### User Story 7 — Pruebas de aislamiento y contrato gemelo (Priority: P1)

**Acceptance Scenarios**:
1. Para **cada** endpoint de `/api/brains/*`, con la credencial de A: los
   recursos de B (conversación, despacho, adjunto, cita, `selectionToken`)
   responden 404 con sobre y no cambian nada (`A ↛ B`).
2. Una prueba estática falla si una ruta bajo `src/app/api/brains/` no pasa por
   `requireBrain` o consulta tablas de negocio sin `organizationId` del ámbito.
3. Vectores gemelos fijados en ambos repos: credencial derivada, cuerpo del
   despacho `multi` + firma, cuerpo de `conversation.deleted` + firma, y la
   tabla de rutas de `BrainsCrmClient`.

## Edge Cases

- Slug cambiado: Nea cachea por id; la cabecera puede traer slug viejo → se
  acepta también el **id** en `X-Vocero-Organization` (Nea usa el id cuando no
  hay slug) y el slug actual; un slug viejo da 401 hasta el siguiente despacho
  (que lleva el slug nuevo).
- Respuesta tardía tras reasignación: `messages` con un `dispatchId` entregado
  por otro despliegue → 409 `cerebro_reasignado` (no se envía).
- Despacho vencido (`expiresAt`): Nea lo pasa a humano por su cuenta.
- Rotación del secreto con despachos en vuelo: los reintentos usan el secreto
  nuevo; Nea con el viejo responde 401 → el despacho caduca a humano (se avisa
  en el panel al rotar).
- Despliegue caído: reintentos actuales (3, backoff) → caducado a humano.

## Requirements

### Functional Requirements

- **FR-001**: Tabla `brain_deployment` con secreto cifrado en reposo
  (`encryptSecret`), `secretLast4`, URLs de despacho y salud, estado
  `activo|pausado`, último resultado de salud.
- **FR-002**: `organization.brain_deployment_id` (nullable, `ON DELETE
  RESTRICT`) y `dispatch.brain_deployment_id` (qué despliegue recibió cada
  despacho).
- **FR-003**: `requireBrain(req)` único para `/api/brains/*`: resuelve la
  organización por slug o id, toma su despliegue asignado y activo, deriva y
  compara en tiempo constante; ámbito = `{organizationId, deploymentId}`.
- **FR-004**: El secreto maestro solo sale del CRM en el momento de crearlo o
  rotarlo; nunca por negocio, nunca en Blueprint/REST/MCP/logs/auditoría.
- **FR-005**: Despacho `multi` por organización con el destino y el secreto del
  despliegue asignado; reutiliza outbox, worker, `entregar` y `avisarOlvido`.
- **FR-006**: Endpoints de la tabla de auditoría con las formas del contrato.
- **FR-007**: `/api/brains/llm` solo con credencial de la organización
  (`source: "org"`); el respaldo del entorno queda prohibido en esta superficie.
- **FR-008**: Idempotencia de `messages` por `(organizationId, dispatchId,
  sha256(texto))` y de operaciones de agenda v2 por `idempotencyKey`.
- **FR-009**: Auditoría de plataforma: `cerebro_creado`, `cerebro_actualizado`,
  `cerebro_secreto_rotado`, `cerebro_pausado`, `cerebro_reactivado`,
  `cerebro_asignado`, `cerebro_probado`.
- **FR-010**: Blueprint v1 gana `brain` (aditivo, opcional); MCP gana
  `list_brain_deployments` (solo lectura) y `get_organization` muestra el
  despliegue asignado. Crear/rotar despliegues: solo en el panel.
- **FR-011**: En `single` nada cambia (SC-001) y `/api/brains/*` es 404 vacío.

### Key Entities

- **BrainDeployment**: un contenedor de cerebro que atiende a N negocios.
- **Asignación**: `organization.brain_deployment_id` (0..1 por negocio).
- **BrainReply** (`brain_reply`): respuesta ya aceptada por despacho (idempotencia).
- **BrainOperation** (`brain_operation`): resultado de una operación de agenda
  por `idempotencyKey`.

## Success Criteria

- **SC-001**: Con `TENANCY` vacía, la suite completa y el cuerpo gemelo de la 021
  pasan sin cambiar ninguna expectativa.
- **SC-002**: Una Nea `multiorg` real en staging atiende dos negocios con
  despliegue compartido: contesta, mueve etapa, agenda, transcribe con la llave
  de cada uno, y ningún dato cruza (E2E `e2e-cerebro` + revisión de auditoría).
- **SC-003**: 100 % de los endpoints de `/api/brains/*` cubiertos por la matriz
  `A ↛ B` y por la prueba estática de guardia.
- **SC-004**: Los vectores gemelos son idénticos en ambos repos (CI rojo si
  divergen).

## Fuera de alcance (→ 071+)

- Anunciar `agenda_v2` (requiere recordatorios de citas reales en el CRM).
- Seguimiento de coordinación durable (`coordinationFollowupEnabled: true`).
- Ensayo `POST /vocero/ensayo` desde el CRM (D9); el Laboratorio sigue con
  conversaciones de prueba.
- Varios cerebros por negocio, cerebros de terceros o autoservicio del dueño.
