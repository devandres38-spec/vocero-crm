# 078 — Etapa por eventos y ficha con lista blanca (bloque J, pasos 5.1 y 5.2)

**Estado:** aprobada por Andres el 12-nov-2026, con sus 6 respuestas.

**Las respuestas:**
1. **El mapeo:** en Vocero, por id. La interfaz y la validación solo dejan mapear a etapas abiertas, nunca a ganada ni perdida.
2. **`ETAPAS_INICIALES`:** `primera_respuesta` → «En conversación» y `servicio_consultado` → «Interesado». `pidio_cita` queda sin etapa: cada negocio que use citas o reservas crea y mapea la suya.
3. **La ficha:** solo `servicio_interes` y `quiere_cita` (sin `temas_consultados`).
   - En negocios **sin** filtro de salud se guarda `servicio_interes`.
   - En negocios **con** filtro de salud (`sensible`), no, solo `quiere_cita`.
   - Queda **pendiente confirmarlo con el abogado**.
4. **`is_test`:** no mueve ni escribe (`200` con `prueba`).
5. **`stage` por nombre:** se conserva para cerebros externos; `aliantis-brain` solo usa `evento`.
6. **La medición real:** permiso para `npm run evals -- --real --tope 0.5`, sin leer `.env`, al cerrar los cambios.

El sistema es neutro para cualquier rubro: «salud» es solo el caso de los negocios con filtro sensible.
**Repos:**
- `vocero-crm` (esta spec);
- `aliantis-brain` (`specs/014-etapa-y-ficha/`);
- `aliantis-core` (`decisiones.md` y `estado.md`);
- `aliantis-espacio` (el relevo, si cambia algo).

**Toca:**
- el contrato (`POST /api/bot/stage` y `PUT /api/bot/ficha`);
- el esquema: una columna en `pipeline_stage`, sin tablas nuevas;
- la configuración por negocio.

**Decisiones de Aliantis que concreta:**
- **D18:** la etapa del Kanban se mueve por eventos, en código, con un mapeo por cliente; el LLM no elige la etapa.
- **D12:** el cerebro solo escribe claves de una lista blanca y nunca notas; Vocero enmascara salud y datos personales en el texto libre.

## Lo que hay hoy (revisado en el código, 12-nov-2026)

### Vocero

- **`POST /api/bot/stage`** (`src/server/bot/stage.ts`, 038):
  - recibe `stage` (id o nombre, resuelto también sin distinguir mayúsculas);
  - solo mueve **hacia adelante** y a etapas **abiertas**: ganada y perdida son decisión de una persona;
  - exige la herramienta `etapa` encendida en el perfil del agente;
  - con una persona atendiendo responde `409 ai_paused`;
  - la misma etapa da `200 changed: false`;
  - pasa por `moveLeadToStage`, la única puerta que escribe `stage_id`;
  - el contexto le enseña al cerebro `lead.stageName` y `lead.nextStages`;
  - **no mira `is_test`.**
- **Las etapas sembradas** (`ETAPAS_INICIALES`, `src/server/auth/alta.ts`): Nuevo, En conversación e Interesado (abiertas), Cliente (ganada) y Perdido (perdida).
  - El dueño las renombra, reordena y crea en `stage-manager.tsx` (`/api/pipeline/stages`).
  - Hay un precedente: la CAPI guarda «qué etapa es lead calificado» como **id** de etapa elegido por el negocio (`capi_settings.qualified_stage_id`), «en vez de adivinarse» por el nombre.
- **`PUT /api/bot/ficha`** (`src/server/bot/ficha.ts`, `upsertFicha`):
  - acepta **claves libres** (hasta 40, de 60 caracteres) y valores escalares de hasta 500;
  - hace merge clave a clave, y `null` borra;
  - los valores de texto pasan por el filtro de privacidad (071), las claves no («lista blanca: fase 5», dice el código);
  - **no comprueba** la herramienta `ficha`, ni si una persona atiende, ni `is_test`;
  - el dueño escribe la ficha por la misma puerta desde la bandeja (`/api/contacts/[id]`), con claves libres.
- **Notas:** `notes` de `/api/bot/bookings` ya se descarta (P5), y el cerebro no tiene ruta de notas.

### Cerebro

- `crearClienteVocero` tiene `moverEtapa(conversationId, stage)`, pero **ningún turno lo llama**.
- **No hay cliente de ficha.**
- El LLM elige de 1 a 3 comandos (`informar`, `aclarar`, `derivar`, `saludar`, `agradecer_despedir` y `fuera_de_alcance`); los de agenda están declarados sin implementar.
- **Los hechos que el código ya conoce en cada turno:**
  - si hubo respuesta;
  - el `servicioId` de catálogo de `informar` (precio y duración);
  - el `motivo` de `derivar`: `agendar` también sale de aceptar la oferta en `offer.ts`;
  - las reglas fijas que dispararon: consentimiento, salud y sin revisar.
- **Las acciones del turno** (`src/turn/acciones.ts`) son durables, se guardan en `turns.acciones` y van en orden: consentimiento → olvidar → mensaje → derivar.

## Diseño

### 5.1 La etapa por eventos (D18)

1. **Un catálogo cerrado de eventos** (código en los dos repos):

   | Evento | Cuándo lo emite el cerebro |
   | --- | --- |
   | `primera_respuesta` | El turno envía una respuesta del bot **con el consentimiento ya dado**. No cuentan el aviso, el «no acepta», la frase fija de salud ni el error. |
   | `servicio_consultado` | Un `informar` con un `servicioId` del catálogo (precio o duración). |
   | `pidio_cita` | Un `derivar` con motivo `agendar` (también el «sí» a la oferta). |
   | `cita_agendada` | Reservado para la fase 8 (agenda). Se declara, no se emite. |

2. **El mapeo por negocio vive en Vocero, por id de etapa** (pregunta 1):
   - columna nueva `pipeline_stage.evento_bot` (nula o uno de los eventos), única por negocio;
   - el dueño la elige en `stage-manager.tsx` («El agente mueve aquí al cliente cuando…»);
   - renombrar una etapa no rompe nada, y borrarla apaga el evento.
3. **El mapeo por defecto** (pregunta 2), en el alta y en la migración para los negocios que ya existen (por nombre exacto, solo si la etapa existe y es abierta):
   - «En conversación» ← `primera_respuesta`;
   - «Interesado» ← `servicio_consultado`;
   - `pidio_cita` sin etapa: el negocio crea la suya, por ejemplo «Quiere cita».
4. **`POST /api/bot/stage` gana `evento`** (en vez de `stage`; los dos a la vez dan 422). Vocero resuelve la etapa y aplica las reglas de siempre más tres:

   | Caso | Respuesta |
   | --- | --- |
   | El evento no tiene etapa en ese negocio | `200 { changed: false, motivo: "sin_etapa" }` |
   | El lead ya está en esa etapa o más adelante (incluidas ganada y perdida) | `200 { changed: false, motivo: "ya_esta" }`: nunca hacia atrás, y no es un error |
   | Conversación de prueba (`is_test`) | `200 { changed: false, motivo: "prueba" }` (pregunta 4) |
   | Una persona atiende | `409 ai_paused` (como hoy) |
   | Herramienta `etapa` apagada | `409 herramienta_apagada` (como hoy) |

   **`stage` por nombre se conserva** para cerebros externos tipo Nea (Suma de Potencias, pregunta 5). `aliantis-brain` nunca lo usa: el LLM no elige la etapa.
5. **El movimiento** queda en el historial de etapas con `source: "bot"`, como hoy, y se publica `conversation.updated`.

### 5.2 La ficha con lista blanca (D12)

1. **La lista blanca del cerebro** es fija, en el código de Vocero (`FICHA_DEL_CEREBRO`), y forma parte del contrato (pregunta 3):

   | Clave | Tipo | De dónde sale |
   | --- | --- | --- |
   | `servicio_interes` | texto, hasta 80 | el **nombre del catálogo** del último `servicioId` de `informar`; nunca texto del paciente |
   | `quiere_cita` | booleano | `true` con `pidio_cita` |

2. **`PUT /api/bot/ficha` se vuelve estricto:**
   - una clave fuera de la lista da `422 clave_no_permitida`;
   - un tipo equivocado da `422 invalid_body`;
   - `null` sigue borrando;
   - el texto sigue pasando por el filtro de privacidad (segunda red: si el filtro marca salud, el valor no se guarda);
   - gana las mismas reglas que la etapa: `409 ai_paused`, `409 herramienta_apagada` (herramienta `ficha`) y `200 { prueba: true }` sin escribir en `is_test`.
3. **El dueño no cambia:** desde la bandeja sigue con claves libres y el filtro en los valores (Suma de Potencias). La lista blanca es para lo que escribe el cerebro.
4. **Salud** (pregunta 3b): en un negocio con filtro de salud (perfil con términos sensibles), el **interés en un tratamiento puede ser un dato de salud** (estimación: no soy abogado). Propuesta:
   - en esos negocios el cerebro **no escribe `servicio_interes`**, solo `quiere_cita`;
   - un turno con la regla de salud o «sin revisar» no escribe nada en la ficha ni mueve la etapa.

### Orden y fallos (cerebro, spec 014)

- **Nuevas acciones durables** `etapa` y `ficha`, **después** de `mensaje` y **antes** de `derivar`. Lo que ve el paciente va primero, y después del traspaso Vocero ya las rechazaría (`409 ai_paused`, con una persona atendiendo). Lo encontró la prueba de integración del cerebro.
- **No son críticas:** si fallan (409, 422 o Vocero caído tras los reintentos), la acción queda `fallida` y el turno sigue. Nunca derivan, nunca reintentan el turno entero y nunca bloquean la respuesta.
- **Antes del consentimiento,** nada: ni etapa ni ficha.
- **Idempotentes:** mover a la misma etapa da `changed: false`, y el merge de la ficha con los mismos valores no cambia nada.

## Casos borde

- **El dueño reordena las etapas** después de mapearlas: vale el orden actual. Si la etapa de `servicio_consultado` queda antes que la del lead, es `ya_esta` y no se mueve.
- **El dueño borra la etapa mapeada:** el evento queda sin etapa (`sin_etapa`). Hay que confirmar en T2 el `ON DELETE` del lead, que hoy impide borrar una etapa con leads.
- **Dos eventos en el mismo turno** (preguntó el precio y pidió cita): se emiten en orden y Vocero aplica cada uno; termina en la etapa más adelantada.
- **Un lead en «Cliente» o «Perdido»** escribe otra vez: `ya_esta`. El bot nunca reabre un lead cerrado.
- **El contacto sin lead:** `404 sin_lead`, como hoy. El turno sigue.
- **Herramientas apagadas por el dueño:** el cerebro las intenta y Vocero las rechaza con 409; queda anotado y no pasa nada más.
- **El nombre del servicio cambia en `cliente.yaml`:** la ficha guarda el nombre vigente al escribirla.
- **Se borra la conversación** (`conversation.deleted` o «No acepto»): `vaciarFicha` ya la vacía; la etapa se queda.
- **Tenant cruzado:** las dos rutas corren dentro de `rutaDelCerebro` (RLS); se prueba en «RLS contra Postgres».

## Lo que no cambia

- **Ganar y perder** siguen siendo de una persona (CAPI y ventas).
- **El LLM** no ve ni elige etapas ni claves de ficha: el catálogo de comandos no cambia.
- **Las notas:** el cerebro sigue sin escribirlas.

## Verificación

- **Pruebas unitarias en los dos repos:**
  - el mapeo, hacia adelante y `ya_esta`;
  - la lista blanca y los tipos;
  - `is_test`, `ai_paused` y la herramienta apagada;
  - los eventos del turno;
  - el orden de las acciones y los fallos no críticos.
- **«RLS contra Postgres»:** la columna nueva y el índice único por negocio; un negocio no mueve etapas de otro.
- **`e2e.yml`:** `e2e-contrato-aliantis` gana una sección de etapa y ficha.
- **Evaluaciones** del cerebro (`evals/conversaciones`): los casos ganan `esperado.eventos` y `esperado.ficha`.
  - **Con el LLM falso, en el CI:** al 100 %.
  - **Con el modelo real** (pregunta 6), medido con tope de gasto.
- **Sabotajes:**
  1. **(Vocero) Hacia atrás:** un evento cuya etapa está antes que la del lead lo mueve hacia atrás → falla la unitaria y el E2E.
  2. **(Vocero) Clave libre:** la ficha del cerebro acepta una clave fuera de la lista → falla la unitaria y el E2E.
  3. **(Vocero) Persona atendiendo:** la ficha se escribe con una persona atendiendo → falla la unitaria.
  4. **(Cerebro) Antes del consentimiento:** se emite `primera_respuesta` antes del consentimiento → fallan la unitaria y la evaluación.
  5. **(Cerebro) Salud:** en un negocio con salud se escribe `servicio_interes` → falla la unitaria.
  6. **(Cerebro) Fallo crítico:** un fallo de la etapa deriva a una persona → falla la prueba de acciones.

## Preguntas para Andres (con mi recomendación)

1. **Dónde vive el mapeo evento → etapa.** Recomiendo Vocero, por id de etapa, elegido en la pantalla de etapas (como `qualified_stage_id` de la CAPI): renombrar no lo rompe y el dueño lo ve. La otra opción es `cliente.yaml` del cerebro con nombres de etapa: es frágil (un renombre lo rompe en silencio) y solo tú lo editas.
2. **El catálogo de eventos y el mapeo por defecto.**
   - **Los eventos:** recomiendo los 3 eventos y uno reservado para la agenda.
   - **El mapeo por defecto:** `primera_respuesta` → «En conversación» y `servicio_consultado` → «Interesado».
   - **`pidio_cita`:** sin etapa hasta que el negocio la cree.

   ¿Quieres que el alta siembre además una etapa «Quiere cita» mapeada a `pidio_cita`?
3. **La lista blanca y la salud.**
   - **La lista:** recomiendo solo `servicio_interes` y `quiere_cita`, con valores que salen del código, nunca del texto del paciente.
   - **(3b) Negocios con filtro de salud:** recomiendo no escribir `servicio_interes`, porque «le interesa una endodoncia» puede ser dato de salud (estimación; conviene confirmarlo con el abogado).

   ¿Quieres otra clave? Por ejemplo, `temas_consultados` (horario, pagos…), que no es dato personal.
4. **El Laboratorio.** Recomiendo que en las conversaciones de prueba la etapa y la ficha no se escriban (`200` con `prueba`), para no ensuciar el Pipeline con clientes falsos. La otra opción es escribirlas para ver el efecto en el Laboratorio.
5. **`stage` por nombre.** Recomiendo conservarlo para cerebros externos (Nea u otros), con sus reglas de hoy. `aliantis-brain` solo usa `evento`.
6. **La medición real de las evaluaciones.** Recomiendo correr `npm run evals -- --real --tope 0.5` en tu PC (son llamadas HTTP, sin carga de RAM; usa tu llave del `.env`, que no leo).
   - **Gasto:** 0,10 a 0,30 USD (estimación con DeepSeek V4.1 Flash).
   - **Quién lo corre:** ¿lo corro yo con tu permiso o lo corres tú?
