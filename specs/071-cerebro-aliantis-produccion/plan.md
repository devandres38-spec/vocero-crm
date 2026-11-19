# Implementation Plan: Cerebro Aliantis — producción y chasis extensible

**Spec**: [spec.md](spec.md) · **Contrato**: [contracts/brains-071.md](contracts/brains-071.md)
**Estado**: 📝 pendiente de aprobación de D1–D21. Sin código.

## Contexto técnico

| | `nea-agent` | `vocero-crm` |
|---|---|---|
| Runtime | Python 3.11, FastAPI, asyncio, 1 worker uvicorn | Next.js 15, Drizzle, `postgres-js` (`max: 10`) |
| Base | asyncpg, pool hoy `min 1 / max 5`, migraciones SQL re-ejecutadas en cada arranque | migraciones Drizzle al arrancar |
| Pruebas | pytest: 567 (job `postgres` en CI para `test_pg_store.py`) | Vitest: 1 996 |
| Local (PC de gama baja) | `pytest` | `typecheck`, `lint`, `vitest --maxWorkers=1 --no-file-parallelism` |
| CI/staging | job `postgres` de pytest, imagen | `next build`, E2E, smoke de cerebro |

**Nodo de producción inicial**: 4 vCPU / 7.8 GiB; Coolify + Postgres 16 +
`aliantis-crm` + `aliantis-nea`.

## Dimensionamiento (VPS 4 vCPU / 7.8 GiB)

Nea es casi todo espera de E/S: un turno pasa 2–20 s esperando al modelo y
hace 5–10 llamadas al CRM. La CPU no es el límite; lo son la memoria por turno,
las conexiones a Postgres y la presión sobre el CRM (pool de 10).

| Recurso | Cálculo | Default propuesto |
|---|---|---|
| Turnos en vuelo por réplica | 8 × (prompt ~50 KB + hasta 2 imágenes en base64 ~16 MB en el peor caso) ≈ 130 MB pico | `DISPATCH_CONCURRENCY=8` |
| Turnos por negocio | Evita que un negocio con una ráfaga (o una llave BYOK con *rate limit*) acapare la réplica | `DISPATCH_MAX_POR_ORG=3` |
| Pool asyncpg | 8 turnos (consultas cortas; el reclamo **ya no** retiene conexión) + sender + mantenimiento + `/health` + `/vocero/dispatch` | `DB_POOL_MAX = concurrency + 4 = 12`, `min 2` |
| Conexiones Postgres totales | CRM 10 + Nea 12 + Coolify/psql ~5 ≈ 27 de 100 | sin cambio en Postgres |
| PDFs | subproceso con `RLIMIT_AS` 256 MB; 2 a la vez = 512 MB peor caso | semáforo **2** (se queda) |
| Ensayos | 12 turnos × hasta 5 rondas cada uno; solo por el dueño | `ENSAYO_CONCURRENCY=2`, `ENSAYO_TIMEOUT_SECONDS=120` |
| Pool HTTP al CRM | 8 turnos × ~2 llamadas solapadas + LLM proxy | `httpx.Limits(max_connections=32, max_keepalive_connections=16)` |
| Límite del contenedor | RSS esperado 250–450 MB | recomendar `mem_limit` 1 GiB en Coolify |

**Escalar después**: con el reclamo por lease (D1), una segunda réplica es solo
otro contenedor. Más de 2 réplicas o `DISPATCH_CONCURRENCY` > 12 piden antes
medir el pool del CRM (`max: 10`), que será el cuello: queda como riesgo R7.

## Decisiones técnicas (para aprobar)

| ID | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **D1** | Reclamo **por (organización, conversación) con lease** en `dispatch_inbox`: `UPDATE … RETURNING` sobre el más viejo no terminado de cada conversación que no tenga un `started` vivo; sin `pg_advisory_lock` de sesión y sin retener la conexión durante el turno. `heartbeat`/`finish` por el pool con *owner fencing*. | (a) Mantener el lock por org y subir a N consumidores. (b) Lock in-process `(org, identity)`. | (a) solo da concurrencia **entre** negocios y ata N conexiones ociosas; (b) no protege entre réplicas. El lease ya existe (3 min + heartbeat 20 s): solo cambia la unidad. |
| **D2** | `DISPATCH_CONCURRENCY=8`, `DISPATCH_MAX_POR_ORG=3`, `DB_POOL_MAX=concurrency+4`. N tareas consumidoras + `dispatch_wake` como aviso y sondeo de 2 s de respaldo. | Default 4 o 16. | 8 cabe con holgura en memoria y conexiones (tabla de arriba); 16 presionaría el pool de 10 del CRM. |
| **D3** | **Estado por turno**: `AppContext` copiado siempre (`replace`), `BrainsCrmClient` **efímero por turno** sobre **un** `httpx.AsyncClient` compartido (y `AsyncOpenAI(http_client=…)` compartido en `multiorg`); en cloud el `BusinessProfile` se arma del contexto del turno (`PerfilDelTurno`), `ProfileProvider` solo en `single`. El registro guarda solo objetos ligeros (LLM por clave) en una LRU de 256 sin cerrar transporte. | LRU/TTL de clientes por organización con `aclose()` al desalojar. | Cerrar un cliente desalojado mientras otro turno lo usa rompe ese turno; con transporte compartido no hay nada que cerrar. Mata de raíz H2, H3, H4 y las fugas de diccionarios. |
| **D4** | `X-Vocero-Organization` = `organization.id` en `multiorg` (y en filas de `pending_send`). | Refrescar el slug. | El CRM acepta id (070 T010); un worker que despierta horas después de un cambio de slug ya no queda mudo. |
| **D5** | Agenda por negocio: el CRM añade `agent.agendaEnabled` (= `modulosDeOrganizacion(org).agenda`) al contexto; Nea lo usa si viene y, si no (CRM 2.10), una `SondaDeAgenda` **por organización** en el registro. `_sin_agenda` apaga solo la del negocio. `single` sin cambios. | Solo la sonda por organización (propuesta inicial). | La sonda pregunta con `cv_sonda` (404 ruidosos, cuenta para el límite) y su TTL es estado; el dato ya existe en el CRM y es una línea aditiva. La sonda queda para compatibilidad. |
| **D6** | `SenderWorker`: reclamo por lease (`UPDATE pending_send SET next_retry_at = now()+'2 min' WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 50) RETURNING *`); `CrmRechazo` antes que `CrmError` → abandonada, sin handoff. | `FOR UPDATE SKIP LOCKED` en el `SELECT`. | En autocommit el candado muere con la sentencia (H6). |
| **D7** | `MantenimientoWorker` horario con `pg_try_advisory_xact_lock`: lotes de 1 000 por `ctid`; `RETENTION_DAYS=14` (mín. 2) para `dispatch_inbox` `done` y `processed_message`; `PENDING_RETENTION_DAYS=30` para `pending_send` cerradas. Migración `009_retencion.sql`: índices `processed_message(processed_at)`, `dispatch_inbox(organization_id, conversation_id, created_at) WHERE state<>'done'`, `dispatch_inbox(updated_at) WHERE state='done'`. `migrate()` bajo `pg_advisory_lock`. `relay_queue` **no se toca**. | `DROP TABLE relay_queue`; purga con `DELETE` masivo. | `001`/`007` la recrean al arrancar (H8). Lotes pequeños no bloquean al despacho. 14 días ≫ ventana de reintento del CRM (24 h). |
| **D8** | Logs: `LOG_FORMAT=json` por defecto en cloud (`text` en `single`), formateador **stdlib** (sin dependencia nueva, Principio II); `contextvars` `org` (id+slug), `dispatch`, `conversation` (ids del CRM, no PII); filtro `EnmascararDigitos` (≥ 8 dígitos → `***1234`) en todos los handlers, además de `SinTokenPropio`. | `structlog`/`python-json-logger`; reescribir cada `logger.*`. | Cero dependencias; los mensajes existentes llevan la identidad en texto y el filtro la enmascara sin tocar 200 líneas. |
| **D9** | `/health` + `queues {inboxPending, inboxStarted, pendingSends, oldestInboxSeconds}` con `asyncio.timeout(1)`; error → `queues: null`; status lo decide solo `ping()`. Presupuesto < 1 KB con prueba. | Endpoint `/metrics` Prometheus. | Lo lee el CRM (4 KB, H11) y el operador; Prometheus es otra pieza que no hay en el nodo. |
| **D10** | `/docs`, `/redoc`, `/openapi.json` apagados en **todos** los modos; `NEA_DOCS=1` los enciende. | Apagar solo en cloud. | Nadie los usa (grep), y el contrato normativo vive en el CRM. |
| **D11** | Ensayo: semáforo por réplica sin espera (429 `ocupado`), tope global 120 s → 200 `ok:false, tiempo_agotado` con los turnos ya hechos. | Encolar ensayos. | No hay nada que entregar después; el CRM aún no lo llama (H12). |
| **D12** | Imágenes al último `role:"user"`. `OpenAiLlm.complete` reconoce el error de «sin entrada de imagen» (OpenRouter: *No endpoints found that support image input*; OpenAI: *image_url is only supported by certain models*) → `ImagenNoSoportada` sin reintentar; `_vision_ok=False` pegajoso por cliente; el turno reemplaza la imagen por un marcador honesto y reintenta **una** vez. | Consultar capacidades del modelo a OpenRouter. | Una llamada más por turno y otra dependencia; el error es explícito y barato de reconocer. |
| **D13** | Marca: `AGENT_NAME="Asistente"` (igual que el default de `agent_profile.name`); título FastAPI «Aliantis — cerebro conversacional»; `webhook_retirado` responde `{"error":"webhook_retirado"}` sin marca; marcadores multimedia sin género. Los logs internos y los identificadores `vocero*` se quedan. | Renombrar módulos o rutas. | Principio X/2.3 del ROADMAP: solo lo visible. |
| **D14** | Chasis en **secciones** (`identidad`, `voz`, `mision`, `conversacion`, `agendar`, `salida`, `handoff`, `blindaje`, `herramientas`, `nunca`, `multimedia`, `prioridad`) + `RolSpec` en `app/roles.py`: `ROLES = {"calificador": RolSpec(...)}` con `mision(enfoque)`, `politica_sin_rumbo`, `herramientas: frozenset[str] \| None`. El `.replace()` de cloud se convierte en `enfoque="atender_y_agendar"` (hoy: `profile.cloud`) y la línea de cancelar pasa a depender de `agenda_v2`. Pruebas doradas byte a byte **antes** del refactor. | Prompt-por-rol completo; plantillas Jinja. | Sin dependencia nueva; un rol nuevo = una entrada; el texto actual queda congelado por prueba. |
| **D15** | `treatment` en la sección `voz`: `tu` → texto actual; `usted` → «de "usted", cordial»; `neutro` → «sin tutear ni ustedear: frases impersonales». Regla nueva para todos: «Si la persona escribe en otro idioma, contéstale en ese idioma». | Hacer la regla de idioma configurable. | Es universal y sobria; cambia el prompt de forma deliberada (prueba dorada propia). |
| **D16** | `stallEnabled=false` apaga `sin_rumbo` **y** la puerta 1.5 (silencio a rellenos tras cierre). Umbrales `STALL_*` siguen siendo de instancia. `RolSpec.politica_sin_rumbo` permite que un rol futuro lo desactive por defecto. | Solo apagar el disparador. | Si no, un negocio que lo apaga sigue viendo 24 h de silencio en conversaciones cerradas antes. |
| **D17** | Confirmación (book **y** reschedule), guardarraíl de 3 salidas sobre el texto del modelo normalizado (minúsculas, sin acentos): **ok** si trae día del mes + mes (o «hoy»/«mañana» cuando aplica), la hora en alguna forma (`10:30`, `10.30`, `10 am`, `10 de la mañana`) y el enlace si existe → se envía tal cual; **pie** si falta algo → se añade una línea `📅 {label}` (+ enlace si falta); **contradicción** si trae otra hora `HH:MM` u otro día del mes junto al mes → plantilla determinista actual con el trato del negocio. | Dejar la plantilla; confiar en el modelo. | La plantilla borra la voz del negocio; confiar a ciegas ya produjo fechas equivocadas (incidentes en `prompt.py`). |
| **D18** | `a_whatsapp` solo con canal `whatsapp` o sin canal; en el resto `a_texto_plano = quitar_marcas(a_whatsapp(t))`, gemelo de `plainSocialText` (vectores compartidos en prueba de ambos repos). `CORRIGE_RESPUESTA` usa «el mensaje». | Confiar solo en el CRM. | El CRM ya lo hace al enviar (H13), pero el historial de Nea y la detección de repetidos comparan el texto de Nea. |
| **D19** | CRM: migración `0031_agente_trato` (`treatment text NOT NULL DEFAULT 'tu' CHECK (…)`, `stall_enabled boolean NOT NULL DEFAULT true`; *metadata-only* en PG 16); `serializeBotProfile` publica `treatment` y `stallEnabled` (llega a `/api/bot/profile` **y** `/api/brains/context`); `contextoDelCerebro` añade `agendaEnabled`; versión 2.11.0. | Solo en `/api/brains`. | `serializeBotProfile` es el punto único; una Nea `single` también los recibe. |
| **D20** | Compatibilidad con la 072: (1) `ToolSpec` + registro (`app/herramientas/registro.py`), `execute` despacha por registro; (2) `esquema_de_ficha(context)` devuelve hoy el esquema B2B fijo; (3) Nea ignora claves desconocidas del contexto y **no** se sube `contextVersion` por cambios aditivos; (4) herramientas efectivas = `rol.herramientas ∩ profile.tools ∩ capacidades`; (5) se documenta en el contrato que la 072 añadirá `tools[]` (top-level) y `contact.customFields` sin tocar lo de la 071. | Implementar ya `customTools`. | La 072 enchufa un proveedor de `ToolSpec` dinámicos y un esquema de ficha derivado, sin tocar el turno, el prompt ni `/context` de la 071. |
| **D21** | El agente incluido del CRM / Laboratorio en `single` **no** lee `treatment` en la 071. | Aplicarlo también ahí. | Es otro motor (in-process); se registra como seguimiento para no abrir un tercer frente. |

## Diseño por bloque

### A1 — Reclamo por conversación (D1)

```sql
-- claim: un turno a la vez por (org, conversación), FIFO, tope por org.
WITH candidata AS (
  SELECT d.organization_id, d.dispatch_id, d.state AS previo
  FROM dispatch_inbox d
  WHERE d.state <> 'done' AND d.available_at <= now()
    AND NOT EXISTS (                       -- el más viejo de su conversación
      SELECT 1 FROM dispatch_inbox o
      WHERE o.organization_id = d.organization_id
        AND o.conversation_id = d.conversation_id
        AND o.state <> 'done' AND o.created_at < d.created_at)
    AND NOT EXISTS (                       -- nadie la atiende ahora
      SELECT 1 FROM dispatch_inbox s
      WHERE s.organization_id = d.organization_id
        AND s.conversation_id = d.conversation_id
        AND s.state = 'started' AND s.available_at > now())
    AND d.organization_id <> ALL($2::text[])   -- orgs al tope en esta réplica
  ORDER BY d.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1)
UPDATE dispatch_inbox t
SET state = 'started', owner = $1,
    available_at = now() + interval '3 minutes', updated_at = now()
FROM candidata c
WHERE t.organization_id = c.organization_id AND t.dispatch_id = c.dispatch_id
RETURNING t.payload, (c.previo <> 'queued') AS recovery;
```

- `recovery` sale del estado **previo** (columna `previo` de la CTE): una fila
  que ya estaba `started` con lease vencido se recupera con handoff, nunca se
  repite.
- La regla «el más viejo no terminado» serializa la conversación aunque dos
  réplicas lean a la vez: la fila más joven queda excluida mientras la vieja
  exista, esté `queued`, `started` o con lease vencido.
- El tope por org es **por réplica** (contador en memoria); entre réplicas el
  techo efectivo es `réplicas × DISPATCH_MAX_POR_ORG`, aceptable.
- `MemoryDispatchStore` replica la misma semántica (para las pruebas sin PG).
- `conversation_lock` (in-process) pasa a clave `(org_id, identity)` y queda
  para seguimiento (`single`) y olvido.

### A2 — Estado por turno (D3, D4)

- `RegistroDeOrganizaciones` crea un `httpx.AsyncClient(base_url=CRM, limits,
  timeout)` único; `cliente_del_turno(org_id, slug)` devuelve un
  `BrainsCrmClient(…, client=compartido, propietario=False)` nuevo: su
  `aclose()` no cierra el transporte. Cabeceras por petición.
- `_contexto_multiorg` arma `replace(ctx, crm=cliente_del_turno, llm=registro.llm(…),
  profile=PerfilDelTurno(profile_from_payload(_perfil_desde_contexto(contexto))),
  agenda_sonda=registro.sonda(org) | None, organizacion=…)`.
- Cloud de un negocio: mismo camino con un registro de una sola organización.
- `single` (raíz): `replace(ctx)` por turno; `ProfileProvider` y la sonda global
  siguen igual.
- `ctx_de_organizacion` (sender/seguimiento) usa `cliente_del_turno`.
- Ensayo: conserva su cliente propio (lleva la ficha) y deja de cerrar
  `llm._client` si es compartido.

### A3–A6

Ver tareas: sender (D6), mantenimiento y migración `009` (D7), agenda (D5),
visión (D12), logs (D8), `/health` (D9), docs (D10), ensayo (D11).

### B — Chasis, roles y ajustes

```text
app/
  roles.py            RolSpec, ROLES, rol_de(clave)
  chasis/             secciones.py (texto actual troceado), armar.py (build)
  herramientas/       registro.py (ToolSpec), builtin.py (las 10 de hoy)
  confirmacion.py     guardarraíl D17
  formato.py          + a_texto_plano, formatear_para(canal)
```

`BusinessProfile` gana `treatment: str = "tu"`, `stall_enabled: bool = True`,
`agenda_enabled: bool | None = None` (del contexto). `build_system_prompt` firma
igual (más `treatment` implícito en el perfil).

### C — vocero-crm

| Pieza | Archivo |
|---|---|
| Migración | `drizzle/0031_agente_trato.sql` + `schema.ts` (`agentProfile.treatment`, `stallEnabled`) + journal |
| Catálogo de tratos | `src/lib/agent-roles.ts`: `TRATOS = ["tu","usted","neutro"]` con etiquetas |
| Contrato | `src/server/bot/profile.ts` (`serializeBotProfile`), `src/server/brains/context.ts` (`agendaEnabled`) |
| API UI | `src/app/api/agent/profile/route.ts` (GET/PUT con Zod) |
| UI | `src/components/agent/agent-client.tsx` (selector Trato + interruptor «Cerrar conversaciones sin rumbo») |
| Plataforma | `src/lib/platform/blueprint.ts` (`agentSchema`), `secciones/agente.ts` (`CAMPOS`), `exportar.ts`, `src/lib/platform/formulario-blueprint.ts`, `src/components/plataforma/formulario/pestana-agente.tsx`, `src/server/platform/catalogo.ts` (`agent.treatments`) |
| OpenAPI | `docs/openapi.json` (profile), `docs/openapi-brains.json` (context), `docs/openapi-platform.json` (Blueprint) |

## Orden de despliegue

Cualquiera. Nea sin los campos nuevos usa los defaults (`tu`, `true`, sonda);
el CRM 2.11 no necesita nada nuevo de Nea. Recomendado: CRM primero (para que
`agendaEnabled` exista cuando Nea arranque con D5).

## Riesgos

| ID | Riesgo | Mitigación |
|---|---|---|
| R1 | La SQL de D1 tiene un hueco de concurrencia que MemoryStore no ve. | Pruebas en el job `postgres` de CI con dos conexiones y orden; no se marca hecho sin él (SC-003). |
| R2 | Refactor del chasis cambia el texto sin querer. | Doradas antes de tocar (T-B01); diff byte a byte. |
| R3 | Guardarraíl de D17 con falsos «contradicción» (p. ej. el modelo menciona el horario de atención «abrimos 9:00»). | Contradicción solo si la otra hora va en la misma oración que el mes/día de la cita; si no, pie. Banco de 30 casos reales en prueba. |
| R4 | Pruebas que asumen estado global: `test_agenda_404.py` (l. 132–152) y `test_agenda_sonda.py` miran `ctx.agenda_enabled` tras el turno; pruebas que esperan `"Nea"` por defecto (`test_profile.py`, `test_roles.py`, `test_configuration_209.py`); `test_tools.py` espera la plantilla «Listo, tu cita…». | Se reescriben para mirar la sonda o el perfil del turno; lista cerrada en tasks (T-A08, T-B10). Ninguna otra expectativa cambia. |
| R5 | JSON logs rompen el filtro `SinTokenPropio` o `test_logs_sin_token.py`. | Ambos filtros corren antes del formateador; la prueba se amplía a JSON. |
| R6 | Desalojo de LRU del LLM mientras un turno lo usa. | Las instancias no se cierran (transporte compartido); el desalojo solo suelta la referencia. |
| R7 | El pool del CRM (`max: 10`) satura con 8 turnos + UI. | Medir en staging (SC-004); si satura, bajar `DISPATCH_CONCURRENCY` sin desplegar y abrir una spec para `DATABASE_POOL_MAX` en el CRM. |
| R8 | Índices de `009` en tablas grandes bloquean escrituras al arrancar. | Hoy son pequeñas (lanzamiento reciente); `CREATE INDEX IF NOT EXISTS` normal. Si en staging `processed_message` > 1 M filas, crear el índice a mano `CONCURRENTLY` antes. |
| R9 | `X-Vocero-Organization` con id no aceptado por alguna ruta. | Prueba gemela en el CRM: todas las rutas `/api/brains/*` aceptan id (ya cubierto por T011 de la 070; se añade un caso explícito). |
