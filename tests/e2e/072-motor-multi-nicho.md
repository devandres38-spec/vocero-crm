# E2E 072 — Motor Multi-Nicho (rondas A y B)

Guion de comportamiento para **staging** (`TENANCY=multi`, Nea `multiorg` con
la 072). En local no se corre (PC de gama baja). Parte A: packs, ficha e
Inicio (2.12.0). Parte B: módulos y puente de herramientas (2.13.0).

Preparación: una cuenta Super-Admin, dos subdominios libres y la Nea de staging
asignada en `/platform/cerebros`.

## A1 — Un negocio `default` no cambia (regresión cero)

1. Entrar a un negocio que ya existía antes de la 2.12.0.
2. ✅ Menú: Bandeja · Pipeline · Contactos (· Citas) / Guía · Agente · Laboratorio / Resultados. Sin «Inicio».
3. ✅ `/` lleva a `/inbox` (o a `/onboarding` si falta la guía). `/inicio` → 404.
4. ✅ La ficha lateral de un contacto se ve como antes (editor libre); Ajustes muestra la entrada nueva «Ficha» y nada más cambia.

## A2 — Crear «Clínica Sol» desde plantilla

1. `/platform/nuevo` → pestaña **Nicho y ficha** → Plantilla «Clínica / Salud» → **Empezar desde esta plantilla**.
2. ✅ Agente «Sofía», trato *usted*, etapas «Nuevo · Valoración agendada · Valoración realizada · Tratamiento propuesto», 5 campos de ficha, FAQs y respuestas rápidas precargadas.
3. Escribir nombre y dirección (`clinica-sol`), dueño, **Revisar cambios** → ✅ secciones `vertical` y `fichaFields` «Se crea». **Crear negocio**.
4. Repetir el mismo Blueprint por MCP (`get_vertical_pack` → `plan_blueprint` sobre `clinica-sol`) → ✅ todas las secciones `sin_cambios`.

## A3 — La clínica se siente como software de clínica

1. Entrar a `clinica-sol` con la agenda encendida.
2. ✅ Menú: **Inicio** · Bandeja · **Valoraciones** · **Pacientes en proceso** · **Pacientes**; ícono de salud en Pacientes.
3. ✅ `/` → `/inicio`: tarjetas «Valoraciones de hoy», «Sin responder», «Pacientes en proceso», «Accesos rápidos».
4. ✅ Títulos: «Pacientes» en Contactos, «Valoraciones» en Citas; la ficha lateral se titula «Historia de contacto» con los 5 campos y su control (lista, sí/no…).

## A4 — Eventos: Inicio por fecha

1. Crear `eventos-andes` con la plantilla «Eventos y mobiliario».
2. En un contacto, poner «Fecha del evento» dentro de los próximos 30 días.
3. ✅ `/inicio` → «Eventos próximos» lo lista con la fecha (día y mes); menú con «Solicitudes» y «Clientes».

## A5 — El bot reúne los datos sin repetir (Nea 072)

1. Desde un WhatsApp de prueba a `eventos-andes`: «Hola, quiero cotizar sillas para un evento».
2. ✅ El agente pide la fecha, el tipo y los invitados **de a uno**, sin repetir lo ya dicho; si se le pide una cotización antes, no la condiciona.
3. Responder «unos 120 invitados» → ✅ la ficha lateral muestra «Número de invitados: 120» (número, no texto).
4. Responder una fecha imposible («30 de febrero») → ✅ el agente la repregunta una vez (`ignored` → `ignorados`).
5. ✅ Logs de Nea sin errores; `/api/brains/context` trae `fichaSchema`.

## A6 — Ajustes → Ficha (dueño)

1. Como dueño de `clinica-sol`: Ajustes → Ficha → agregar «Alergias» (Texto), guardar.
2. ✅ Aparece en la ficha lateral y en «Así lo ve el agente» si es obligatorio.
3. Cambiar el tipo de un campo guardado → ✅ el selector está bloqueado; por API, 409 `tipo_inmutable`.
4. Quitar un campo con valores → ✅ aviso; los valores pasan a «Otros datos».
5. Con acceso de soporte nivel `configuracion` → ✅ el PUT responde 403 (solo lectura).

## A7 — Laboratorio por nicho

1. Laboratorio de `clinica-sol` → nueva corrida.
2. ✅ Personas: paciente que pide valoración, precios y sedes, paciente molesto + hostil, pide humano, fuera del conocimiento, sin rumbo (7).
3. ✅ Un negocio `default` corre con las 8 de siempre.

## A8 — Aislamiento

1. ✅ Un usuario de `clinica-sol` no ve el Inicio ni los campos de `eventos-andes` (mismo navegador, otro subdominio: otra experiencia).
2. ✅ `PUT /api/settings/ficha-fields` en `clinica-sol` no cambia el contexto de `eventos-andes`.

---

# Parte B — Módulos y puente de herramientas (2.13.0)

Preparación: dos negocios de prueba, **A** (`diag-a`) y **B** (`diag-b`),
atendidos por la Nea `multiorg` de staging (con la 072-B) y con el agente
encendido. En A, encender el módulo oculto `diagnostico` por Blueprint (o el
MCP): `{"version": 1, "modules": {"modules": ["diagnostico"]}}`. B no lo
tiene. Las migraciones `0033_llamadas_de_herramienta` y `0034_llamadas_indices`
corren solas al arrancar.

## B1 — El marco de módulos en A

1. Entrar a `diag-a`.
2. ✅ El menú tiene «Diagnóstico» (después de Contactos/Citas); `/m/diagnostico` abre y lista `diagnostico_eco` (lectura) y `diagnostico_marca` (escritura).
3. ✅ En la Bandeja, la ficha lateral de un contacto tiene la sección «Diagnóstico» («El cerebro no ha dejado marcas…»).
4. Opcional: pedir `inicio.widgets` con `{"tipo": "diagnostico.estado"}` en los ajustes del nicho → ✅ el Inicio pinta la tarjeta «Diagnóstico».

## B2 — Nada de eso existe en B (A ↛ B)

1. Entrar a `diag-b`.
2. ✅ Sin «Diagnóstico» en el menú; `/m/diagnostico` → 404; la ficha lateral no tiene la sección.
3. ✅ `GET /api/m/diagnostico/marcas?conversationId=…` → 404 sin cuerpo.
4. ✅ `GET /api/brains/context` de una conversación de B no trae `moduleTools`; `POST /api/brains/tools/diagnostico_eco` con la credencial de B → 404 `tool_not_found` (el mismo cuerpo que una herramienta inexistente).
5. ✅ La credencial de A presentándose como B → 401.

## B3 — `diagnostico_eco` por Nea (SC-5)

1. Desde WhatsApp, escribirle a A: «prueba el diagnóstico con eco: hola».
2. ✅ El contexto de esa conversación trae `moduleTools` con las dos herramientas.
3. ✅ Nea llama `diagnostico_eco` (log de Nea / del CRM) y contesta con el texto de vuelta, sin nombrar la herramienta.
4. ✅ No queda fila en `brain_tool_call` (es de lectura).

## B4 — `diagnostico_marca` idempotente (SC-5)

1. Escribirle a A: «deja una marca de diagnóstico: prueba 1».
2. ✅ Aparece una nota interna «[Diagnóstico] prueba 1» en la conversación (el cliente no la ve) y la sección de la ficha cuenta 1.
3. Repetir a mano la MISMA llamada (mismo `conversationId`, `dispatchId` y `args`) contra `POST /api/brains/tools/diagnostico_marca`.
4. ✅ 200 con la misma respuesta; sigue habiendo UNA nota y una fila `hecha` en `brain_tool_call`.
5. ✅ El mismo `dispatchId` con otra conversación de A → 422 `despacho_desconocido`; un `dispatchId` de más de 24 h o de otro despliegue → 422 / 409 `cerebro_reasignado`.

## B5 — Pausa y límites

1. Tomar la conversación (handoff) y repetir la llamada → ✅ 409 `ai_paused`, sin nota nueva.
2. Cuerpo de más de 16 KB → ✅ 413. `args` con un campo de más → ✅ 422 `invalid_args` con `details.path`.
3. Apagar `diagnostico` en A (Blueprint `modules.modules: []`) → ✅ la siguiente llamada da 404 `tool_not_found`, el menú pierde la entrada y `/m/diagnostico` da 404 (sin redesplegar).

## B6 — Regresión cero

1. ✅ Un negocio sin módulos: menú, Inicio, ficha y contexto del cerebro idénticos a 2.12.0 (sin `moduleTools`).
2. ✅ El prompt de Nea en ese negocio no cambia (sin la línea de «herramientas propias»).
