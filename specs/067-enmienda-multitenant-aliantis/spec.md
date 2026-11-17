# Propuesta de enmienda constitucional — SaaS Multi-Tenant Multi-Nicho Aliantis (1.4.0 → 2.0.0)

**Feature**: `067-enmienda-multitenant-aliantis` · **Creada**: 2026-11-17 ·
**Estado**: **RATIFICADA** por el responsable del proyecto el 2026-11-17, con
las seis decisiones de §6 resueltas, y **APLICADA** el mismo día —
constitución 1.4.0 → 2.0.0 con su Sync Impact Report, propagada a
`AGENTS.md`, `CLAUDE.md`, `.specify/templates/{plan,spec,tasks}-template.md`
y `specs/README.md`. Sin cambios de código en `src/` ni en `nea-agent/app/`.

**Carril**: gobernanza (Governance: "toda enmienda se propone por escrito
describiendo el cambio y su motivación, se aprueba por el responsable del
proyecto y se registra junto con el Sync Impact Report"). Mismo formato que
`specs/015-motor-agenda-universal/enmienda-constitucional.md`.

**Bump**: **MAJOR (1.4.0 → 2.0.0)** — redefine de forma incompatible el
Principio III ("cada instancia sirve a UN negocio"), el Principio VIII
("multi-instancia queda FUERA") y la restricción "el registro se cierra tras la
primera organización".

---

## 1. Problema

La constitución 1.4.0 describe un producto *self-hosted, una instancia = un
negocio*. El proyecto Aliantis necesita exactamente lo que hoy está prohibido:

| Necesidad Aliantis | Lo que hoy lo impide |
|---|---|
| Una instancia sirviendo a N negocios | Preámbulo y Principio III: "cada instancia sirve a UN negocio" |
| Panel de la agencia para dar de alta y operar organizaciones | Principio VIII: "Lo que solo sirva a una plataforma centralizada (billing, planes, multi-instancia) queda FUERA" |
| Alta de organizaciones después de la primera | Restricciones: "el registro se cierra tras la primera organización" |
| Una sola Nea en `VOCERO_MODE=cloud` atendiendo a todos | Principio II.3.4: "jamás credenciales de una plataforma central" (el secreto del despliegue del cerebro y la app de Meta de Embedded Signup son de plataforma) |
| Ferretería, clínica, alquiler de mobiliario… en el mismo producto | Principio VIII: foco en un dominio; sin regla sobre cómo crecer a varios nichos sin forks |
| Colombia como mercado | Nada lo impide, pero los defaults son mexicanos y no hay regla de localización |

Sin enmienda, cada spec de 068–071 violaría la constitución y tendría que
justificarse una y otra vez en *Complexity Tracking*. La enmienda pone la regla
una vez, con los mismos guardarraíles de aislamiento que ya existen
endurecidos.

## 2. Qué NO cambia

- **Principio I** (seguridad) — íntegro; se **endurece** (§3.2).
- **Principio IV** (idempotencia) — íntegro.
- **Principio VI** (specs antes de código, tres carriles) — íntegro.
- **Principio VII** (trazabilidad) — íntegro.
- **Principio II** — el núcleo sigue sin terceros obligatorios: Postgres +
  WhatsApp Cloud API + proveedor LLM opcional. S3/R2, email y **billing**
  siguen prohibidos en el núcleo.
- **El modo instancia sigue existiendo** (propuesta, ver §6 Q1): una
  instalación de un solo negocio se comporta exactamente como en 1.4.0.
- Los contratos con el cerebro (`/api/bot/*`, despacho, cabeceras
  `x-vocero-*`, `vocero:cerebro:v1`) no se rompen.

## 3. Cambios propuestos (texto por sección)

### 3.1 Preámbulo

**Hoy**:
> Vocero CRM es un CRM de WhatsApp con agente de IA, open source (MIT),
> self-hosted y gratuito, diseñado para que las agencias de IA lo desplieguen en
> el VPS de sus clientes: una instancia = un negocio.

**Propuesto**:
> El producto es un CRM conversacional con agente de IA, open source (MIT),
> que opera en uno de dos **modos de despliegue**, elegidos con una bandera de
> despliegue y nunca mezclados en una misma instancia:
>
> - **Modo instancia** (default): self-hosted, una instancia = un negocio. Es
>   el comportamiento de la 1.x y sigue siendo el default de una instalación
>   nueva.
> - **Modo plataforma**: una instancia operada por una agencia (p. ej.
>   **Aliantis**) sirve a N organizaciones aisladas entre sí, de uno o varios
>   nichos, con una marca de plataforma y la marca propia de cada negocio.
>
> Esta constitución define las reglas no negociables para ambos modos. Cuando
> una regla aplique a un solo modo, lo dice explícitamente.

### 3.2 Principio I — Seguridad de Datos Primero (endurecido)

Se reemplaza la viñeta condicional *"Si el producto es multi-tenant…"* (el
producto ya lo es) y se agregan tres viñetas:

> - Todo dato de una organización está aislado de las demás: ninguna consulta,
>   endpoint, evento SSE, archivo de medios, tarea en segundo plano ni
>   despacho al cerebro puede devolver o modificar datos de una organización
>   distinta a la del solicitante. El aislamiento se aplica por defecto.
> - **La organización se resuelve, nunca se supone.** Cada petición obtiene su
>   organización de una fuente autenticada (sesión, credencial derivada del
>   cerebro, identificador del canal en el webhook, o host/subdominio para
>   superficies públicas sin sesión). En modo plataforma está PROHIBIDO
>   resolver "la primera" o "la única" organización.
> - **Acceso de plataforma auditado.** Los operadores de la plataforma
>   (Super-Admin) pueden administrar organizaciones, pero todo acceso a datos
>   de una organización queda registrado (quién, cuándo, qué) y nunca expone
>   secretos de esa organización.
> - **Prueba de cruce obligatoria.** Toda superficie nueva que lea o escriba
>   datos de dominio lleva una prueba automática que demuestra que la
>   organización A no puede ver ni tocar datos de la organización B.

### 3.3 Principio II — Soberanía / Self-Hosted (aclarado)

Se mantiene la lista cerrada y las cinco condiciones de los conectores. Se
reescribe la condición 4 para distinguir credenciales de negocio y de
plataforma:

**Hoy**:
> 4. Credenciales del propio negocio, cifradas en reposo (Principio I): cada
>    instancia habla con SU cuenta del proveedor; jamás credenciales de una
>    plataforma central.

**Propuesto**:
> 4. **Credenciales por organización, cifradas en reposo** (Principio I): cada
>    organización habla con SU cuenta del proveedor. En modo plataforma, las
>    únicas credenciales compartidas admisibles son **del operador de la
>    plataforma** (la app de Meta del registro integrado, el secreto del
>    despliegue del cerebro), viven en la configuración de entorno del
>    operador, nunca se muestran a los miembros de una organización y nunca
>    permiten a una organización actuar sobre otra.

Y se añade al cierre del principio:
> - En modo plataforma, "self-hosted" significa: la plataforma corre en
>   infraestructura del operador (VPS de la agencia), con su propio Postgres y
>   su propia autenticación. Ninguna organización depende de un servicio de
>   terceros que no haya encendido como conector.
> - Una **librería embebida** (sin llamadas de red, p. ej. validación de
>   teléfonos) no es un servicio de terceros; entra con la justificación
>   normal de dependencias en el plan.

### 3.4 Principio III — Multi-Tenancy Real (redefinido)

**Hoy**:
> En Vocero cada instancia sirve a UN negocio, pero el modelo de datos es
> multi-tenant real (organización del plugin de auth) para mantener el
> aislamiento exigible y no cerrar la puerta a evoluciones.

**Propuesto**:
> El sistema sirve a organizaciones independientes desde una sola instancia
> lógica. En modo instancia hay una sola organización; en modo plataforma hay
> N. El modelo de datos y la capa de acceso son idénticos en ambos modos.
>
> - Cada organización (tenant) gestiona sus propios usuarios, roles y
>   permisos.
> - `organization_id` es parámetro de primer nivel: toda tabla de dominio lo
>   lleva NOT NULL e indexado org-first, y toda consulta pasa por `scoped()`.
> - Toda organización tiene un **slug único** generado al darla de alta; ningún
>   slug está cableado en el código.
> - En modo plataforma, **las organizaciones las crea la plataforma**
>   (Super-Admin o un flujo de alta controlado por ella), nunca un registro
>   público abierto.
> - Lo que hoy sea configuración global de la instancia y deba variar por
>   negocio (marca, moneda, idioma, zona horaria, destino del despacho,
>   banderas de módulos) se modela como **dato de la organización**, con el
>   valor de la instancia como default.

### 3.5 Principio VIII — Foco Vertical (redefinido)

**Título propuesto**: *VIII. Foco Vertical — CRM Conversacional, Multi-Nicho*

**Propuesto**:
> Es un CRM de conversaciones y leads que las agencias operan para negocios.
> No es plataforma de marketing masivo, ni constructor visual de flujos, ni
> herramienta de scraping. Lo que no ayude a *atender, organizar y convertir
> conversaciones de un negocio* se rechaza.
>
> - El dominio es el mismo para todos los nichos: contactos que escriben por
>   un canal, conversaciones con la ventana de su canal, leads en un pipeline,
>   un agente de IA que atiende con el conocimiento del negocio y escala a
>   humanos.
> - **Un nicho es una configuración, no un producto aparte** (Principio X).
> - Toda feature MUST servir a uno de: la agencia que opera la plataforma o la
>   instancia, o el negocio que opera su organización.
> - **Dentro del alcance** (nuevo): administrar varias organizaciones desde la
>   plataforma (alta, suspensión, marca, nicho, módulos) — en modo plataforma.
> - **Fuera del alcance** (sin cambios): broadcast masivo, scraping de números,
>   constructor visual de flujos genérico. **Billing y planes de cobro** siguen
>   fuera hasta una enmienda propia.

### 3.6 Principio X (nuevo) — Núcleo Inmutable, Nichos por Datos

> El núcleo es uno solo para todos los nichos y todas las organizaciones.
>
> - El núcleo (bandeja, ingesta, envío, pipeline, despacho, agenda,
>   Laboratorio, autenticación) **no contiene lógica de un nicho**: prohibido
>   ramificar por nombre de nicho u organización.
> - El comportamiento de un nicho se expresa, en este orden de preferencia:
>   1. **Datos** — un *Vertical Pack* versionado (etapas del pipeline, campos
>      personalizados, plantillas de conocimiento, personas del Laboratorio,
>      herramientas del agente habilitadas).
>   2. **Banderas por organización** guardadas en la base, que encienden o
>      apagan módulos para ese negocio (sin sustituir las banderas de
>      despliegue: un módulo apagado por despliegue está apagado para todos).
>   3. **Módulos aislados** — código propio de un nicho (p. ej. Alquiler de
>      Mobiliario) en su propia carpeta, con sus tablas (con
>      `organization_id`), sus rutas y sus herramientas; el núcleo no los
>      importa: los descubre por un registro. Apagado para una organización,
>      su superficie responde 404.
> - Un módulo de nicho jamás escribe en una tabla del núcleo saltándose su
>   puerta única (p. ej. `lead.stage_id` solo por `leads/stage-history.ts`).
> - **Los contratos con el cerebro son del núcleo**: el despacho, `/api/bot/*`,
>   `/api/brains/*`, las cabeceras `x-vocero-*` y el dominio de la credencial
>   derivada `vocero:cerebro:v1` solo crecen de forma aditiva. Un nicho que
>   necesite herramientas nuevas en el agente las expone por un mecanismo
>   aditivo y versionado, nunca cambiando la forma de lo existente.

**Rationale**: un fork por nicho es la forma en que ADR-001 vio morir la rama
`004-motor-agenda` en 26 días. Un núcleo único con nichos como datos mantiene
un solo lugar donde corregir un error de seguridad.

### 3.7 Principio XI (nuevo) — Localización y Marca como Datos

> - Moneda, idioma/formato regional, zona horaria y país por defecto para
>   teléfonos son **datos de la organización**, con default de la instancia
>   (configurable por entorno). Prohibido cablear `es-MX`, `MXN`,
>   `America/Mexico_City` u otro valor regional en componentes o lógica; se
>   consulta un único módulo de localización.
> - La marca (nombre, logo, colores, favicon, icono de la app) de la
>   plataforma y de cada organización es dato. **Ninguna marca cableada en la
>   UI** — tampoco la del proyecto de origen.
> - Los identificadores técnicos internos (nombres de cabeceras, dominios de
>   firma, variables de entorno, rutas de contrato) no son marca y no se
>   renombran por marca blanca.
> - Lo que el Laboratorio y la demo dicen (modismos, teléfonos sintéticos,
>   precios) sigue la localización de la organización.

### 3.8 Principios V y IX — dónde corre la verificación (aclaración)

Se añade a ambos, sin relajar el gate:
> - La verificación puede ejecutarse en el entorno de CI o en un entorno de
>   staging en lugar de la máquina del implementador, cuando el equipo local
>   no tenga capacidad (p. ej. `build` y E2E con navegador). La tarea no se
>   declara "Hecha" hasta que esa ejecución remota esté en verde, y el reporte
>   enlaza o cita su resultado. Lo verificado solo localmente se marca como
>   tal.

### 3.9 Restricciones de Plataforma y Seguridad

**Hoy**:
> el registro se cierra tras la primera organización (salvo habilitación
> explícita)

**Propuesto**:
> - Modo instancia: el registro público se cierra tras la primera
>   organización (salvo habilitación explícita). Sin cambios.
> - Modo plataforma: no hay registro público de organizaciones; las da de alta
>   la plataforma. Las superficies diseñadas para "la organización única" (hoy
>   `/api/bot/*`, que resuelve la primera organización) responden 404 en modo
>   plataforma; el cerebro usa la superficie por organización (`/api/brains/*`).
> - Las superficies públicas sin sesión (login, manifest, favicon, icono)
>   resuelven la organización por host/subdominio o muestran la marca de la
>   plataforma; nunca la de "la primera organización".

## 4. Criterios de aceptación de la enmienda

- **CA-1** `.specify/memory/constitution.md` dice `Version: 2.0.0`, con
  `Last Amended` igual a la fecha de ratificación y un *Sync Impact Report*
  1.4.0 → 2.0.0 que enumera cada cambio de §3.
- **CA-2** Los textos de §3.1–§3.9 están en la constitución tal como se
  ratifiquen (con las respuestas de §6 aplicadas).
- **CA-3** Propagación revisada y registrada en el Sync Impact Report:
  `AGENTS.md` ("Principios inviolables", "Invariantes"), `CLAUDE.md` ("Reglas
  de la constitución"), `.specify/templates/plan-template.md` (Constitution
  Check incluye X y XI y la prueba de cruce de tenant), `spec-template.md` y
  `tasks-template.md`, y `specs/README.md`.
- **CA-4** `nea-agent/CLAUDE.md` no requiere cambios (sus reglas de
  multi-organización ya son compatibles); se deja constancia.
- **CA-5** La enmienda no cambia código: `git diff --stat` del cambio solo
  toca documentación y plantillas; `typecheck` y Vitest siguen verdes.
- **CA-6** Este archivo pasa a **Estado: RATIFICADA** con fecha y nombre de
  quien ratifica, y **APLICADA** cuando CA-1..CA-5 se cumplen.

## 5. Qué se decidió NO hacer (y por qué)

- **No se elimina el modo instancia** (propuesto): conservarlo mantiene el
  fork cerca del upstream MIT y las pruebas existentes válidas.
- **No se admite billing** en esta enmienda: es un tercero con consecuencias
  de cumplimiento propias; merece su propia propuesta.
- **No se renombran contratos `vocero*`**: romperlos deja a Nea sin poder
  hablar con el CRM ("401 mudo en todo", `nea-agent/CLAUDE.md`).
- **No se define aquí el esquema del Vertical Pack ni de banderas por
  tenant**: es diseño de 071+, no gobernanza.

## 6. Decisiones (resueltas el 2026-11-17)

| # | Pregunta | Decisión ratificada |
|---|---|---|
| Q1 | ¿Se conservan los dos modos? | **Sí**: `single` y `multi`; Aliantis despliega en `multi` |
| Q2 | Bandera de modo | **`TENANCY=single\|multi`**, default `single` |
| Q3 | ¿Dónde vive el panel Super-Admin? | **En la misma app**, con un rol de plataforma separado del `owner` de una organización |
| Q4 | Marca/tenant sin sesión | **Subdominio** (`negocio.aliantis.co`) primero, con respaldo a la **marca Aliantis** en el dominio raíz; dominio propio por negocio en una fase posterior |
| Q5 | ¿El Super-Admin ve conversaciones? | **No por defecto**; solo con acceso explícito de soporte (motivo y caducidad) registrado en un log de auditoría |
| Q6 | Título de la constitución | **"Aliantis CRM Constitution"**; el aviso MIT original de `LICENSE` se conserva íntegro |
