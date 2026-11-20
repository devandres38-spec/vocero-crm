# Feature Specification: Base de Conocimiento de Producción, «Probar mi agente», Observabilidad BYOK y Laboratorio v2

**Feature Branch**: `feat/074-kb-playground-observabilidad` (en `vocero-crm` y `nea-agent`, creadas desde `main` tras 2.14.0)
**Created**: 2026-11-20
**Status**: En implementación (bloques 1–4 de la petición del 2026-11-20), sin merge a `main`
**Carril**: **Ciclo completo** (Principio VI): migración aditiva y re-ejecutable `0038_kb_produccion`, crecimiento aditivo de `/api/brains/context` y de la superficie del cerebro (ficha de ensayo), y un cambio coordinado entre los dos repositorios.
**Constitución**: 2.0.0 (Principios I, III, IV, V, VI, IX, X, XI; restricción «Contratos entre repositorios»).
**Repos**: `vocero-crm` · `nea-agent`.
**Auditado contra**: `vocero-crm@af433fe` y `nea-agent@5c5c1fa` (`main` con 2.14.0).
**Insumo**: `../DIAGNOSTICO-BOT-COLOMBIA-KB.md` §4 (y P-10), decisiones aprobadas D8, D9, D10 y respuesta de producto #9 de la serie 073.
**Contrato**: [contracts/brains-074.md](contracts/brains-074.md).
**Versión**: se numera **2.15.0** al cerrar tras la auditoría (CHANGELOG bajo «Sin publicar»).

---

## 1. Qué queremos lograr

1. **Que el dueño mantenga su conocimiento sin miedo** (D8): corregir un
   precio sin borrar la entrada, apagar una promoción vencida sin perderla,
   fijar lo importante arriba, ordenarlo, buscarlo y saber cuánto le cuesta en
   tokens. Y darle al agente los **enlaces oficiales** del negocio (Maps,
   catálogo, web, link de pago) para que nunca invente uno.
2. **Que el dueño pruebe a su agente antes de encenderlo** (D9, #9): un chat
   «Probar mi agente» dentro de Ajustes → Agente que corre el MISMO turno de
   Nea (`POST /vocero/ensayo`), con su propia llave (BYOK), sin escribirle a
   nadie ni ensuciar la Bandeja, y con un tope de 40 mensajes al día por
   negocio contado en la base.
3. **Que el dueño vea cuánto gasta y qué falla** (D9, P-10): una fila por
   llamada al modelo en `llm_usage` (tokens de entrada / en caché / de
   salida, latencia, estado), un panel de salud del bot con métricas y los
   incidentes de `bot_incident`, y un Laboratorio cuyo juez no cambie de
   opinión entre corridas (`temperature: 0`).
4. **Cerrar lo pendiente de 073-C**: los trozos de una respuesta partida que
   cayeron a `pending_send` salen en orden estricto por conversación.

## 2. Fuera de esta spec

- Búsqueda semántica (pgvector), FTS e importador de PDF/CSV de la KB.
- Recuperación selectiva de la KB por turno (sigue entera en el prompt; el
  estimador de tokens es el freno de esta iteración).
- Envío de multimedia por el bot, agenda v2 en el ensayo (las citas del
  ensayo siguen siendo simuladas por Nea).
- Precio en dinero del consumo (los proveedores BYOK cobran distinto; se
  reportan tokens).

## 3. Historias de usuario

### HU1 — Corregir y organizar la KB (P1)
Como dueño, edito una entrada en su sitio (pregunta, respuesta, bloque,
título, categoría), la apago o la fijo, cambio su orden y filtro por
categoría o texto. **Aceptación**: una entrada desactivada no llega al cerebro
(ni por `/api/bot/profile` ni por `/api/brains/context`); las fijadas llegan
primero; el resto en `sort_order` y luego por antigüedad. Nada exige borrar
para corregir.

### HU2 — Enlaces verificados (P1)
Como dueño, registro hasta 10 enlaces oficiales (`https://`, etiqueta ≤ 60).
**Aceptación**: viajan en `/api/bot/profile.resources` y en
`/api/brains/context.resources` (omitido si está vacío); Nea los muestra en el
prompt como datos y como los ÚNICOS enlaces que puede compartir; un enlace
`http://`, `javascript:` o con espacios se rechaza (CRM) y se descarta (Nea).

### HU3 — Estimador de tokens (P2)
Como dueño, veo cuántos tokens estimados ocupan mi KB y mis enlaces activos,
con una barra contra un presupuesto (8.000 tokens) y aviso desde el 75 %.

### HU4 — «Probar mi agente» (P1)
Como dueño o admin, converso con mi agente en Ajustes → Agente: escribo como
cliente, veo sus respuestas y las acciones simuladas (ficha, etapa, handoff,
cita), reinicio la conversación y veo cuántas pruebas me quedan hoy.
**Aceptación**: ningún mensaje, contacto ni conversación aparece en la
Bandeja; el modelo se paga con la llave del negocio; el mensaje 41 del día
recibe 429 `tope_ensayos` sin llamar al cerebro; un miembro de otra
organización no puede usar la ficha de ensayo de esta (cruce A↛B); un agente
sin rol de configuración recibe 403.

### HU5 — Salud del bot (P2)
Como dueño o admin, veo en Ajustes → Agente las llamadas al modelo de los
últimos 7 días (total, errores, tokens de entrada / caché / salida, latencia
p50 y promedio, por origen) y los incidentes recientes del bot con filtro por
tipo. **Aceptación**: solo los de mi organización; sin texto de prompts ni
datos personales.

### HU6 — Laboratorio estable (P3)
El juez evalúa con `temperature: 0` y la pantalla muestra el número real de
casos de la corrida (no un «6» fijo).

## 4. Requisitos funcionales

| ID | Requisito |
|---|---|
| FR-01 | `kb_entry` gana `title` (≤120), `category` (`general`, `servicios`, `precios`, `horarios`, `pagos`, `politicas`, `faq`; default `general`), `enabled` (default `true`), `pinned` (default `false`), `sort_order` (default `0`). Migración aditiva re-ejecutable. |
| FR-02 | Orden canónico de la KB para el cerebro: `pinned desc, sort_order asc, created_at asc`, solo `enabled`. Una sola función (`kbParaElCerebro`) lo aplica en `/api/bot/profile`, `/api/brains/context`, el Laboratorio y el estimador. |
| FR-03 | `title` viaja como cabecera de su entrada (`## título`) en el texto aplanado y como campo opcional en `knowledge[]` de `/api/brains/context`. Sin título, el texto es el de siempre (doradas B0). |
| FR-04 | `POST/PATCH /api/kb` aceptan los campos nuevos; `PATCH /api/kb/[id]` edita en su sitio; `POST /api/kb/reorder` fija el orden de una lista de ids del negocio. |
| FR-05 | `agent_profile.resources` (`jsonb`, `[]`): ≤10 `{label ≤60, url https ≤500}`; `PUT /api/agent/resources`. |
| FR-06 | `/api/brains/context.resources` aditivo y omitido si vacío; `/api/bot/profile.resources` deja de ir siempre vacío. |
| FR-07 | Nea sanea `resources` (`app/datos.py`: etiqueta de una línea, URL `https://` sin espacios, comillas ni corchetes, ≤10) y los presenta como enlaces oficiales: los únicos que puede compartir, tal cual. |
| FR-08 | Prompt caching: el `system` de Nea es [chasis + perfil + enlaces + KB] (estático por negocio y canal) seguido de `CONTEXTO ACTUAL` (fecha/hora, lead, ficha, citas, `humanAvailable`). Prueba de prefijo común entre turnos distintos. Las 6 doradas B0 siguen idénticas tras `DELTAS_074`. |
| FR-09 | `GET /api/kb/size` devuelve además `tokens` estimados (`ceil(chars/4)`, KB + enlaces activos), `budgetTokens` (8.000) y `warning` desde el 75 %. |
| FR-10 | `POST /api/agent/playground` (sesión; `owner`/`admin`; soporte de nivel `configuracion` no basta) arma un contexto sintético (`cv_ensayo_*`, `ensayo:*`) con la configuración REAL del negocio, firma el cuerpo con el secreto del despliegue y lo manda a `{dispatchUrl→/vocero/ensayo}`. Solo modo plataforma. |
| FR-11 | Ficha de ensayo (`X-Vocero-Ensayo`): HMAC (`BETTER_AUTH_SECRET`, dominio `aliantis-ensayo:v1`) atada a organización + conversación sintética, vida 10 min. `requireBrain` la lee; `/api/brains/llm` la registra como `source: "ensayo"`; `/api/brains/agenda/slots` contesta huecos SIN registrar oferta solo para esa conversación sintética. Cualquier otra escritura con la ficha → 403 `ensayo_solo_lectura`. |
| FR-12 | Tope del ensayo: `organization.metadata.bot.playgroundPerDay` (default 40, Blueprint `bot`), contado en la tabla `agent_playground_day` (día en la zona del negocio) con incremento atómico condicionado. Un fallo del cerebro devuelve el cupo. |
| FR-13 | `llm_usage`: una fila por llamada en `pensarPorElCerebro` (best-effort): organización, `dispatch_id` (cabecera `X-Vocero-Dispatch` de Nea, si llega), `source` (`turn`/`ensayo`/`lab`/`transcribe`), `model`, `status_code`, tokens (`prompt`, `cached`, `completion`), `latency_ms`. Índice `(organization_id, created_at)`; purga por lotes a 90 días en el barrido. Sin texto ni PII. El juez del Laboratorio registra `source: "lab"`. |
| FR-14 | `GET /api/agent/health` (owner/admin): métricas de `llm_usage` (7 días) e incidentes recientes (`?kind=`). Panel en Ajustes → Agente. |
| FR-15 | Juez del Laboratorio con `temperature: 0`; `lab-client` muestra el total real de casos. |
| FR-16 | Nea `pending_send`: en una pasada, si un mensaje de una conversación falla (reprogramado), los siguientes de esa misma conversación no se intentan hasta la próxima pasada. |

## 5. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| E1 | `resources` vive en `agent_profile` (jsonb), no en tabla propia. | Son ≤10, se editan juntos y viajan juntos; una tabla no compra nada. |
| E2 | `title` se aplana como `## título` encima de su entrada. | El modelo lo lee como sección; sin título el texto no cambia (B0 intactas). |
| E3 | Presupuesto de KB en tokens estimados (`chars/4`), 8.000 tokens, aviso al 75 %. | Sin tokenizer del proveedor (BYOK); suficiente para frenar el «lost in the middle». Reemplaza el aviso de 24.000 caracteres (equivalente). |
| E4 | El Playground solo existe en modo plataforma. | `POST /vocero/ensayo` de Nea solo corre en `multiorg`; en `single` la instancia tiene su Laboratorio. La tarjeta lo dice. |
| E5 | El ensayo no lleva historial persistido: el navegador guarda la sesión de prueba y la reenvía (≤40 mensajes, como acepta Nea). «Reiniciar» la vacía. | Ninguna fila en la Bandeja ni en la memoria de Nea. |
| E6 | Un mensaje del Playground = 1 del cupo, aunque el turno haga varias llamadas al modelo. | Es la unidad que ve el dueño. Si el cerebro falla o no contesta, el cupo se devuelve. |
| E7 | La agenda del ensayo es de solo lectura en el CRM (huecos reales, sin oferta); reservar sigue simulado en Nea. | Ya es así en `app/ensayo.py`; el CRM solo tenía que dejar pasar la lectura. |
| E8 | `dispatch_id` llega por la cabecera aditiva `X-Vocero-Dispatch` que Nea pone en cada llamada al modelo del turno. | El proxy no conoce el despacho; la cabecera es opcional y un CRM viejo la ignora. |
| E9 | `source` lo decide el CRM: ficha de ensayo → `ensayo`; cuerpo con `input_audio` → `transcribe`; juez → `lab`; resto → `turn`. | No depende de que el cerebro diga la verdad. |
| E10 | Orden de `pending_send` por conversación «dentro de la pasada»: el trozo que falla bloquea a los siguientes de esa conversación hasta la próxima pasada. | Se entrega en orden de id y no se adelanta nadie; las demás conversaciones no esperan. |

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| La ficha de ensayo abre escrituras del cerebro | Toda ruta de escritura de `/api/brains/*` la rechaza (403); pruebas por ruta. |
| Un dueño quema su saldo probando | Tope 40/día en base, configurable por plan. |
| Insert de `llm_usage` frena o rompe un turno | `try/catch`, sin `await` bloqueante del resultado del proveedor (se escribe después de leer la respuesta y nunca lanza). |
| Doradas B0 | `DELTAS_074` con sustitución exacta de las dos líneas de recursos; prueba de «no hay deltas muertos». |
