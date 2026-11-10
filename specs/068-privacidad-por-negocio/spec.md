# Feature Specification: El filtro de privacidad de Aliantis y el perfil de privacidad de cada negocio

**Feature Branch**: `068-privacidad-por-negocio`

**Created**: 2026-11-10

**Status**: Especificada antes de escribir código. Aprobada por Andres el 2026-11-10, con P1 y P2 respondidas.

**Input**: paso 3.1 del plan maestro (`../../../RELEVO_ARQUITECTURA.md`, sección 9). Decisión D1 de Aliantis («filtro de privacidad en los dos lados, mismo módulo, prueba gemela»), aprobada el 2026-11-09 (`aliantis-core/docs/trabajo/decisiones.md`, «Plan de la adopción»). Brecha 1 de la auditoría.

**Carril**: ciclo completo (Principio VI). Toca el modelo de datos (migración `0027`: tabla `privacy_profile`) y fija dos formatos que comparten dos repos: el perfil exportado por el cerebro y los vectores de la prueba gemela.

**Subordinación**: este fork sigue los 6 pilares de Aliantis Core (`../../CLAUDE.md`). Las divergencias con la constitución de Vocero están en `plan.md` («Divergencias»).

## Contexto

Hoy Vocero guarda el texto del paciente **tal cual llega**: el payload entero de Meta en `webhook_event` y `message.text` crudo (brecha 1). La Ley 1581 y el pilar 4 exigen filtrar **antes de guardar**: un mensaje de salud queda solo como `[mensaje con información de salud omitido]` y correo, teléfono, documento y tarjeta se enmascaran.

El filtro ya existe y está medido: es `src/privacy/` de `aliantis-core`, trasplantado tal cual al cerebro en el paso 2.1 (149 pruebas, corpus con 100 % de detección de salud). Lo que filtra depende de **cada negocio**: qué listas de salud usa su tipo de negocio (general, clínica, dental, o ninguna), qué nombres de servicio no cuentan como salud («férula para bruxismo») y de qué país son sus teléfonos. En el cerebro eso sale de la configuración del cliente (`cliente.yaml` + `perfiles/`). Vocero no tiene nada de eso.

Este paso construye **la herramienta**, sin conectarla todavía:

1. el mismo módulo de filtro dentro de Vocero, probado contra el cerebro con vectores gemelos;
2. el **perfil de privacidad** de cada negocio guardado en Vocero, que sale del cerebro y solo Andres registra.

El paso 3.2 lo conecta a `guardarEvento` y a `ingestInboundMessage`, y llena las marcas del despacho. Por eso **en 3.1 no cambia nada de lo que se ve ni de lo que se guarda**.

> **Nombre:** se dice «perfil de privacidad» y no «política» para no confundirlo con la política de privacidad del negocio (el enlace legal `{politica_privacidad}` del aviso). En el código copiado del cerebro el tipo sigue llamándose `PrivacyPolicy`.

## Decisiones

- **D1. El mismo módulo, no uno parecido.** Los tres archivos del cerebro (`normalize-text.ts`, `health-terms.ts`, `privacy-filter.ts`) se copian a `src/server/privacy/` con el mismo comportamiento. Solo cambian el formato (Prettier de Vocero), las rutas de importación y `privacyPolicyFor`, que en Vocero no existe porque no hay `ClientConfig` (D2). Los nombres se conservan para comparar los dos lados línea por línea.
- **D2. El perfil de cada negocio sale del cerebro.** Las listas de salud y los perfiles por tipo de negocio viven **solo** en `aliantis-brain/perfiles/`. El cerebro exporta el perfil ya resuelto de un cliente (`npm run privacidad:exportar -- <cliente.yaml>`) y Vocero lo registra (`pnpm privacidad:sembrar -- --organizacion <id> <perfil.json>`). Una sola fuente: si las listas se copiaran a Vocero, tarde o temprano dirían cosas distintas.
- **D3. Sin perfil, no hay revisión.** Leer el perfil de un negocio devuelve el perfil **o nada**: si no existe, no pasa la validación o su huella no cuadra, la respuesta es «no hay». Nunca un perfil vacío ni un filtro apagado por defecto. En 3.2, «no hay» significa que el texto no se guarda (`withoutReview`, salvo los botones del consentimiento), igual que en el cerebro.
- **D4. Apagar el filtro de salud es explícito.** Un perfil con `sensible: null` (salud apagada, como la barbería de demo) solo se registra con la bandera `--sin-filtro-salud`, y solo después de la revisión del abogado. Correo, teléfono, documento y tarjeta se enmascaran siempre.
- **D5. Solo Andres lo registra.** Sin pantalla, sin ruta de API y sin acceso del rol del negocio: un comando que corre Andres. El rol del negocio nunca ve ni cambia su perfil de privacidad (pilar 1, el mismo matiz de D3 sobre las llaves de IA). Cuando exista el panel de Andres (paso 4.6), el alta lo llamará desde ahí.
- **D6. Huella.** Cada perfil lleva `huella`: SHA-256 del JSON canónico de lo que decide el filtro (`pais`, `permitidos`, `sensible`). El cerebro la calcula al exportar; Vocero la recalcula al registrar y al leer, y si no cuadra, rechaza (D3). Los dos comandos la muestran, para comparar a ojo.
- **D7. Gemelos de verdad.** El cerebro genera los vectores (`npm run privacidad:vectores`): texto, perfil y resultado esperado, salidos de **su** implementación. El mismo archivo vive en los dos repos y cada uno prueba que su código da exactamente esos resultados. Las dos pruebas fijan la huella SHA-256 del archivo y la versión de `libphonenumber-js` con la que se generó: cambiar un lado sin el otro rompe una prueba, no una instalación.
- **D8. `libphonenumber-js` con la misma versión exacta** en los dos repos (`1.13.15`, sin `^`). Sus metadatos deciden qué es un teléfono; una versión distinta podría enmascarar distinto.

## User Scenarios & Testing

### Historia 1. El mismo texto da el mismo resultado en Vocero y en el cerebro (P1)

Como Andres, quiero que el filtro de Vocero y el del cerebro den exactamente el mismo resultado, para que la defensa doble (D1 de Aliantis) no tenga huecos.

**Prueba independiente**: los vectores gemelos corren en los dos repos.

1. **Dado** el archivo de vectores generado por el cerebro, **cuando** corre la prueba gemela en Vocero, **entonces** cada caso da el mismo `text`, `health`, `masked` y las mismas marcas (`privacyFlagsOf`).
2. **Dado** que alguien cambia el filtro en un solo repo, **cuando** corren las pruebas, **entonces** falla la prueba gemela de ese repo.
3. **Dado** el corpus del cerebro (`privacy-corpus.test.ts`), **cuando** se filtra en Vocero, **entonces** detecta el 100 % de los mensajes con salud y marca por error como máximo el 5 % de los que no tienen (las metas de `aliantis-core`).

### Historia 2. Andres registra el perfil de privacidad de un negocio (P1)

Como Andres, al dar de alta un negocio quiero registrar en Vocero el mismo perfil que usa su cerebro, con un comando y sin copiar listas a mano.

1. **Dado** `clientes/demo/cliente.yaml` en el cerebro, **cuando** Andres corre `npm run privacidad:exportar -- clientes/demo/cliente.yaml > demo.json` y en Vocero `pnpm privacidad:sembrar -- --organizacion <id> demo.json`, **entonces** queda un perfil para esa organización y el comando muestra su perfil (`odontologia`), su versión y su huella, la misma que mostró el cerebro.
2. **Dado** un negocio que ya tenía perfil, **cuando** se registra otro, **entonces** reemplaza al anterior y el comando muestra la huella anterior y la nueva.
3. **Dado** un archivo editado a mano (un término cambiado), **cuando** se registra, **entonces** se rechaza porque la huella no cuadra, y no cambia nada.

### Historia 3. Un negocio sin perfil no queda sin filtro (P1)

1. **Dado** un negocio sin perfil registrado, **cuando** se pide su perfil, **entonces** la respuesta es «no hay», nunca un perfil vacío.
2. **Dado** un perfil guardado que ya no pasa la validación (fila alterada en la base), **cuando** se pide, **entonces** la respuesta es «no hay» y queda un log de error **sin** el contenido del perfil.

### Historia 4. Salud apagada solo por decisión explícita (P2)

1. **Dado** el perfil exportado de `demo-barberia` (`sensible: null`), **cuando** se registra sin `--sin-filtro-salud`, **entonces** se rechaza con un mensaje que explica por qué.
2. **Dado** el mismo perfil **con** la bandera, **entonces** se registra, y al filtrar se siguen enmascarando correo, teléfono, documento y tarjeta.

### Historia 5. Dos negocios, dos perfiles (P1)

1. **Dado** un consultorio dental y una barbería, cada uno con su perfil, **cuando** se pide el perfil de uno, **entonces** nunca llega el del otro: la consulta va con `scoped(organizationId)`.

### Casos borde

- **Cambian los servicios del cliente en el cerebro** (un sinónimo nuevo): el perfil de Vocero queda viejo hasta que Andres lo vuelve a exportar y registrar. El efecto de un perfil viejo: con menos «permitidos» se omite de más (lado seguro); con listas de salud viejas se podría dejar pasar un término nuevo, y el cerebro lo vuelve a filtrar como defensa. Ver P1 en «Preguntas para Andres».
- **El archivo trae una clave de más, un término con tildes o mayúsculas, un país inválido o una categoría de salud desconocida**: se rechaza (zod estricto, las mismas reglas de `profile.ts` del cerebro).
- **La organización no existe**: error claro, nada se guarda.
- **El módulo termina en el navegador**: `libphonenumber-js/max` pesa y el filtro es del servidor. Un escaneo prueba que ningún componente de cliente importa `@/server/privacy`.
- **La instalación de demo** (`pnpm seed:demo`): siembra el perfil de la demo dental, para que el paso 3.2 no deje la demo sin texto.

## Requirements

### Funcionales

- **FR-001** `src/server/privacy/` con `normalizeForMatching`, `findHealthTerms`, `isNormalizedTerm`, `classifyAndMask`, `withoutReview`, `privacyFlagsOf`, `HEALTH_OMITTED_TEXT` y `UNREVIEWED_TEXT`, con el comportamiento del cerebro (D1).
- **FR-002** Tabla `privacy_profile`, un perfil por organización (ver `data-model.md`).
- **FR-003** `perfilDePrivacidad(organizationId)`: devuelve `PrivacyPolicy` o `null` (D3). Valida con zod y recalcula la huella al leer.
- **FR-004** `pnpm privacidad:sembrar -- --organizacion <id> [--sin-filtro-salud] <archivo.json>`: valida contra `contracts/perfil-privacidad.md`, recalcula la huella, reemplaza el perfil de esa organización y muestra perfil, versión, huella anterior y nueva. Nunca imprime los términos.
- **FR-005** En el cerebro: `npm run privacidad:exportar -- <cliente.yaml>` escribe el perfil resuelto en la salida estándar (formato del contrato) y la huella en la salida de errores.
- **FR-006** En el cerebro: `npm run privacidad:vectores` regenera `test/fixtures/privacidad-vectores.json` (formato en `contracts/vectores-gemelos.md`).
- **FR-007** Prueba gemela en los dos repos sobre el mismo archivo de vectores, con su huella y la versión de `libphonenumber-js` fijadas (D7, D8).
- **FR-008** `pnpm seed:demo` registra el perfil de la demo dental desde `src/server/privacy/perfil-privacidad-demo.json`, exportado del cerebro, solo si la organización no tenía uno. La carga de la demo desde la app (`POST /api/seed/demo`) no lo toca (D5; ver `plan.md`, «La demo»).
- **FR-009** Nada de este paso cambia la ingesta, el despacho, la bandeja ni ninguna respuesta de la API.

### Entidades

- **Perfil de privacidad** (`privacy_profile`): qué listas de salud usa un negocio (o ninguna), qué frases de sus servicios no cuentan como salud, su país y la huella de todo eso.

## Success Criteria

- **SC-001** La prueba gemela pasa en los dos repos con **todos** los vectores (el corpus completo del cerebro más los casos borde de `contracts/vectores-gemelos.md`).
- **SC-002** Revisión completa de Vocero en verde (`pnpm typecheck && pnpm lint && pnpm build && pnpm test`) y `npm run revisar` del cerebro en verde, dichas con números.
- **SC-003** Todos los sabotajes de `plan.md` detectados.
- **SC-004** La migración aplica sobre la base de desarrollo con datos (`pnpm db:migrate`) y la app arranca igual que antes.
- **SC-005** El perfil exportado de `clientes/demo` se registra en Vocero con la misma huella que mostró el cerebro.

## Preguntas para Andres (respondidas el 2026-11-10)

- **P1. ¿La huella del perfil viaja en el despacho?** **Respuesta de Andres: sí, en el paso 3.2.** Recomendado: **sí, en el paso 3.2**, como llave nueva y aditiva del despacho (`privacyProfileHash`), que solo viaja si el negocio tiene perfil, igual que `test`. El cerebro la compara con la huella de su propia configuración: si no cuadran, deja un log de advertencia (sin contenido) y sigue, porque él vuelve a filtrar como defensa. Así un perfil viejo en Vocero se nota el primer día y no cuando un dato se escape. La alternativa es comparar las huellas solo a ojo al registrar.
- **P2. ¿Dónde guardar el JSON exportado de un cliente real?** **Respuesta de Andres: en ninguna parte;** solo el de la demo queda en el repo. Recomendado: **en ninguna parte**. Se exporta, se registra y se borra. No es secreto (son listas y nombres de servicios), pero tampoco hace falta guardarlo, porque se regenera del `cliente.yaml`. Solo el de la demo queda en el repo (FR-008).

## Lo que esta spec NO hace

- **No conecta el filtro a la ingesta** ni llena `message.privacy_flags`: eso es el paso 3.2 (con sus sabotajes «guardar crudo», «olvidar `webhook_event`» y «falla de configuración que no omite el texto»).
- **No filtra el Laboratorio, la ficha ni las notas**: pasos 3.2 y 3.6.
- **No agrega adjuntos ni retención por negocio** (D11 y D21, pasos 3.3 y 3.9). Son ajustes del mismo negocio y pueden vivir en esta tabla; se deciden en su spec.
- **No crea pantalla ni API** para el perfil (D5).
- **No trae RLS:** la tabla nace con `organization_id` y `scoped()`, y entra en las políticas del paso 4.5 como las demás.
