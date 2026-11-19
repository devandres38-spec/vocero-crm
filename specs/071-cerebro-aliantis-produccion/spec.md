# Feature Specification: Cerebro Aliantis — producción y chasis extensible

**Feature Branch**: `feat/071-cerebro-aliantis-produccion` (en `vocero-crm` y `nea-agent`, creadas desde `main`)
**Created**: 2026-11-18
**Status**: Aprobada (D1–D21, 2026-11-18) — en implementación
**Carril**: **Ciclo completo** (Principio VI): migración aditiva `0031_agente_trato`
en `vocero-crm`, migración aditiva `009_*` en `nea-agent`, crecimiento aditivo
del contrato publicado `/api/brains/context` y `/api/bot/profile`, y cambio
coordinado entre los dos repositorios.
**Constitución**: 2.0.0 (Principios I, II, III, IV, V, VI, IX, X, XI; Restricción
«Contratos entre repositorios»).
**Repos**: `nea-agent` (la mayor parte) · `vocero-crm` (contrato, migración, UI,
Blueprint, MCP, OpenAPI).
**Auditado contra**: `nea-agent@0663ffe` y `vocero-crm@fb402ae` (`main` tras la 070).
**Contrato**: [contracts/brains-071.md](contracts/brains-071.md) (delta sobre
[`070/contracts/brains.md`](../070-cerebro-multiorg/contracts/brains.md)).

## Problema

La 070 dejó una sola Nea `multiorg` atendiendo a todos los negocios. Funciona
en staging, pero no está lista para producción con clientes reales ni para
crecer:

1. **Un negocio ocupado atiende a una persona a la vez.** El worker de despacho
   tiene un solo consumidor y, además, la cola toma un *advisory lock de sesión
   por organización* que retiene una conexión del pool durante todo el turno
   (hasta 240 s). Cien clientes escribiéndole al mismo negocio se contestan en
   fila india.
2. **Hay estado compartido que solo es seguro porque hoy todo va en serie.**
   `BrainsCrmClient` (uno por organización) guarda en atributos de instancia el
   perfil, la configuración de IA y las capacidades del último contexto; el
   `AppContext` global se muta en cada turno (`agenda_enabled`); y la
   `SondaDeAgenda` es una sola para todos los negocios: un 404 de la agenda de
   uno apaga la de todos durante 60 s.
3. **Fugas de memoria y sockets.** Los diccionarios por conversación de
   `BrainsCrmClient` (`_conversaciones`, `_despachos`, `_envelopes`,
   `_precargado`) crecen sin fin; cada organización abre su propio
   `httpx.AsyncClient` y cada cambio de modelo abre un `AsyncOpenAI` nuevo que
   nunca se cierra.
4. **La base crece sin fin y guarda PII de más.** `dispatch_inbox` conserva el
   cuerpo del despacho (los mensajes del cliente, literales) para siempre;
   `processed_message` también.
5. **El reintento diferido no es seguro con varias réplicas** ni trata un
   `401/403` como terminal (reintenta 24 h contra el CRM).
6. **Bugs visibles al cliente final**: una imagen hace fallar el turno si el
   último mensaje del prompt es una alerta de sistema; un modelo sin visión
   produce 3 reintentos, silencio y handoff `error`.
7. **Marca y chasis**: defaults «Nea» visibles, un chasis que en cloud se
   reescribe con `.replace()` frágiles, sin registro de roles, sin trato
   (tú/usted), sin poder apagar el cierre por falta de rumbo, y una confirmación
   de cita que reemplaza por completo la voz del negocio.

## Objetivos

- **G1** — Turnos concurrentes y acotados, correctos con una o varias réplicas,
  dimensionados para el VPS inicial (4 vCPU / 7.8 GiB, compartido con Postgres
  16 y `aliantis-crm`).
- **G2** — Cero estado mutable compartido entre turnos; cero estado compartido
  entre organizaciones.
- **G3** — Memoria, sockets y tablas acotados en el tiempo.
- **G4** — Observabilidad mínima de producción sin filtrar secretos ni PII.
- **G5** — Marca blanca Aliantis hacia el cliente final y hacia lo público.
- **G6** — Chasis por secciones + registro de roles (solo el rol actual) +
  ajustes universales por negocio (`treatment`, `stallEnabled`), diseñado para
  que la 072 (Vertical Packs, `custom_fields`, herramientas dinámicas) lo
  extienda **sin reescribirlo**.

## No objetivos

- Roles de negocio nuevos (se diseñarán por nicho en la 072+).
- Herramientas dinámicas, `custom_fields`, Vertical Packs (072).
- Retención de `bot_message` (memoria conversacional; se borra por olvido).
- Billing, cuotas por negocio, autoescalado.
- Que el agente incluido del CRM (Laboratorio en `single`) lea `treatment`
  (ver D21).
- Cliente del CRM para `/vocero/ensayo` (sigue diferido desde la 070; aquí solo
  se endurece el lado de Nea).

## Hallazgos de la auditoría que cambian la propuesta inicial

| # | Hallazgo (código real) | Consecuencia en el diseño |
|---|---|---|
| H1 | La serialización real no es `conversation_lock` (in-process) sino `pg_try_advisory_lock` **por organización** en `PgDispatchStore.claim_dispatch`, con la conexión retenida durante todo el turno (`dispatch_store.py`). | Subir a N consumidores solo daría concurrencia **entre** organizaciones y necesitaría N conexiones ociosas. Se cambia a reclamo **por conversación con lease** (D1). |
| H2 | `BrainsCrmClient` cacheado por organización guarda `_perfil`, `_llm`, `supports_agenda_v2`, `supports_coordination` como atributos; `credenciales_llm()` lee «el último contexto» (`crm_brains.py`). El docstring de la cola lo admite: el lock por org «protege el envelope cacheado». | Con concurrencia dentro de un negocio esto es una carrera. Cliente **efímero por turno** sobre un transporte HTTP compartido (D3). |
| H3 | `ProfileProvider` en cloud **no** hace HTTP de más (desactiva su caché y lee `_perfil` en memoria), pero depende del estado compartido de H2. | En cloud el perfil se arma del contexto del turno; `ProfileProvider` queda para `single` (D3). |
| H4 | `run_turn` muta `ctx.agenda_enabled` y `_sin_agenda` muta el contexto y la sonda; en `single`/cloud de un negocio `ctx_turno is ctx` (global). | El `AppContext` se copia **siempre** por turno (D3). Pruebas que miran el `ctx` global tras el turno se ajustan. |
| H5 | En `multiorg` la sonda global pregunta con `CrmSinOrganizacion` (siempre «sí»), así que solo cambia por `marcar_apagada()` de **cualquier** negocio. | El CRM ya sabe si la agenda está activa por negocio (`modulosDeOrganizacion`); se publica en el contexto y la sonda por organización queda de respaldo (D5). |
| H6 | `FOR UPDATE SKIP LOCKED` en un `SELECT` suelto por `pool.fetch` (autocommit) libera el candado al terminar la sentencia. | Añadirlo a `due_pending_sends` no evita duplicados. Reclamo por **lease** con `UPDATE … RETURNING` (D6). |
| H7 | `CrmRechazo` hereda de `CrmError`; el `SenderWorker` lo atrapa como error transitorio y reintenta 24 h. | Rama terminal propia antes de `CrmError` (D6). |
| H8 | `relay_queue` la crea `001` y la altera `007` en **cada arranque** (todas las migraciones se re-ejecutan) y `test_pg_store.py` la exige. | Un `DROP` la recrearía en el siguiente arranque. Se deja en paz y se documenta como legado (D7). |
| H9 | Las migraciones se re-ejecutan al arrancar sin candado: dos réplicas a la vez pueden chocar en `CREATE INDEX`. | `migrate()` bajo `pg_advisory_lock` (D7). |
| H10 | El cliente por org fija `X-Vocero-Organization: <slug>` al crearse; si el negocio cambia de slug, Nea sigue mandando el viejo hasta reiniciar → 401 → `CrmRechazo` terminal → negocio mudo. | La cabecera lleva el **id** (el CRM acepta slug o id) (D4). |
| H11 | `salud.ts` del CRM lee como mucho 4 KB y hace `JSON.parse`: un `/health` de más de 4 KB deja de verse como `multiorg`. | Métricas compactas, presupuesto < 1 KB (D9). |
| H12 | vocero-crm **no** llama a `/vocero/ensayo` (diferido en la 070). | Semáforo y tope sí (la ruta existe y acepta firma), pero sin bloquear nada del CRM (D11). |
| H13 | El CRM ya quita el formato en redes al enviar (`src/lib/social-text.ts`, spec 024). | El texto plano en Nea es defensa en profundidad y coherencia del historial, no un arreglo urgente (D18). |
| H14 | `finalize_reply` no «verifica»: **sustituye** la respuesta entera por una plantilla con «tu» fijo. | Guardarraíl de tres salidas (D17), con el trato del negocio. |
| H15 | El CRM ya tiene un registro de roles como datos (`src/lib/agent-roles.ts`, `ROLES.calificador`) cuya clave viaja en `profile.role`; Nea la parsea y la ignora. | El registro de Nea se indexa por **esa misma clave**; clave desconocida → `calificador`, igual que `rolDe()` del CRM (D14). |
| H16 | `profile.cloud` no es «un rol»: es la superficie. Hoy activa el enfoque «resolver y agendar» y la línea de cancelar (que en realidad depende de `agenda_v2`). | El refactor separa **enfoque** (del rol) de **capacidad** (`agenda_v2`) con pruebas doradas byte a byte (D14). |
| H17 | `update_ficha` tiene el esquema B2B fijo (`rubro`, `tamano_aprox`, `sistemas`…). | Se aísla en una función-punto-de-enchufe para que la 072 la derive de `custom_fields` (D20). |
| H18 | Marcadores multimedia en femenino («Sé honesta»): con el nombre neutro «Asistente» el género queda raro. | Redacción sin género (D13). |

## Historias de usuario

### US1 — Un negocio con muchos clientes a la vez (P1)
Como dueño de un negocio con picos de mensajes, quiero que mi agente conteste a
varios clientes en paralelo, sin que uno espere a que termine la conversación
de otro, y sin que dos mensajes del mismo cliente se pisen.

**Aceptación**
1. Con `DISPATCH_CONCURRENCY=8`, 8 conversaciones de **un mismo** negocio
   avanzan a la vez (prueba con LLM falso que tarda).
2. Dos despachos de la **misma** conversación nunca corren a la vez, ni en una
   réplica ni en dos (prueba con Postgres en CI).
3. El orden dentro de una conversación se conserva (el más viejo primero),
   incluido el evento `conversation.deleted`.
4. Un negocio no puede ocupar más de `DISPATCH_MAX_POR_ORG` consumidores.
5. Un turno interrumpido **nunca** se repite: tras vencer el lease se pasa a
   humano (comportamiento actual, sin cambio).

### US2 — Aislamiento total entre turnos y negocios (P1)
Como plataforma, quiero que nada de un turno (perfil, credenciales de IA,
capacidades, agenda) pueda leerlo otro turno, y menos de otro negocio.

**Aceptación**
1. Dos turnos concurrentes del mismo negocio con contextos distintos ven cada
   uno el suyo (prueba que intercala `await`s).
2. Un 404 de agenda en el negocio A no cambia la agenda de B.
3. No queda ningún diccionario por conversación que crezca sin fin.
4. Un cambio de slug del negocio no rompe a Nea (la cabecera lleva el id).

### US3 — Producción que no se degrada con el tiempo (P1)
Como operador, quiero memoria, sockets y tablas acotados, y colas visibles.

**Aceptación**
1. Un solo pool HTTP hacia el CRM, con límites; ningún cliente HTTP por
   organización.
2. `dispatch_inbox` (`done`) y `processed_message` se purgan pasado
   `RETENTION_DAYS` (14 por defecto) en lotes, sin bloquear el despacho.
3. `/health` enseña `queues` sin cambiar su código HTTP ni pasar de 1 KB.
4. Logs JSON con `org`, `dispatch` y `conversation` en cada línea del turno;
   ningún secreto, y teléfonos enmascarados.
5. `/docs`, `/redoc` y `/openapi.json` devuelven 404 salvo `NEA_DOCS=1`.

### US4 — Envío diferido correcto (P2)
**Aceptación**
1. Dos réplicas no entregan dos veces la misma fila de `pending_send`.
2. Un `401/403` del CRM abandona la fila en el acto, sin handoff ni reintento.

### US5 — Multimedia y modelos sin visión (P2)
**Aceptación**
1. Una imagen con una alerta de hostilidad o de cierre en el mismo turno se
   adjunta al último mensaje `user`, nunca a uno `system`.
2. Con un modelo sin visión, el turno contesta con honestidad («no puedo ver
   imágenes por aquí, ¿me cuentas qué muestra?»), sin handoff `error`, con a
   lo sumo una llamada extra; las siguientes imágenes de ese modelo ni se
   intentan.

### US6 — Marca blanca Aliantis (P2)
**Aceptación**
1. Ningún texto que llegue al cliente final o a una respuesta pública dice
   «Nea» ni «Vocero» (barrido con prueba).
2. Rutas, cabeceras y dominios del contrato intactos (`/vocero/dispatch`,
   `/vocero/ensayo`, `x-vocero-signature`, `X-Vocero-Organization`,
   `vocero:cerebro:v1`).

### US7 — Ajustes universales por negocio (P1)
Como dueño, quiero elegir cómo trata mi agente a los clientes (tú, usted,
neutro), poder apagar el cierre automático por falta de rumbo y que la
confirmación de cita salga con la voz de mi negocio.

**Aceptación**
1. `treatment` y `stallEnabled` se editan en Ajustes → Agente, en el
   formulario de `/platform`, por Blueprint y MCP, y llegan a Nea por
   `/api/brains/context` y `/api/bot/profile`.
2. Con `usted`, el prompt y los textos deterministas (confirmación de cita)
   usan usted; con `neutro`, evitan el tuteo y el ustedeo.
3. Si el cliente escribe en otro idioma, el agente le contesta en ese idioma.
4. Con `stallEnabled=false` el agente nunca se despide por falta de rumbo ni
   calla rellenos tras un cierre previo.
5. La confirmación de cita conserva el texto del modelo cuando trae la fecha,
   la hora y el enlace correctos; añade un pie discreto si falta alguno; y cae
   a la plantilla determinista si el texto contradice la cita.
6. En Instagram, Messenger y TikTok el texto sale sin marcas de formato.

### US8 — Chasis listo para roles (P2)
Como equipo, queremos añadir un rol (o un nicho) declarándolo en un registro,
sin tocar el turno ni reescribir el prompt.

**Aceptación**
1. El prompt de hoy sale **idéntico byte a byte** (pruebas doradas para
   `single` y para `cloud`) tras el refactor, con `treatment=tu` y
   `stallEnabled=true`. Las únicas diferencias aprobadas son las nuevas líneas
   de idioma/trato (D15), cubiertas por su propia prueba dorada.
2. `ROLES` tiene una entrada (`calificador`) con: sección de misión, enfoque,
   política de `sin_rumbo` y herramientas permitidas. Una clave desconocida cae
   a `calificador`.
3. Una herramienta es un `ToolSpec` registrado (nombre, clave del catálogo del
   CRM, esquema, ejecución, disponibilidad); `ToolRuntime.execute` despacha por
   registro, no por `if name == …`.

## Requisitos funcionales

- **FR-001** El despacho corre hasta `DISPATCH_CONCURRENCY` turnos a la vez por
  proceso (default 8), serializados **por (organización, conversación)** en
  Postgres mediante lease, sin locks de sesión ni conexiones retenidas.
- **FR-002** Ningún negocio ocupa más de `DISPATCH_MAX_POR_ORG` turnos a la vez
  por réplica (default 3).
- **FR-003** El pool `asyncpg` se dimensiona `DISPATCH_CONCURRENCY + 4`
  (override `DB_POOL_MAX`, mínimo 4).
- **FR-004** Cada turno trabaja con su propia copia de `AppContext` y su propio
  cliente del CRM; los clientes comparten **un** `httpx.AsyncClient` hacia el
  CRM (también el SDK de OpenAI en `multiorg`, vía `http_client`).
- **FR-005** `X-Vocero-Organization` lleva el `organization.id` en `multiorg`.
- **FR-006** La agenda por negocio sale de `agent.agendaEnabled` del contexto
  cuando viene; si no (CRM 2.10), de una sonda **por organización**.
- **FR-007** `SenderWorker` reclama filas por lease (`UPDATE … WHERE id IN
  (SELECT … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *`); `CrmRechazo` →
  abandonada, sin handoff.
- **FR-008** Worker de mantenimiento: cada hora, purga en lotes de 1 000 filas
  `dispatch_inbox` `done` y `processed_message` más viejas que
  `RETENTION_DAYS` (default 14, mínimo 2) y `pending_send` cerradas más viejas
  que `PENDING_RETENTION_DAYS` (default 30); una sola réplica purga a la vez
  (`pg_try_advisory_xact_lock`).
- **FR-009** `migrate()` corre bajo `pg_advisory_lock` de sesión.
- **FR-010** Las imágenes se adjuntan al último mensaje `role:"user"`.
- **FR-011** Error de «modelo sin imágenes» → `ImagenNoSoportada` sin
  reintentos; el turno quita las imágenes, deja un marcador honesto y reintenta
  una vez; el cliente LLM recuerda que no ve.
- **FR-012** `LOG_FORMAT=json|text` (default `json` en cloud, `text` en
  `single`); `contextvars` con `org`, `dispatch`, `conversation`; filtro que
  enmascara secuencias de ≥ 8 dígitos (deja los 4 últimos).
- **FR-013** `/health` añade `queues: {inboxPending, inboxStarted,
  pendingSends, oldestInboxSeconds}`, con su propia consulta de ≤ 1 s; si falla,
  `queues: null`; el código HTTP lo sigue decidiendo solo `ping()`.
- **FR-014** `POST /vocero/ensayo`: `ENSAYO_CONCURRENCY` (default 2) → si no hay
  hueco, 429 `{"error":"ocupado"}`; tope `ENSAYO_TIMEOUT_SECONDS` (default 120) →
  200 `{"ok":false,"error":"tiempo_agotado","turns":[…parciales]}`.
- **FR-015** FastAPI sin `/docs`, `/redoc`, `/openapi.json` salvo `NEA_DOCS=1`.
- **FR-016** Marca: `AGENT_NAME` default `"Asistente"`; título «Aliantis —
  cerebro conversacional»; 503 de `webhook_retirado` sin marca; marcadores
  multimedia sin género.
- **FR-017** Chasis por secciones; `ROLES` con `calificador`; `ToolSpec`.
- **FR-018** `treatment ∈ {tu, usted, neutro}` (default `tu`; valor desconocido
  → `tu`) y regla de idioma.
- **FR-019** `stallEnabled` (default `true`; ausente → `true`).
- **FR-020** Guardarraíl de confirmación (book **y** reschedule) con trato.
- **FR-021** `a_whatsapp` solo con `channel == "whatsapp"` (o sin canal, como
  hoy); texto plano gemelo de `plainSocialText` en el resto;
  `CORRIGE_RESPUESTA` sin «WhatsApp».
- **FR-022** CRM: columnas `agent_profile.treatment`, `agent_profile.stall_enabled`;
  `serializeBotProfile` los publica (ambas superficies);
  `contextoDelCerebro` añade `agent.agendaEnabled`; UI, Blueprint (idempotente),
  catálogo/MCP y OpenAPI.

## Criterios de éxito

- **SC-001** pytest: los 567 actuales pasan (con los ajustes explícitos listados
  en el plan, §Riesgos R4) + las nuevas; Vitest: los 1 996 actuales + los
  nuevos, `--maxWorkers=1 --no-file-parallelism`.
- **SC-002** Pruebas doradas del prompt idénticas (D14).
- **SC-003** Job `postgres` de CI: reclamo por conversación probado con dos
  conexiones (dos «réplicas») y con orden.
- **SC-004** Staging: 30 conversaciones simultáneas de un negocio de prueba
  contestadas sin duplicados, con RSS de Nea < 600 MiB y `pg_stat_activity` de
  Nea ≤ `DB_POOL_MAX`.
- **SC-005** `/health` < 1 KB y `salud.ts` sigue viendo `mode: multiorg`.
- **SC-006** Un `OrganizationBlueprint` aplicado dos veces con `treatment` y
  `stallEnabled` informa «sin cambios» la segunda.

## Supuestos

- Una réplica de Nea con 1 worker de uvicorn en producción inicial; el diseño
  admite varias réplicas sin cambios.
- El CRM acepta `X-Vocero-Organization` con slug **o** id (070 T010/T011).
- Se despliega en cualquier orden: Nea tolera la ausencia de los campos nuevos y
  el CRM no depende de nada nuevo de Nea.

## Decisiones

Ver la tabla D1–D21 en [plan.md](plan.md#decisiones-técnicas-para-aprobar).
