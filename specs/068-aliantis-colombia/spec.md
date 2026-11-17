# Feature Specification: Marca Blanca Aliantis + Localización Colombia

**Feature Branch**: `068-aliantis-colombia`
**Created**: 2026-11-17
**Status**: Draft — diseño pendiente de aprobación (no se ha cambiado código)
**Carril**: **Ciclo completo** (Principio VI): toca el modelo de datos (default
de `calendar_settings.timezone`, migración aditiva `0027`) y agrega una
dependencia embebida (`libphonenumber-js`).
**Constitución**: 2.0.0 (Principios I, II, X, XI).
**Repos**: `vocero-crm` y `nea-agent`.

## Problema

Una instalación nueva se ve y se comporta como un producto mexicano llamado
Vocero: pesos mexicanos, fechas `es-MX`, hora del centro de México, teléfonos
que exigen código de país (y normalizan el `521` mexicano), un Laboratorio que
escribe "ke onda" y una demo con precios en MXN. Para Aliantis (Colombia) cada
negocio tendría que corregir todo eso a mano, y algunas cosas no se pueden
corregir desde la UI (formato de fechas, zona por defecto, el logo, los textos
que dicen "Vocero"). Además el valor regional está cableado en ~40 puntos,
contra el Principio XI.

## User Scenarios & Testing

### User Story 1 — La instancia nueva ya es Aliantis (Priority: P1)

Una agencia instala la plataforma y, sin configurar nada, ve la marca
Aliantis: nombre, logo chevron "A", acento azul `#0D3B9E`, favicon e icono de la
app. Ningún texto visible dice "Vocero".

**Why this priority**: es lo primero que ve un cliente; un nombre ajeno en la
UI rompe la venta de marca blanca.

**Independent Test**: base vacía → abrir `/login`, `/onboarding`, `/inbox`,
Ajustes y el Laboratorio: el título de la pestaña es "Aliantis — …", el logo es
la "A", y una búsqueda del texto "Vocero" en el DOM no encuentra nada.

**Acceptance Scenarios**:
1. **Given** una instancia sin marca guardada, **When** se abre cualquier
   pantalla, **Then** el nombre es "Aliantis", el acento `#0D3B9E` y el logo es
   la "A" (pierna izquierda en `currentColor`, pierna derecha `#10C4A5`).
2. **Given** un negocio que renombró su marca a "Ferretería Rojas", **When**
   abre la app, **Then** ve su inicial sobre su acento (no el logo de Aliantis).
3. **Given** el contrato con el cerebro, **When** se despacha un turno,
   **Then** las cabeceras siguen siendo `x-vocero-*` y la credencial derivada
   sigue usando `vocero:cerebro:v1` (pruebas gemelas sin cambios).

### User Story 2 — Dinero en pesos colombianos (Priority: P1)

El dueño registra montos y ve totales en COP con formato colombiano y sin
decimales: `$ 150.000`.

**Independent Test**: tablero con un lead de `15000000` centavos → la tarjeta
y el total de la columna muestran `$ 150.000`; Resultados muestra lo mismo.

**Acceptance Scenarios**:
1. **Given** una instancia sin moneda guardada, **When** se abre el tablero,
   **Then** la moneda es COP.
2. **Given** el dueño escribe `150.000` o `$150.000` o `150000` en el monto,
   **When** guarda, **Then** se almacena `15000000` (centavos) y se muestra
   `$ 150.000`.
3. **Given** un monto con centavos (p. ej. `1.234,56`), **When** se muestra en
   COP, **Then** se redondea al peso (`$ 1.235`) sin alterar lo guardado.
4. **Given** un negocio que eligió MXN o USD en Ajustes → Marca, **When** ve
   montos, **Then** conserva sus 2 decimales y su moneda.

### User Story 3 — La hora es la de Bogotá (Priority: P1)

Un negocio nuevo agenda y lee reportes en `America/Bogota`, y el agente (Nea)
dice "hora de Colombia".

**Independent Test**: organización nueva → Ajustes → Agenda muestra
`America/Bogota`; Resultados corta el día a medianoche de Bogotá; Nea sin
`AGENT_TIMEZONE` ni bloque `booking` usa `America/Bogota`.

**Acceptance Scenarios**:
1. **Given** una organización sin configuración de agenda, **When** se crea su
   `calendar_settings`, **Then** su zona es `America/Bogota`.
2. **Given** un negocio que ya tenía `America/Mexico_City` guardada, **When**
   se actualiza la plataforma, **Then** conserva su zona (la migración solo
   cambia el default).
3. **Given** Nea sin `AGENT_TIMEZONE`, **When** arma el prompt sin zona del
   CRM, **Then** usa `America/Bogota` y la etiqueta "hora de Colombia".

### User Story 4 — Teléfonos colombianos sin pelear con el formato (Priority: P2)

El dueño crea un contacto o importa un CSV con números locales de 10 dígitos
(`300 123 4567`, `(604) 444 5566`) y quedan guardados como `573001234567` /
`576044445566`. Los números internacionales (`+52 1 55…`, `+1 …`) siguen
funcionando.

**Independent Test**: importar un CSV con `3001234567`, `+57 300 123 4567`,
`573001234567`, `+52 1 55 1234 5678`, `12345` → los tres primeros resuelven al
**mismo** contacto `573001234567`, el mexicano a `525512345678`, y `12345` se
rechaza con motivo.

**Acceptance Scenarios**:
1. **Given** país por defecto CO, **When** se importa `3001234567`, **Then** se
   guarda `573001234567`.
2. **Given** un número local que no es válido en CO (p. ej. `5512345678`),
   **When** se importa, **Then** se rechaza con `sin_codigo_pais` (no se le pega
   el 57 a ciegas).
3. **Given** un número con `+` o con código de país, **When** se importa,
   **Then** se respeta su país; `521…` mexicano sigue canonizando a `52…`.
4. **Given** un mensaje entrante de WhatsApp, **When** se resuelve la
   identidad, **Then** el comportamiento es idéntico al actual (el `wa_id` de
   Meta ya trae país; no se reinterpreta con el país por defecto).

### User Story 5 — Laboratorio y demo colombianos (Priority: P2)

El Laboratorio prueba al agente con clientes que escriben como colombianos y
la demo muestra un negocio con precios en COP.

**Acceptance Scenarios**:
1. **Given** el Laboratorio, **When** corre la persona de modismos, **Then**
   escribe con modismos colombianos ("quiubo", "me regala", "de una", "parce")
   y su teléfono sintético es `57000000000N` (inválido en CO: jamás un número
   real).
2. **Given** la demo, **When** se siembra, **Then** sus precios están en COP,
   sus contactos tienen nombres y teléfonos sintéticos colombianos
   (`5700000001NN`), y la KB habla de envíos y precios en pesos colombianos.
3. **Given** dos organizaciones, **When** una siembra la demo, **Then** no
   borra ni toca contactos de la otra (hoy la limpieza borra por teléfono sin
   filtrar organización — se corrige aquí, Principio I).
4. **Given** una organización que ya tenía la demo mexicana, **When** vuelve a
   sembrar, **Then** se limpian también los contactos demo anteriores (lista de
   teléfonos heredados) y no quedan duplicados.

### Edge Cases

- Monto negativo o vacío: igual que hoy (`null` = sin monto).
- `REGION_*` con valor inválido (zona inexistente, locale raro): el arranque no
  se cae; se usa el default Colombia y `pnpm doctor` lo reporta.
- Un runtime sin datos ICU para `es-CO`: `formatMoneyCents` cae al formato de
  respaldo sin romper la pantalla (comportamiento actual).
- Conversaciones de prueba del Laboratorio con los teléfonos `521000…`
  anteriores: quedan como contactos `is_test` viejos; el reinicio del
  Laboratorio no los necesita.

## Requirements

### Functional Requirements

- **FR-001** Un único módulo de localización (`src/lib/region.ts`) expone los
  defaults de la instancia: país `CO`, locale `es-CO`, moneda `COP`, zona
  `America/Bogota`, configurables por entorno (`REGION_COUNTRY`,
  `REGION_LOCALE`, `REGION_CURRENCY`, `REGION_TIMEZONE`).
- **FR-002** Ningún componente ni módulo de servidor usa un literal regional
  (`es-MX`, `es-CO`, `MXN`, `COP`, `America/Mexico_City`, `America/Bogota`)
  fuera de `src/lib/region.ts`, `src/lib/money.ts` (catálogo) y los catálogos
  de selección; una prueba guardarraíl lo verifica escaneando `src/`.
- **FR-003** Los montos se guardan en centavos enteros (sin cambio) y se
  muestran con los decimales de pantalla de su moneda: 0 para COP (y las
  monedas sin fracción usual: CLP, PYG), 2 para el resto.
- **FR-004** `DEFAULT_BRANDING` es Aliantis (`name: "Aliantis"`, acento
  `#0D3B9E`); el primer preset es "Azul Aliantis"; el logo de plataforma es la
  "A" chevron; el favicon y el icono de la app la usan cuando el nombre es el
  de la plataforma.
- **FR-005** Ningún texto visible de la UI ni de mensajes al usuario dice
  "Vocero"; una prueba guardarraíl escanea `src/components` y `src/app`
  (strings y JSX, no comentarios) con una lista blanca explícita de
  identificadores técnicos.
- **FR-006** Los identificadores técnicos no cambian: `x-vocero-*`,
  `vocero:cerebro:v1`, `VOCERO_MODE`, `/vocero/dispatch`, `/vocero/ensayo`,
  claves de tema guardadas (`vocero`, `vocero-oscuro`), vendor de audio.
- **FR-007** `calendar_settings.timezone` tiene default `America/Bogota` en la
  base (migración aditiva `0027`); el código inserta siempre la zona explícita
  de `region.ts`.
- **FR-008** El alta manual y la importación CSV normalizan teléfonos con
  `libphonenumber-js` (metadatos `min`): con `+`/código de país → número
  posible en su país; sin código → número **válido** en el país por defecto.
  Salida: dígitos E.164 sin `+`, con la canonización mexicana `521→52` intacta.
- **FR-009** La identidad de mensajes entrantes (webhooks) no cambia.
- **FR-010** Nea usa `America/Bogota` como zona de respaldo (`DEFAULT_TZ`,
  `agent_timezone`, fallbacks de `tools.py` y `turn.py`, `.env.example`).
- **FR-011** Personas del Laboratorio y demo adaptadas a Colombia con
  teléfonos sintéticos inválidos (`570…`).
- **FR-012** La limpieza idempotente de la demo filtra por `organization_id` y
  limpia los teléfonos demo actuales y los heredados.

### Key Entities

- **Región de la instancia** (no persistida): país, locale, moneda, zona —
  desde entorno con default Colombia.
- **Marca** (`organization.metadata.branding`, sin cambio de forma): nombre,
  acento, moneda, favicon.
- **`calendar_settings.timezone`**: solo cambia el default de columna.

### Tenancy, Localización y Marca

- **Modo**: idéntico en `TENANCY=single` y `multi` (la bandera llega en 069).
  Los defaults son de instancia; moneda y zona ya son por organización (Marca
  y Agenda). Locale y país por organización quedan para 069 (ajustes de
  organización) — ver plan, D1.
- **Aislamiento**: corrige el borrado sin `organization_id` de la demo.
- **Nicho**: núcleo (localización y marca); la demo sigue siendo ferretería
  (un dato, no un nicho cableado).

## Success Criteria

- **SC-001** Con base vacía y sin variables `REGION_*`, la app muestra
  Aliantis, COP sin decimales, fechas `es-CO` y zona `America/Bogota`.
- **SC-002** Las pruebas guardarraíl de FR-002 y FR-005 pasan y fallan si se
  reintroduce un literal.
- **SC-003** Las pruebas gemelas del contrato (`despacho-contrato`,
  `olvido-contrato`, `openapi`, `tests/test_despacho_raiz.py`) pasan sin
  modificar sus fijaciones.
- **SC-004** `typecheck`, `lint`, Vitest y `pytest` en verde localmente;
  `build` y E2E en verde en CI/staging.

## Qué se decidió NO hacer (y por qué)

- **No renombrar identificadores técnicos `vocero*`** (FR-006): romperían a
  Nea y las preferencias de tema guardadas.
- **No convertir montos guardados**: COP se sigue guardando en centavos; solo
  cambia cómo se muestra. Migrar a "pesos enteros" cambiaría el contrato del
  DTO y la CAPI.
- **No ajustes de locale/país por organización en UI**: se modelan en 069 con
  el resto de la configuración de organización.
- **No reinterpretar identidades existentes**: un contacto `52…` o `521…`
  sigue resolviendo igual.
- **No cambiar el nombre de la demo** ("Ferretería El Martillo" funciona en
  Colombia y lo fijan pruebas existentes).
- **No tocar README/landing/documentación pública de marca** en esta fase.

## Assumptions

- La plataforma Aliantis usará una sola app de Meta (066); nada de 068 depende
  de ello.
- `libphonenumber-js` (MIT, sin red) cumple el Principio II como librería
  embebida.
