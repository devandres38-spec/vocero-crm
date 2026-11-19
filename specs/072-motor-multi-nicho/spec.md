# Feature Specification: Motor Multi-Nicho — Vertical Packs, Ficha flexible y Puente de herramientas

**Feature Branch**: `feat/072-motor-multi-nicho` (en `vocero-crm` y `nea-agent`, creadas desde `main`)
**Created**: 2026-11-19
**Status**: Aprobada (D1–D22, 2026-11-19) — en implementación (Ronda 072-A)
**Carril**: **Ciclo completo** (Principio VI): migraciones aditivas `0032_motor_nicho`
y `0033_llamadas_de_herramienta`, crecimiento aditivo de los contratos publicados
`/api/brains/context`, `/api/bot/context`, `PUT /api/brains/ficha` y
`OrganizationBlueprint` v1, una ruta nueva `POST /api/brains/tools/{name}` y un
cambio coordinado entre los dos repositorios.
**Constitución**: 2.0.0 (Principios I, II, III, V, VI, IX, **X**, XI; restricción
«Contratos entre repositorios»).
**Repos**: `vocero-crm` (casi todo) · `nea-agent` (esquema dinámico de
`update_ficha`, datos por reunir, herramientas de módulo).
**Auditado contra**: `vocero-crm@e6d25ff` y `nea-agent@644d77f` (`main` tras la 071).
**Contratos**: [contracts/brains-072.md](contracts/brains-072.md) ·
[contracts/blueprint-072.md](contracts/blueprint-072.md) ·
[contracts/vertical-packs.md](contracts/vertical-packs.md).

---

## 1. Qué quiere lograr Aliantis (dicho con nuestras palabras)

Aliantis vende **software vertical sin construir software vertical**. Una
clínica dental tiene que entrar y sentir que compró «un software de clínicas»:
que el menú hable de *pacientes* y *valoraciones*, que la ficha del lateral le
pida *tratamiento de interés* y *EPS*, que su inicio le muestre las valoraciones
de hoy y que el bot sepa qué dato falta antes de agendar. Una empresa de
alquiler de mobiliario tiene que sentir lo mismo con *eventos*, *invitados* y
*cotizaciones*. Y todo eso tiene que salir **del mismo motor**: un solo
`vocero-crm`, una sola Nea `multiorg`, una sola base, un solo lugar donde
corregir un fallo de seguridad.

El valor comercial está en tres cosas:

1. **Tiempo de alta**: un negocio nuevo de un nicho conocido queda listo en
   minutos desde una plantilla (etapas, agente, ficha, FAQs, respuestas
   rápidas, apariencia) — hoy se arma a mano.
2. **Encaje percibido**: vocabulario, inicio y ficha del nicho. Es lo que el
   cliente ve en la demo y lo que justifica el precio frente a un CRM genérico.
3. **Capacidad funcional por nicho** (inventario, cotizador, PDF): lo que el
   CRM genérico no puede hacer y la competencia vertical sí.

Y una restricción que lo condiciona todo: **un cambio en un nicho no puede
romper a otro**, y un ajuste para un cliente no puede convertirse en un fork.

## 2. Dónde fracasan los proyectos así (las trampas reales)

| # | Trampa | Cómo se ve cuando ya pasó |
|---|---|---|
| T1 | **Overrides de código por cliente** | Carpetas `clientes/acme/` con copias de componentes; cada arreglo del núcleo hay que replicarlo N veces; nadie sabe qué cliente tiene qué. Es la agencia convertida en fábrica de desarrollos a medida con margen negativo. |
| T2 | **Slots que reemplazan vistas enteras** | El pack «Clínica» tiene su propia Ficha lateral; seis meses después la del núcleo ganó edición en línea, atajos y accesibilidad y la de la clínica no. Es un fork dentro del mismo repo (ADR-001 vio morir `004-motor-agenda` así). |
| T3 | **Cadenas de herencia** (`default → salud → dental → dental-premium → cliente`) | Para saber qué ve un negocio hay que resolver cinco capas; los cambios en la base rompen hojas en silencio. |
| T4 | **«Vocabulario» que se vuelve i18n completo** | Se intenta traducir «contacto» → «paciente» en 400 textos; la mitad queda a medias y el producto se lee mezclado. |
| T5 | **Campos personalizados como segundo almacén** | Aparece `custom_fields` al lado de la `ficha` que el bot ya escribe: dos verdades, migraciones de sincronía, el bot escribe en una y la UI lee la otra. |
| T6 | **Herramientas definidas por el tenant** | «Que el negocio configure un webhook como herramienta del bot»: SSRF, inyección de prompt por la descripción, sin idempotencia, sin dueño cuando falla. |
| T7 | **Efectos duplicados** | El bot llama «enviar cotización», el turno se reintenta tras un *lease* vencido y el cliente recibe dos PDF con dos números distintos. |
| T8 | **Prompt que crece por cada nicho** | Cada pack agrega párrafos al prompt; las pruebas doradas se vuelven inútiles y la latencia sube para todos. |
| T9 | **Abstracción sin consumidor real** | Se diseña el «puente genérico» sin el cotizador delante y la 073 descubre que necesitaba asincronía, envío de documentos e idempotencia. |
| T10 | **Pack = módulo** | Se mezcla «cómo se ve» con «qué sabe hacer»: una clínica que quiere el cotizador tiene que cambiar de nicho. |

## 3. Crítica frontal a la propuesta original y qué cambia

Lo que se propuso es correcto en la **meta** y en la **separación núcleo/nicho**,
pero tiene cuatro problemas de diseño y uno de tamaño.

**3.1 Los «slots reemplazables» de Shell/Nav, Ficha lateral e Inicio son la
trampa T2.** La Ficha lateral vive dentro de `ContactPanel`, que está dentro de
`InboxClient` (607 líneas, cliente): reemplazarla por pack obliga a duplicar la
carga, el guardado y el SSE de la ficha. El Shell (`AppShell` + `AppNav`, 693
líneas) carga atajos, banda sin conexión, avisos de IA y soporte: un Shell por
pack los perdería. **Cambio**: no se reemplazan vistas; se abren **puntos de
extensión aditivos** (D4):
- *Navegación*: ya es un modelo de datos puro (`src/lib/nav.ts`); el pack la
  parametriza (orden, etiquetas, ocultas, entradas de módulo). Cero componentes nuevos.
- *Ficha lateral*: el panel del núcleo pasa a pintar **campos tipados por
  esquema** (pilar 2) y **secciones aportadas por módulos** (registro con carga
  diferida). Un nicho la cambia con datos; un módulo le *agrega* una sección.
- *Inicio*: no existe hoy (la raíz manda a `/onboarding` o `/inbox`). Se crea
  **una** página del núcleo `/inicio` que pinta **widgets de un catálogo**; el
  pack elige cuáles y en qué orden, y los módulos aportan widgets.

**3.2 Pack y módulo están mezclados (T10).** La propuesta pone «rutas exclusivas
`/m/...`» y «herramientas por módulo/pack» dentro del pack. **Cambio** (D2):
- **Vertical Pack** = presentación + semilla (vocabulario, navegación, widgets
  de inicio, esquema de ficha sugerido, Blueprint semilla, personas). **Solo
  datos tipados.** Vive en `organization.vertical_pack`.
- **Módulo** = capacidad (tablas, rutas `/m/<modulo>`, herramientas del bot,
  secciones de ficha, widgets). **Código aislado.** Se enciende en
  `organization.modules.modules` (la columna y `CATALOGO_VERTICAL` ya existen
  desde la 069 y están vacíos a la espera de esto).
- Un pack **recomienda** módulos; no los contiene. Una clínica puede encender
  el cotizador sin dejar de ser clínica.

**3.3 «Override puntual por negocio» no puede ser código (T1).** **Cambio** (D5):
el ajuste por negocio es **solo datos validados** (`vertical_overrides`:
vocabulario, entradas ocultas/orden, widgets), editable únicamente por la
agencia. Si un cliente necesita código, lo que necesita es un **módulo** (que
sirve a cualquiera que lo encienda) o un **pack nuevo**, nunca una carpeta con
su nombre.

**3.4 `custom_fields` como columna nueva es la trampa T5.** El CRM ya guarda
`contact.ficha` (jsonb libre, con merge y cotas en `server/bot/ficha.ts`) y Nea
ya la escribe con `update_ficha`. **Cambio** (D9): lo que falta no es un
almacén, es un **esquema**. `organization.ficha_fields` define los campos
(clave, etiqueta, tipo, opciones, obligatorio, descripción para el bot); los
valores siguen en `contact.ficha`. Las claves fuera del esquema se siguen
aceptando (retrocompatibilidad con el esquema B2B de hoy).

**3.5 `customTools` invita a la trampa T6.** **Cambio** (D13): se llaman
`moduleTools`, y en la 072 **solo las define código de módulos** en el CRM
(nombre, esquema `zod`, manejador, tipo de efecto). Ningún tenant escribe
herramientas, URLs ni descripciones de herramientas. Eso elimina de raíz la
inyección por descripción de herramienta y el SSRF; lo que queda (datos del
dueño en descripciones de campos de ficha, resultados de herramientas) se
acota en §8.

**3.6 Lo que faltaba en la propuesta**:
- **Idempotencia** del puente (T7): la 073 envía un PDF; un turno reintentado
  no puede mandar dos. Se agrega `brain_tool_call` (D14).
- **Asincronía**: generar y enviar un PDF puede pasar de 8 s; el contrato
  admite `estado: "en_curso"` y el envío lo hace el CRM por su camino de
  siempre (`sendMediaMessage`), no Nea (D14, §10).
- **Registro por turno en Nea**: `REGISTRO` es global y `clave_de()` clasifica
  un nombre desconocido como `escalar` (siempre permitido). Enchufar
  herramientas dinámicas mutando el registro global reintroduciría el estado
  compartido entre negocios que la 071 eliminó (D15).

**3.7 Tamaño: cuatro pilares en un solo merge es demasiado.** Son dos
migraciones, un contrato nuevo entre repos, tres packs con UI, una página nueva
del núcleo, el editor de ficha y cambios de prompt en Nea. En un solo merge,
una regresión en el puente bloquea la entrega de plantillas (que ya venden).
**Cambio** (D1): **una spec, dos rondas fusionables por separado**:

| Ronda | Contenido | Versión | Valor sin la otra |
|---|---|---|---|
| **072-A** | Packs (datos + nav + vocabulario + `/inicio` + widgets), Ficha flexible (CRM + Nea), Plantillas en `/platform/nuevo` + Blueprint + MCP, Personas por pack | 2.12.0 | Total: ya se vende «clínica» y «eventos» |
| **072-B** | Marco de módulos (`/m/<modulo>`, `withModulo`, registros), Puente `moduleTools` (CRM + Nea), idempotencia, módulo `diagnostico` | 2.13.0 | Prepara la 073; sin consumidor comercial aún |

*Alternativa considerada*: partir en dos specs (072 = A, 073 = B) y mover
Eventos & Mobiliario a la 074. Pro: specs más cortas. Contra: renumera el
roadmap ya comunicado y separa el diseño del puente del diseño de los packs que
lo consumen. Se recomienda la de dos rondas; la decisión es D1.

## 4. Hallazgos de la auditoría

| # | Hallazgo | Dónde | Consecuencia para la 072 |
|---|---|---|---|
| H1 | No existe Inicio/Dashboard: la raíz redirige a `/onboarding` o `/inbox` | `src/app/page.tsx` | `/inicio` es una página nueva del núcleo, no un slot |
| H2 | La navegación ya es un modelo de datos sin React | `src/lib/nav.ts` (`appNavGroups`) | El pack la parametriza sin tocar `app-nav.tsx` más que para pasar el modelo |
| H3 | `contact.ficha` jsonb libre, merge campo a campo, ≤40 claves, ≤500 car. | `server/bot/ficha.ts`, `schema.ts:312` | Se agrega esquema, no almacén; el tope de 40 limita los campos definidos a 20 |
| H4 | `update_ficha` en Nea tiene un esquema B2B fijo (`rubro`, `rol`, `tamano_aprox`, `sistemas`, `dolor_principal`, `geo`, `calificado`, `resultado`, `notas`) | `nea-agent/app/tools.py:53` | Para una clínica es ruido: el bot pregunta «¿cuál es tu rubro?» |
| H5 | `esquema_de_ficha(context)` ya es el único punto que decide el esquema y recibe el contexto del turno | `nea-agent/app/herramientas/builtin.py:45` | El enchufe de la 071 sirve tal cual |
| H6 | `REGISTRO` es global; `clave_de()` devuelve `escalar` para nombres desconocidos; `solo_encendidas` deja pasar lo que clasifica como `escalar` | `nea-agent/app/herramientas/registro.py`, `app/tools.py:349` | Una herramienta dinámica sin registro por turno se ofrecería pero fallaría al ejecutar («herramienta desconocida») |
| H7 | `profile.permite(clave)` con `tools` no nulo bloquea claves que no estén en la lista del catálogo fijo | `nea-agent/app/profile.py:76` | Las claves `modulo:*` necesitan regla propia |
| H8 | `CATALOGO_VERTICAL = []` y `modules.modules` ya existen; en `single` `modules` siempre es `[]` | `server/modulos/efectivos.ts` | Los módulos son solo de `multi`; el modelo de banderas ya está |
| H9 | Las personas del Laboratorio son globales y de ferretería («taladros», «pulidora») | `server/lab/personas.ts` | Una clínica se prueba con un cliente que pide un martillo |
| H10 | La apariencia ya tiene tres capas: tema de catálogo (`TEMAS`), default del negocio (`metadata.apariencia`), cookie por persona; el acento es de la marca | `lib/temas.ts`, `server/apariencia.ts` | Una cuarta capa «tokens del pack» chocaría con 062 y con las pruebas de contraste |
| H11 | El Blueprint v1 es `.strict()` por sección y opcional por sección; el catálogo MCP ya expone `modules.verticals` | `lib/platform/blueprint.ts`, `server/platform/catalogo.ts` | Las secciones nuevas son aditivas sin subir `version` |
| H12 | El núcleo ya envía documentos del servidor a una conversación con ventana de 24 h y adjunto durable | `server/inbox/send.ts:552` (`sendMediaMessage`) | La 073 envía el PDF por aquí; Nea no transporta archivos |
| H13 | El `ContactPanel` monta `FichaPanel` con un editor clave/valor de texto | `components/inbox/contact-panel.tsx:370`, `components/ficha-panel.tsx` | Es el punto exacto donde entra el render tipado |

## 5. Objetivos y no-objetivos

**Objetivos**
- **G1** — Un negocio nuevo de clínica o de eventos queda configurado desde
  una plantilla en un paso, por panel, REST o MCP, de forma idempotente.
- **G2** — Al entrar a un negocio `clinica-salud` y a uno `eventos-mobiliario`
  se ven diferencias reales en menú/vocabulario, Inicio y Ficha lateral.
- **G3** — El bot recolecta los datos que define cada negocio, sabe cuáles
  faltan y no repite preguntas.
- **G4** — El cerebro puede ejecutar herramientas de un módulo encendido, con
  aislamiento por organización, idempotencia y límites, sin tocar el turno.
- **G5** — Cero regresiones: `single`, negocios sin pack ni campos, Blueprint
  v1 de hoy, pruebas doradas B0 y `/api/brains/*` existentes.

**No-objetivos (072)**
- Código por negocio; herramientas o webhooks definidos por el tenant.
- Reemplazar componentes del núcleo (Shell, Bandeja, Ficha) por pack.
- Vocabulario en toda la UI (solo los términos de §US2).
- Lógica comercial de Eventos & Mobiliario (inventario, cotizador, PDF): 073.
- Packs editables desde la base de datos o por el `owner`.
- Campos personalizados en el lead/negocio (solo en el contacto, como la ficha de hoy).

## 6. Historias de usuario

### US1 — La agencia crea un negocio desde una plantilla de nicho (P1) · 072-A
Como agencia, en `/platform/nuevo` elijo «Empezar desde plantilla → Clínica /
Salud» y el formulario se precarga con etapas, agente (nombre, tono, trato,
`stallEnabled`, instrucciones base), campos de ficha, FAQs, respuestas rápidas,
apariencia sugerida y el pack. Reviso, ajusto y creo.

**Aceptación**
1. Dado `/platform/nuevo`, cuando elijo una plantilla, el formulario muestra
   todos sus valores editables y la pestaña «Nicho» con el pack elegido.
2. Dado el mismo Blueprint aplicado dos veces, la segunda devuelve
   `sin_cambios` en todas las secciones (idempotente).
3. Dado MCP, `list_vertical_packs` devuelve los tres packs con su descripción y
   módulos recomendados; `get_vertical_pack` devuelve su Blueprint semilla
   (válido contra `blueprintSchema`); `get_catalog` incluye `verticalPacks`.
4. Dado un negocio existente, cambiar su pack **no** reaplica la semilla: se
   ofrece «Aplicar plantilla» con *dry-run* que muestra qué secciones cambian.

### US2 — Cada nicho se siente como su software (P1) · 072-A
Como dueño de una clínica, veo «Pacientes», «Valoraciones», «Pacientes en
proceso» y un Inicio con las valoraciones de hoy; como dueño de alquiler de
mobiliario veo «Clientes», «Eventos próximos» y un Inicio con eventos por fecha.

**Aceptación**
1. Términos con vocabulario (únicamente): entradas del menú, título `<h1>` y
   estado vacío de Bandeja, Pipeline, Contactos, Citas e Inicio, y título del
   panel de ficha. Lo demás conserva el texto del núcleo.
2. Un negocio con pack `default` ve **exactamente** el menú y la entrada de hoy
   (raíz → `/onboarding` | `/inbox`, sin entrada «Inicio»): prueba de
   instantánea de `appNavGroups` sin pack = la de 2.11.0.
3. Con pack que define inicio, la raíz va a `/inicio` cuando la guía está
   completa (mientras no, `/onboarding` como hoy).
4. Widgets del Inicio son del catálogo del núcleo (072-A: `sin_responder`,
   `leads_por_etapa`, `citas_de_hoy`, `proximos_por_fecha` parametrizado por
   un campo `date` de la ficha, `accesos_rapidos`) o de módulos encendidos
   (072-B). Un widget de un módulo apagado no se pinta.
5. Un override de negocio (`vertical_overrides`) puede renombrar un término,
   ocultar/reordenar entradas y cambiar la lista de widgets; nunca agregar
   código ni rutas.

### US3 — La ficha de cada negocio pide lo suyo (P1) · 072-A
Como dueño (rol que configura), en Ajustes → Ficha defino hasta 20 campos:
clave, etiqueta, tipo (`text | number | date | select | boolean`), opciones
(si `select`), obligatorio, descripción para el bot y orden. En la Bandeja la
ficha lateral muestra esos campos con su control (fecha, lista, interruptor) y
debajo «Otros datos» con lo que el bot guardó fuera del esquema.

**Aceptación**
1. Valores válidos se guardan tipados (`date` como `AAAA-MM-DD`, `number`
   finito, `select` una de sus opciones, sin distinguir mayúsculas/acentos).
2. Un valor inválido para un campo del esquema **no** produce 422: se ignora y
   la respuesta lo lista en `ignored` (aditivo); lo demás se guarda.
3. La clave de un campo es inmutable; la etiqueta, la descripción y el orden
   se pueden cambiar. Quitar un campo del esquema **no** borra sus valores:
   pasan a «Otros datos».
4. Sin esquema, la ficha lateral y `PUT /api/brains/ficha` se comportan
   byte a byte como en 2.11.0.

### US4 — El bot sabe qué falta y no repite (P1) · 072-A
Como cliente final de una empresa de eventos, el bot me pregunta la fecha, el
número de invitados y el tipo de evento, una cosa a la vez, sin volver a
preguntar lo que ya dije, y si pido una cotización o una cita no me la condiciona.

**Aceptación**
1. Con esquema, `update_ficha` ofrece exactamente los campos definidos + `notas`
   con su tipo (`enum` para `select`, `string` con formato fecha para `date`).
2. El CONTEXTO ACTUAL incluye una línea «Datos por reunir» con como máximo los
   **3 siguientes** obligatorios faltantes en orden, y la «Ficha actual» con
   lo ya sabido. La línea dice que no se condicionan citas a esos datos.
3. Sin esquema: prompt y catálogo de herramientas **byte a byte iguales** a los
   dorados de la 071 (B0).
4. Un `ignored` en la respuesta del CRM se le devuelve al modelo como
   `{"ok": true, "ignorados": [...]}` para que repregunte una vez.

### US5 — El Laboratorio prueba con clientes del nicho (P2) · 072-A
Como agencia, al abrir el Laboratorio de una clínica veo personas de clínica
(paciente que pide valoración, preguntón de precios y sedes, paciente molesto
por una cita) más las universales (hostil, pide humano, fuera del conocimiento,
sin rumbo).

**Aceptación**
1. `default` conserva exactamente las 8 personas de hoy.
2. Cada pack aporta ≥3 personas propias con teléfonos sintéticos en un rango
   propio (`5700000011xx` clínica, `5700000012xx` eventos) que nunca chocan con las personas base (`57000000000N`) ni con la demo (`5700000001xx`).

### US6 — El cerebro usa herramientas del módulo encendido (P1) · 072-B
Como agencia, enciendo el módulo `diagnostico` en un negocio de staging y el
bot puede llamar `diagnostico_eco`; en otro negocio sin el módulo la
herramienta no existe para el modelo y la ruta responde 404.

**Aceptación**
1. `GET /api/brains/context` incluye `moduleTools` solo con herramientas de
   módulos encendidos del negocio (techo ∧ organización).
2. `POST /api/brains/tools/{name}`: 401 sin credencial válida; 404
   `tool_not_found` si no existe o el módulo está apagado (mismo cuerpo: no
   revela qué existe); 409 `ai_paused`; 413 sobre 16 KB; 422 `invalid_args`
   con la ruta del error; 504 `tool_timeout` a los 8 s; 200 `{ok, result}` o
   `{ok:false, error}`.
3. Misma llamada de escritura repetida (mismo `dispatchId`, nombre y
   argumentos) devuelve la respuesta guardada sin volver a ejecutar.
4. Nea descarta (con log) toda herramienta dinámica cuyo nombre choque con una
   nativa o reservada, no cumpla el patrón, o exceda tamaño/cantidad; el resto
   del turno sigue igual.
5. Matriz A↛B: la credencial de A no ejecuta ni descubre herramientas de B.

### US7 — Rutas de módulo protegidas (P1) · 072-B
Como usuario de un negocio sin el módulo, `/m/diagnostico` y
`/api/m/diagnostico/*` responden 404 limpio; con el módulo, la entrada aparece
en el menú (si el pack o el override no la ocultan).

## 7. Requisitos funcionales

**Packs (072-A)**
- **FR-001** `organization.vertical_pack` (`text not null default 'default'`,
  `check` `^[a-z][a-z0-9-]{1,39}$`). Un valor desconocido en la base se resuelve
  como `default` (con aviso en log), nunca como error.
- **FR-002** Registro tipado en `src/verticals/`: `PACKS` con `default`,
  `clinica-salud`, `eventos-mobiliario`; cada pack = `extenderPack(default, parcial)`
  (un solo nivel de herencia; arrays reemplazan). Contrato en
  [vertical-packs.md](contracts/vertical-packs.md).
- **FR-003** `resolverExperiencia(org)` (servidor, `cache()` por petición) =
  pack ⊕ `vertical_overrides` ⊕ módulos efectivos → `ExperienciaResuelta`
  **serializable**, que baja por prop al `AppShell`. Ningún componente cliente
  importa `src/verticals/`.
- **FR-004** `vertical_overrides` jsonb validado con `zod .strict()`, ≤4 KB
  (`check pg_column_size < 8192`), solo escrito por agencia (Blueprint/panel/MCP).
- **FR-005** `/inicio` (núcleo): widgets del catálogo según la experiencia; cada
  widget es un Server Component con su propia consulta acotada por
  `organizationId` y su `Suspense`; un widget que falla se pinta como tarjeta
  de error, no tumba la página.
- **FR-006** Vocabulario: diccionario cerrado `TerminoVocabulario` (≈12 claves
  con singular/plural); `t(experiencia, clave)` puro.
- **FR-007** Temas: un pack puede aportar temas al catálogo global `TEMAS` (con
  la prueba de contraste existente) y sugerir apariencia en su semilla. No hay
  capa de tokens por pack.

**Ficha flexible (072-A)**
- **FR-010** `organization.ficha_fields` jsonb (`null` = sin esquema): `{ version: 1, fields: FichaField[] }`,
  ≤20 campos, clave `^[a-z][a-z0-9_]{1,39}$` no reservada (`notas`), etiqueta
  ≤60, descripción ≤160 una línea sin caracteres de control, ≤30 opciones de
  ≤60, `check pg_column_size < 16384`.
- **FR-011** `upsertFicha` aplica el esquema: coerción tipada de las claves del
  esquema; inválidas → `ignored[]`; claves fuera del esquema → normalización
  floja de hoy. Puerta única para cerebro y Bandeja.
- **FR-012** `fichaSchema` aditivo en `/api/brains/context` y `/api/bot/context`
  (ausente o `null` sin esquema). Forma en [brains-072.md](contracts/brains-072.md).
- **FR-013** Ajustes → Ficha (rol que configura; ambos modos), editor con
  reordenar, vista previa y aviso al quitar un campo con valores.
- **FR-014** `FichaPanel` pinta campos tipados en orden + «Otros datos».
- **FR-015** Nea: `esquema_de_ficha(context)` derivado del esquema; línea
  «Datos por reunir» en `CONTEXTO ACTUAL`; `ignorados` hacia el modelo.

**Plantillas y plataforma (072-A)**
- **FR-020** Blueprint v1 + secciones opcionales `vertical` y `fichaFields`
  ([blueprint-072.md](contracts/blueprint-072.md)); `version` sigue en 1.
- **FR-021** Cada pack trae `semilla: BlueprintEntrada` parcial; prueba que la
  valida contra `blueprintSchema` y que aplicarla dos veces es idempotente.
- **FR-022** `/platform/nuevo` «Empezar desde plantilla» y ficha de negocio con
  pestaña «Nicho» (pack, overrides, «Aplicar plantilla» con dry-run).
- **FR-023** MCP: `list_vertical_packs`, `get_vertical_pack`; `get_catalog` con
  `verticalPacks` y el esquema de `fichaFields`.

**Laboratorio (072-A)**
- **FR-030** `personas` por pack; universales reutilizables; el Laboratorio
  ofrece las del pack del negocio + universales; `default` = las 8 de hoy.

**Módulos y puente (072-B)**
- **FR-040** `src/modulos/<clave>/modulo.ts` con `defineModulo({...})`: clave,
  etiqueta, rutas de nav, widgets, secciones de ficha, herramientas. Registro
  `src/modulos/registro.ts` (servidor) y `registro-cliente.ts` (solo
  `next/dynamic`). `CATALOGO_VERTICAL` se deriva del registro.
- **FR-041** Páginas en `src/app/(app)/m/<clave>/` (re-exportan de
  `src/modulos/<clave>/paginas/`), protegidas por `layout.tsx` con
  `exigirModulo()` → `notFound()`. APIs en `src/app/api/m/<clave>/` con
  `withModulo`. Guardarraíl en prueba: toda carpeta bajo `m/` tiene su guarda.
- **FR-042** `moduleTools` en `/api/brains/context`: solo de módulos efectivos.
- **FR-043** `POST /api/brains/tools/{name}` según contrato; tabla
  `brain_tool_call` para idempotencia de herramientas de `efecto: "escritura"`
  (retención 30 días).
- **FR-044** Nea: registro por turno inmutable (`REGISTRO` nativo + dinámicas
  validadas); `CrmClient.call_tool`; ruta en `RUTAS` de `crm_brains.py`.
- **FR-045** Módulo `diagnostico` (oculto a dueños, encendible solo por la
  agencia) con `diagnostico_eco` (lectura) y `diagnostico_marca` (escritura,
  idempotente, solo deja una nota de sistema en la conversación) para E2E.

## 8. Seguridad y aislamiento

| Riesgo | Mitigación |
|---|---|
| Inyección por descripción de herramienta | No hay herramientas del tenant (D13): nombre, descripción y esquema vienen de código revisado. |
| Inyección por descripción de campo de ficha | La escribe el dueño/agencia (misma confianza que `instructions`, que ya llega al prompt); aun así: ≤160 car., una línea, sin controles, dentro del esquema JSON de la herramienta y no en el chasis. |
| Inyección desde el lead vía valores de ficha | Ya existe hoy («Ficha actual» en el contexto); se mantiene: valores ≤500 car. serializados como JSON; el BLINDAJE los trata como datos. |
| Inyección vía resultado de herramienta | `result` ≤4 KB; Nea lo entrega como resultado de herramienta (rol `tool`), nunca en el sistema; los módulos devuelven datos, no instrucciones (revisión de código). |
| Colisión con nativas | El CRM exige prefijo `<modulo>_` y una lista de reservados (todas las nativas de Nea + `notas`); Nea vuelve a comprobar contra su registro real y descarta. Doble candado. |
| Herramienta de módulo apagado | Contexto: no se anuncia. Ejecución: el CRM recalcula módulos efectivos en cada llamada (no confía en lo anunciado) → 404 idéntico a inexistente. |
| Ruta `/m/...` sin módulo | `layout.tsx` con `exigirModulo` + `notFound()`; API con `withModulo`; prueba que recorre `src/app/(app)/m/*` y exige la guarda. |
| Cruce entre negocios | `organizationId` del ámbito de la credencial (`withBrain`); toda consulta del manejador recibe `organizationId` explícito; matriz A↛B en pruebas. |
| Payload grande | Cuerpo ≤16 KB (`leerCuerpoAcotado`); args validados con `zod` del módulo; `ficha_fields` ≤16 KB y `vertical_overrides` ≤8 KB con `check` en Postgres además de `zod`. |
| Lentitud / bloqueo del turno | Manejador con `AbortSignal` de 8 s → 504; Nea con `timeout` 10 s y `{"ok": false}` al modelo. |
| Efecto duplicado | `brain_tool_call` con `unique(organization_id, idempotency_key)`; clave = `sha256(dispatchId · nombre · args canónicos)`. |
| IA pausada | 409 `ai_paused` antes de ejecutar, igual que `ficha`/`stage`. |

## 9. Retrocompatibilidad (cero regresiones)

- **`single`**: `vertical_pack='default'`, `modules=[]` (H8), `moduleTools` nunca
  aparece; `fichaSchema` solo si el dueño define campos. Sin campos, todo
  igual que 2.11.0.
- **Negocios existentes**: la migración pone `default` y `null`; prueba de
  instantánea de nav, raíz y ficha sin pack.
- **Blueprint v1**: secciones nuevas opcionales; un Blueprint de la 071 aplica
  idéntico (pruebas existentes en verde sin cambios).
- **Nea**: dorados B0 intactos (sin `fichaSchema` ni `moduleTools`); dorados
  nuevos para «con esquema» y «con herramientas de módulo». Un CRM 2.11 (sin los
  campos) con una Nea 072 funciona igual que hoy; una Nea 2.11 con un CRM 072
  ignora los campos nuevos (aditivos).
- **`/api/brains/*`**: solo crece (`fichaSchema`, `moduleTools`, `ignored`, ruta
  nueva). Cabeceras, credencial `vocero:cerebro:v1` y despacho intactos.

## 10. Preparación verificada para la 073 (Eventos & Mobiliario)

Recorrido de punta a punta con el diseño de la 072, sin rediseño:

| Necesidad de la 073 | Pieza de la 072 que la cubre |
|---|---|
| Nicho visual (vocabulario, Inicio, ficha de evento) | Pack `eventos-mobiliario` (072-A) ya entregado |
| Datos del evento que el bot recolecta (fecha, invitados, tipo, dirección) | `fichaFields` de la semilla + «Datos por reunir» |
| Tablas `mob_articulo`, `mob_cotizacion`, `mob_cotizacion_linea` con `organization_id` | Módulo aislado en `src/modulos/mobiliario/` (072-B) |
| Pantallas de inventario y cotizaciones | `/m/mobiliario/...` con guarda |
| Entrada «Inventario» en el menú solo si está encendido | `modulo.nav` + experiencia resuelta |
| Sección «Cotizaciones» en la ficha lateral | `modulo.seccionesFicha` (registro cliente con `next/dynamic`) |
| Widget «Cotizaciones pendientes» | `modulo.widgets` |
| Bot consulta disponibilidad | `moduleTools` `mobiliario_disponibilidad` (`efecto: "lectura"`) |
| Bot genera y **envía** la cotización en PDF | `mobiliario_cotizar` (`efecto: "escritura"`): idempotente por `brain_tool_call`; si tarda, `estado: "en_curso"`; el CRM envía con `sendMediaMessage` (H12, ventana de 24 h); `result.enviadoAlCliente: true` para que el bot no lo repita |

**Lo que la 073 todavía tendrá que decidir** (no bloquea la 072): librería de
PDF (Principio II), atribuir el mensaje enviado al agente y no a un operador en
`sendMediaMessage`, y qué hacer fuera de la ventana de 24 h (plantilla o
`{ok:false, error:"fuera_de_ventana"}`).

## 11. Criterios de éxito

- **SC-1** Alta de un negocio de clínica desde plantilla ≤2 min en el panel; el
  mismo Blueprint por MCP en una sola llamada `apply_blueprint`.
- **SC-2** Capturas de staging de un negocio de cada pack muestran menú,
  Inicio y ficha lateral distintos; `default` idéntico a 2.11.0.
- **SC-3** En el Laboratorio, la persona «evento corporativo» termina con los 3
  obligatorios de la semilla en la ficha y **cero** preguntas repetidas (juez).
- **SC-4** Tokens del prompt con esquema de 20 campos: ≤ +900 tokens frente a
  la base (medido en la prueba de tamaño).
- **SC-5** E2E en staging: `diagnostico_eco` responde por Nea `multiorg`;
  `diagnostico_marca` repetido no duplica la nota; negocio sin módulo → 404.
- **SC-6** Gates: typecheck, lint, Vitest y pytest en verde en local; build y
  E2E en CI/staging.

## 12. Decisiones a aprobar

Ver tabla D1–D22 en [plan.md §1](plan.md#1-decisiones-técnicas-d1d22).
