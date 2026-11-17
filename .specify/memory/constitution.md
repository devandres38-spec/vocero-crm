<!--
SYNC IMPACT REPORT
==================
Versión: 1.4.0 → 2.0.0

Cambios (spec 067-enmienda-multitenant-aliantis, ratificada 2026-11-17):
  - Título: "Vocero CRM Constitution" → "Aliantis CRM Constitution". El aviso
    MIT original de LICENSE se conserva íntegro.
  - Preámbulo → REDEFINIDO: "una instancia = un negocio" pasa a dos modos de
    despliegue elegidos con la bandera TENANCY=single|multi (default single):
    modo instancia (comportamiento 1.x) y modo plataforma (N organizaciones).
  - Principio I → ENDURECIDO: la organización se resuelve de una fuente
    autenticada, nunca se supone; acceso de plataforma auditado; el
    Super-Admin no ve conversaciones salvo acceso de soporte explícito y
    registrado; prueba de cruce entre tenants obligatoria.
  - Principio II → ACLARADO: condición 4 distingue credenciales por
    organización y credenciales del operador de la plataforma; "self-hosted"
    en modo plataforma; librería embebida ≠ servicio de terceros.
  - Principio III → REDEFINIDO: N organizaciones en modo plataforma, slug
    único sin valores cableados, altas solo por la plataforma, configuración
    por negocio como dato de la organización.
  - Principio V → ACLARADO: la verificación puede correr en CI/staging.
  - Principio VIII → REDEFINIDO: "CRM Conversacional, Multi-Nicho";
    administrar varias organizaciones entra al alcance (modo plataforma);
    billing sigue fuera.
  - Principio IX → ACLARADO: el self-test en vivo puede correr en
    CI/staging cuando el equipo local no tiene capacidad.
  - Principio X (NUEVO): Núcleo Inmutable, Nichos por Datos.
  - Principio XI (NUEVO): Localización y Marca como Datos.
  - "Restricciones de Plataforma y Seguridad": registro por modo,
    `/api/bot/*` 404 en modo plataforma, resolución de marca sin sesión por
    subdominio con respaldo a la marca de plataforma.
  - Principios IV, VI, VII y Governance: íntegros.

Bump: MAJOR (1.4.0 → 2.0.0) — redefinición incompatible del Principio III
("cada instancia sirve a UN negocio"), del Principio VIII ("multi-instancia
queda FUERA") y de la restricción "el registro se cierra tras la primera
organización". Una instalación con TENANCY=single (default) conserva
exactamente la promesa de la 1.x.

Motivación:
  Proyecto Aliantis: operar el producto como SaaS multi-tenant multi-nicho de
  marca blanca para Colombia, con una sola instancia del CRM y una sola Nea en
  modo cloud. Propuesta por escrito y ratificación del responsable
  (2026-11-17): specs/067-enmienda-multitenant-aliantis/spec.md.

Plantillas dependientes:
  - .specify/templates/plan-template.md — ✅ actualizada: el Constitution
    Check enumera los gates de I–XI, incluida la prueba de cruce de tenant.
  - .specify/templates/spec-template.md — ✅ actualizada: sección de impacto
    en tenancy y localización.
  - .specify/templates/tasks-template.md — ✅ actualizada: tarea de prueba de
    cruce de tenant y nota de verificación local vs. CI/staging.
  - AGENTS.md — ✅ actualizado (Principios inviolables, Stack, Invariantes).
  - CLAUDE.md — ✅ actualizado (intro, Reglas de la constitución, Definición
    de Hecho).
  - specs/README.md — ✅ actualizado (067 y 068).
  - nea-agent/CLAUDE.md — ✅ sin cambios: sus reglas de multi-organización
    (conversación por organización+identidad, piensa el CRM, credencial
    derivada `vocero:cerebro:v1`) ya son compatibles.

TODOs diferidos:
  - Deuda documental heredada de la 1.3.0 (features entre `003` y la app 1.2.0
    sin spec): sigue igual.
  - Billing: fuera de alcance hasta una enmienda propia.
  - Dominio propio por organización: fase posterior a 069.
-->

# Aliantis CRM Constitution

Aliantis CRM es un CRM conversacional con agente de IA, derivado de un proyecto
open source (MIT), que opera en uno de dos **modos de despliegue**, elegidos con
la bandera `TENANCY` y nunca mezclados en una misma instancia:

- **Modo instancia** (`TENANCY=single`, default): self-hosted, una instancia =
  un negocio. Es el comportamiento de la 1.x y sigue siendo el default de una
  instalación nueva.
- **Modo plataforma** (`TENANCY=multi`): una instancia operada por una agencia
  (p. ej. **Aliantis**) sirve a N organizaciones aisladas entre sí, de uno o
  varios nichos, con una marca de plataforma y la marca propia de cada negocio.

Esta constitución define las reglas no negociables del producto en ambos modos;
cuando una regla aplica a un solo modo, lo dice explícitamente. Aplica a todas
las fases del flujo de trabajo (specify, plan, tasks, implement). Cualquier
conflicto entre una decisión de implementación y esta constitución SE RESUELVE
A FAVOR de esta constitución.

## Core Principles

### I. Seguridad de Datos Primero (NO NEGOCIABLE)

La protección de datos es la primera responsabilidad del sistema, por encima de
velocidad de entrega o conveniencia de desarrollo.

- Tokens, credenciales y secretos sensibles NUNCA se exponen al cliente (navegador,
  app, respuestas de API) ni se escriben en logs, trazas o mensajes de error.
- Todo secreto se almacena cifrado en reposo. Las claves de cifrado se gestionan
  fuera del código fuente y fuera del control de versiones.
- Todo dato de una organización está aislado de las demás: ninguna consulta,
  endpoint, evento en tiempo real, archivo de medios, tarea en segundo plano ni
  despacho al cerebro puede devolver o modificar datos de una organización
  distinta a la del solicitante. El aislamiento se aplica por defecto.
- **La organización se resuelve, nunca se supone.** Cada petición obtiene su
  organización de una fuente autenticada: la sesión, la credencial derivada del
  cerebro, el identificador del canal en el webhook o, para superficies
  públicas sin sesión, el host/subdominio. En modo plataforma está PROHIBIDO
  resolver "la primera" o "la única" organización.
- **Acceso de plataforma auditado.** Los operadores de la plataforma
  (Super-Admin) administran organizaciones (alta, suspensión, marca, nicho,
  módulos) pero NO ven conversaciones, contactos ni mensajes por defecto. Solo
  un **acceso de soporte explícito** —solicitado para una organización, con
  motivo y caducidad— lo permite, y cada acceso queda en un registro de
  auditoría (quién, cuándo, a qué organización, por qué). Ningún acceso de
  plataforma expone secretos de una organización.
- **Prueba de cruce obligatoria.** Toda superficie nueva que lea o escriba datos
  de dominio lleva una prueba automática que demuestra que la organización A no
  puede ver ni tocar datos de la organización B.

**Rationale**: Una fuga de credenciales o un cruce de datos entre clientes es un
fallo catastrófico e irreversible; prevenirlo siempre cuesta menos que remediarlo.
En una plataforma con N negocios, un solo cruce compromete a todos.

### II. Soberanía / Self-Hosted (ENDURECIDO)

El producto opera completo sobre la infraestructura del operador. La lista de
dependencias externas en runtime es CERRADA:

- Dependencias externas permitidas en runtime, ÚNICAMENTE:
  1. **WhatsApp Cloud API** (Meta Graph API) — el canal es la razón de ser del
     producto.
  2. **El proveedor LLM**, opcional, accedido EXCLUSIVAMENTE a través del adaptador
     OpenRouter-compatible (`OPENROUTER_BASE_URL` / `OPENROUTER_MODEL`). Sin token
     configurado, el producto funciona como CRM sin agente de IA.
  3. **Conectores opcionales**, únicamente bajo TODAS estas condiciones:
     1. **Apagados por defecto**: se encienden con una bandera de despliegue
        explícita (patrón ADR-001); una instancia default no los carga, no los
        menciona y no pide sus credenciales.
     2. **Aislados tras un adaptador dedicado** con contrato público estable,
        como el cliente Graph API y el adaptador LLM; el dominio no conoce al
        proveedor.
     3. **La instancia funciona completa sin ellos**: existe un camino sin
        dependencia externa para la misma capacidad (p. ej. el conector
        `enlace-fijo` de la agenda), y el fallo del proveedor degrada de forma
        definida — NUNCA bloquea ni pierde la operación core (la cita se crea
        con link pendiente; el mensaje se responde; el dato se guarda).
     4. **Credenciales por organización, cifradas en reposo** (Principio I):
        cada organización habla con SU cuenta del proveedor. En modo
        plataforma, las únicas credenciales compartidas admisibles son **del
        operador de la plataforma** (la app de Meta del registro integrado, el
        secreto del despliegue del cerebro): viven en la configuración de
        entorno del operador, nunca se muestran a los miembros de una
        organización y nunca permiten a una organización actuar sobre otra.
     5. **Verificables apagados y encendidos**: la CI ejercita ambas
        configuraciones y cada conector externo tiene mock con camino infeliz.
- **PROHIBIDO como dependencia del núcleo** (todo lo que el producto necesite
  para operar sin banderas): almacenamiento de objetos externo (S3/R2),
  servicios de email, billing (Stripe u otro) y cualquier servicio de terceros.
  Un servicio de terceros solo puede entrar como conector opcional bajo las
  cinco condiciones anteriores.
- Una **librería embebida** (código que corre dentro del proceso, sin llamadas
  de red; p. ej. validación de teléfonos) no es un servicio de terceros: entra
  con la justificación normal de dependencias en el plan.
- El instalador solo necesita: un VPS con Coolify o Docker, un dominio, credenciales
  de Meta y (opcional) un token de OpenRouter. Nada más.
- Las funciones core —autenticación y base de datos— corren self-hosted (Better
  Auth + PostgreSQL propios de la instancia). En modo plataforma, "self-hosted"
  significa: la plataforma corre en infraestructura del operador (VPS de la
  agencia), con su propio Postgres y su propia autenticación; ninguna
  organización depende de un servicio de terceros que no haya encendido como
  conector.
- Las integraciones externas permitidas se aíslan tras adaptadores dedicados
  (cliente Graph API propio; adaptador LLM) para no acoplar el dominio a ellas.

**Rationale**: Cada dependencia externa adicional es un costo, un punto de fallo
y una fuga de soberanía. Que el operador sea una agencia con N clientes no cambia
eso: lo multiplica.

### III. Multi-Tenancy Real

El sistema sirve a organizaciones independientes desde una sola instancia lógica.
En modo instancia hay una sola organización; en modo plataforma hay N. El modelo
de datos y la capa de acceso son idénticos en ambos modos.

- Cada organización (tenant) gestiona sus propios usuarios, roles y permisos.
- El identificador de tenant (`organization_id`) es un parámetro de primer nivel en
  el modelo de datos y en la capa de acceso a datos, no un campo opcional añadido a
  posteriori. Toda tabla de dominio lo lleva NOT NULL e indexado org-first, y
  toda consulta pasa por `scoped()`.
- Toda organización tiene un **slug único** generado al darla de alta; ningún
  slug está cableado en el código.
- En modo plataforma, **las organizaciones las crea la plataforma** (Super-Admin
  o un flujo de alta controlado por ella), nunca un registro público abierto.
- Lo que hoy sea configuración global de la instancia y deba variar por negocio
  (marca, moneda, idioma, zona horaria, destino del despacho, banderas de
  módulos) se modela como **dato de la organización**, con el valor de la
  instancia como default.

**Rationale**: Multi-tenancy diseñado desde el inicio evita reescrituras costosas y
hace cumplible el aislamiento del Principio I.

### IV. Idempotencia en Integraciones Externas

Todo evento entrante de un sistema externo (webhooks, callbacks, notificaciones de
terceros) se procesa de forma idempotente.

- Recibir el mismo evento dos o más veces NO duplica efectos observables (mensajes
  reenviados, registros duplicados, acciones del agente repetidas).
- Cada evento entrante se identifica de forma única (p. ej. `wa_message_id` UNIQUE)
  y su procesamiento se registra para detectar y descartar reintentos.

**Rationale**: Los proveedores externos reintentan entregas por diseño; sin
idempotencia, los reintentos corrompen datos y generan acciones duplicadas.

### V. Calidad Verificable Antes de "Hecho" (NO NEGOCIABLE)

Ninguna tarea se considera terminada sin pasar verificación.

- "Hecho" requiere, como mínimo: comprobación de tipos, lint y build; y tests donde
  apliquen al alcance de la tarea.
- Lo que NO se pueda verificar automáticamente se marca explícitamente como
  "pendiente de verificación humana"; no se reporta como completado sin esa marca.
- No se reporta una tarea como terminada describiendo que "debería funcionar": o pasa
  la verificación, o se declara su estado real (incluyendo fallos).
- La verificación puede ejecutarse en CI o en un entorno de staging en lugar de
  la máquina del implementador cuando el equipo local no tenga capacidad (p. ej.
  `build` y E2E con navegador). La tarea no se declara "Hecha" hasta que esa
  ejecución remota esté en verde, y el reporte cita su resultado. Lo verificado
  solo localmente se marca como tal.

**Rationale**: La verificación automática es la única definición de "hecho" que no
depende de optimismo.

### VI. Specs Antes de Código

Ninguna feature se implementa sin una especificación previa. La especificación
describe el comportamiento observable por el usuario, no la implementación.

El **carril** se elige y se declara ANTES de escribir código, y en los tres casos
la decisión queda por escrito:

- **Ciclo completo** (`specify → plan → tasks → implement`) — obligatorio cuando la
  feature toca el **modelo de datos** (cualquier migración) o un **contrato
  publicado** (`/api/bot/*`, `/api/brains/*`, el webhook, SSE, o un DTO que
  consuma algo fuera de este repo). Ahí el coste de equivocarse no lo paga quien
  programa: lo paga quien ya tiene datos guardados o un cliente conectado.

- **Carril ligero** (`spec.md` únicamente) — para features con comportamiento
  observable nuevo que NO tocan el modelo de datos ni un contrato. El `spec.md`
  MUST contener, y le basta con: qué problema resuelve, el comportamiento
  observable con criterios de aceptación verificables, y qué se decidió NO hacer y
  por qué.

- **Exento** — correcciones triviales y cambios sin comportamiento observable nuevo
  (typos, formato, refactors internos sin cambio de contrato, dependencias,
  herramientas de desarrollo).

Reglas que sostienen lo anterior:

- Si una feature del carril ligero descubre a mitad de camino que necesita una
  migración o cambiar un contrato, **sube de carril**: se escribe el plan antes de
  continuar, no después de terminar.
- Un spec escrito DESPUÉS de la implementación se marca visiblemente como tal en su
  encabezado. Es documentación, no diseño, y confundirlos hace creer a quien lo lea
  dentro de un año que esas decisiones se tomaron antes de programar.

**Rationale**: Especificar el comportamiento observable antes de codificar previene
retrabajo y mantiene alineadas todas las fases del flujo. Los tres carriles existen
porque un único ciclo, calibrado para una feature que define el producto entero, es
más ceremonia que trabajo en un cambio de doscientas líneas — y una regla que cuesta
más de lo que rinde no se discute: se erosiona en silencio, hasta que "specs antes de
código" significa "sin specs". Nombrar el escalón intermedio es lo que evita que el
siguiente paso hacia abajo sea ninguno.

### VII. Trazabilidad de Decisiones

Las decisiones tomadas sin contexto suficiente se documentan para revisión humana.

- Cuando una decisión se toma con información incompleta o supuestos no confirmados,
  se registra de forma visible (en el spec, el plan, el PR o un marcador
  `NEEDS CLARIFICATION` / TODO con responsable), no se entierra en el código.
- Los supuestos que condicionan el comportamiento se hacen explícitos para que un
  humano pueda revisarlos y revertirlos.

**Rationale**: Las decisiones implícitas bajo incertidumbre son la principal fuente
de deuda oculta; hacerlas visibles permite corregirlas a tiempo.

### VIII. Foco Vertical — CRM Conversacional, Multi-Nicho

Es un CRM de conversaciones y leads que las agencias operan para negocios. No es
plataforma de marketing masivo, ni constructor visual de flujos, ni herramienta
de scraping. Lo que no ayude a *atender, organizar y convertir conversaciones de
un negocio* se rechaza.

- El dominio es el mismo para todos los nichos: contactos que escriben por un
  canal, conversaciones con la ventana de su canal, leads en un pipeline, un
  agente de IA que atiende con el conocimiento del negocio y escala a humanos.
- **Un nicho es una configuración, no un producto aparte** (Principio X).
- Toda feature MUST servir a la agencia que opera la plataforma o la instancia,
  o al negocio que opera su organización.
- **Dentro del alcance** en modo plataforma: administrar varias organizaciones
  desde la plataforma (alta, suspensión, marca, nicho, módulos).
- **Fuera del alcance**: broadcast masivo, scraping de números, constructor
  visual de flujos genérico. **Billing y planes de cobro** siguen fuera hasta
  una enmienda propia.

**Rationale**: Un foco vertical explícito mantiene el modelo de datos alineado con el
negocio real y da un criterio claro para aceptar o rechazar alcance; abrirlo a
varios nichos sin abrirlo a cualquier cosa exige decir qué es igual en todos.

### IX. Verificación de Comportamiento en Vivo (NO NEGOCIABLE)

Complementa el Principio V. TODA feature con comportamiento observable —UI web,
mensajería, API o integración externa— se verifica ejerciendo ese comportamiento como
lo haría un usuario real antes de declararse "Hecha". El gate técnico (Principio V) es
el piso, no el techo.

- **Self-test + loop por el implementador (self-improvement loop).** Tras implementar,
  quien implementa ejecuta el self-test E2E —camino feliz Y camino infeliz (degradación
  sin colgarse)— y, si algo falla, diagnostica, corrige y re-verifica él mismo hasta
  verde. No se entrega trabajo a medio verificar ni se delega la prueba funcional al
  dueño. Lo único delegable a verificación humana es lo intrínsecamente no verificable
  por herramientas (juicio visual, aprobación de un tercero), marcado explícitamente.
- **Se conduce la interfaz real.** Navegador vía Playwright para features de UI; la línea
  del canal (p. ej. una API de WhatsApp de prueba) para mensajería; llamadas a la API
  donde esa sea la superficie. No basta con tipos/lint/build, ni con que un endpoint
  devuelva 2xx, ni con inspeccionar la base de datos: se observa el resultado de cara al
  usuario.
- **Local primero, nube después.** Si el comportamiento puede reproducirse en `localhost`
  —incluyendo integraciones externas vía túnel (p. ej. ngrok + handshake del webhook desde
  el panel del proveedor)—, SHOULD probarse ahí antes de desplegar. El deploy a la nube se
  reserva para lo que el entorno local no pueda reproducir, porque desplegar consume tiempo
  y reduce la agilidad del ciclo. Cuando el equipo local no tenga capacidad para el
  self-test (navegador, build de producción), se ejecuta en CI o staging con el mismo
  rigor (Principio V).
- **Guardarraíles con herramientas no oficiales.** Cuando la prueba use herramientas no
  oficiales vinculadas a un número/cuenta real, MUST respetarse reglas duras: enviar solo a
  destinatarios de una allowlist, NUNCA mensajes en ráfaga (anti-flood obligatorio), y
  minimizar el volumen. La integridad de la cuenta del operador es un activo a proteger, en
  línea con el Principio I.

**Rationale**: El gate técnico no detecta que un agente "se calló", que una tarjeta no
llegó como un solo mensaje, o que un botón de UI no disparó nada — eso solo aparece
ejerciendo el flujo real. Y el valor del paso no está solo en detectar el fallo sino en
cerrarlo: el implementador itera hasta verde en vez de devolver trabajo a medias. Probar
en local primero mantiene el ciclo ágil; y sin guardarraíles duros, una prueba con
herramientas no oficiales podría provocar un baneo irreversible.

### X. Núcleo Inmutable, Nichos por Datos

El núcleo es uno solo para todos los nichos y todas las organizaciones.

- El núcleo (bandeja, ingesta, envío, pipeline, despacho, agenda, Laboratorio,
  autenticación) **no contiene lógica de un nicho**: prohibido ramificar por
  nombre de nicho u organización.
- El comportamiento de un nicho se expresa, en este orden de preferencia:
  1. **Datos** — un *Vertical Pack* versionado (etapas del pipeline, campos
     personalizados, plantillas de conocimiento, personas del Laboratorio,
     herramientas del agente habilitadas).
  2. **Banderas por organización** guardadas en la base, que encienden o apagan
     módulos para ese negocio. No sustituyen las banderas de despliegue: un
     módulo apagado por despliegue está apagado para todos.
  3. **Módulos aislados** — código propio de un nicho (p. ej. Alquiler de
     Mobiliario) en su propia carpeta, con sus tablas (con `organization_id`),
     sus rutas y sus herramientas. El núcleo no los importa: los descubre por un
     registro. Apagado para una organización, su superficie responde 404.
- Un módulo de nicho jamás escribe en una tabla del núcleo saltándose su puerta
  única (p. ej. `lead.stage_id` solo por `leads/stage-history.ts`).
- **Los contratos con el cerebro son del núcleo**: el despacho, `/api/bot/*`,
  `/api/brains/*`, las cabeceras `x-vocero-*` y el dominio de la credencial
  derivada `vocero:cerebro:v1` solo crecen de forma aditiva. Un nicho que
  necesite herramientas nuevas en el agente las expone por un mecanismo aditivo
  y versionado, nunca cambiando la forma de lo existente.

**Rationale**: Un fork por nicho es la forma en que ADR-001 vio morir la rama
`004-motor-agenda` en 26 días. Un núcleo único con nichos como datos mantiene un
solo lugar donde corregir un error de seguridad.

### XI. Localización y Marca como Datos

- Moneda, idioma/formato regional, zona horaria y país por defecto para teléfonos
  son **datos de la organización**, con default de la instancia (configurable por
  entorno). Prohibido cablear un valor regional (`es-MX`, `MXN`,
  `America/Mexico_City`, `es-CO`, `COP`…) en componentes o lógica: se consulta un
  único módulo de localización.
- La marca (nombre, logo, colores, favicon, icono de la app) de la plataforma y
  de cada organización es dato. **Ninguna marca cableada en la UI** fuera del
  módulo de marca — tampoco la del proyecto de origen.
- Los identificadores técnicos internos (nombres de cabeceras, dominios de firma,
  variables de entorno, rutas de contrato) no son marca y no se renombran por
  marca blanca.
- Lo que el Laboratorio y la demo dicen (modismos, teléfonos sintéticos, precios)
  sigue la localización de la instancia o de la organización.

**Rationale**: Un valor regional cableado es una decisión de producto escondida
en un componente; centralizarlo es lo que permite servir a otro país o a otro
negocio sin buscar cadenas por todo el código.

## Restricciones de Plataforma y Seguridad

Estas restricciones derivan de los Principios I, II y III y son verificables en
revisión:

- **Gestión de secretos**: los secretos se inyectan vía configuración de entorno o un
  gestor de secretos; nunca se comprometen a control de versiones.
- **Cifrado en reposo**: credenciales y datos sensibles se almacenan cifrados; el
  almacenamiento en claro de secretos es una violación.
- **Frontera de tenant**: la capa de acceso a datos exige el identificador
  de tenant; cualquier acceso que pueda omitirlo requiere justificación explícita.
- **Aislamiento de integraciones**: las dependencias de APIs externas se acceden a
  través de adaptadores dedicados (cliente Graph API propio, adaptador LLM
  OpenRouter-compatible), no dispersas por el dominio.
- **Instancia pública endurecida**: las rutas de mock/desarrollo devuelven 404
  incondicional en producción y los entornos de prueba internos JAMÁS alcanzan la
  API real de WhatsApp.
- **Registro por modo**: en modo instancia, el registro público se cierra tras la
  primera organización (salvo habilitación explícita). En modo plataforma no hay
  registro público de organizaciones: las da de alta la plataforma.
- **Superficies de organización única**: lo diseñado para "la organización única"
  (hoy `/api/bot/*`) responde 404 en modo plataforma; el cerebro usa la superficie
  por organización (`/api/brains/*`).
- **Marca sin sesión**: las superficies públicas sin sesión (login, manifest,
  favicon, icono) resuelven la organización por subdominio
  (`negocio.<dominio-de-plataforma>`) y, en el dominio raíz o sin coincidencia,
  muestran la marca de la plataforma; nunca la de "la primera organización".
  El dominio propio por organización llega en una fase posterior.

## Flujo de Desarrollo y Puertas de Calidad

- **Orden del flujo**: depende del carril declarado (Principio VI). En el ciclo
  completo, `specify → plan → tasks → implement`, y cada fase consume el artefacto
  de la anterior. En el carril ligero, `specify → implement`.
- **Puerta constitucional (Constitution Check)**: se evalúa SIEMPRE, en los dos
  carriles — cambia dónde vive, no si ocurre. En el ciclo completo, en el plan:
  antes de la Fase 0 y de nuevo tras el diseño de la Fase 1. En el carril ligero,
  en el propio `spec.md`, antes de escribir código. Las violaciones se registran y
  justifican (Complexity Tracking en el ciclo completo, o una nota explícita en el
  spec) o se eliminan.

  El carril ligero ahorra ceremonia de planificación, NUNCA la revisión
  constitucional: los principios que más caro cuesta romper —aislamiento entre
  inquilinos, soberanía, idempotencia— se violan igual de fácil en doscientas
  líneas que en dos mil.
- **Puerta de calidad (Definición de "Hecho")**: tipos + lint + build en verde, y
  tests donde apliquen; lo no verificable automáticamente se marca como pendiente de
  verificación humana (Principio V). Para features con comportamiento observable de cara
  al usuario, "Hecho" exige además el self-test de comportamiento en vivo ejecutado por el
  implementador, con sus guardarraíles (Principio IX), localmente o en CI/staging.
- **Trazabilidad**: decisiones bajo incertidumbre y supuestos se documentan de forma
  visible (Principio VII), no en comentarios enterrados.

## Governance

Esta constitución es la autoridad máxima del proyecto. Prevalece sobre cualquier otra
práctica, convención o preferencia; ante un conflicto, gana la constitución.

- **Procedimiento de enmienda**: toda enmienda se propone por escrito describiendo el
  cambio y su motivación, se aprueba por el responsable del proyecto y se registra en
  el control de versiones junto con el Sync Impact Report actualizado.
- **Política de versionado** (semantic versioning de la constitución):
  - **MAJOR**: eliminación o redefinición incompatible de un principio o de la
    gobernanza.
  - **MINOR**: adición de un principio/sección nueva o expansión material.
  - **PATCH**: aclaraciones, correcciones de redacción y refinamientos no semánticos.
- **Revisión de cumplimiento**: cada PR y cada revisión de diseño verifican el
  cumplimiento de estos principios. La complejidad que viole un principio debe
  justificarse; si no, debe eliminarse.
- **Propagación**: al enmendar la constitución se revisan y, si procede, se actualizan
  las plantillas dependientes (plan, spec, tasks).

**Version**: 2.0.0 | **Ratified**: 2026-07-09 | **Last Amended**: 2026-11-17
