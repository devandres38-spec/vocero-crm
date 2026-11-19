# Implementation Plan: Motor Multi-Nicho (072)

**Spec**: [spec.md](spec.md) · **Contratos**: [brains-072](contracts/brains-072.md) ·
[blueprint-072](contracts/blueprint-072.md) · [vertical-packs](contracts/vertical-packs.md)
**Rama**: `feat/072-motor-multi-nicho` en `vocero-crm` y `nea-agent` (desde `main`:
`e6d25ff` / `644d77f`).
**Estado**: D1–D22 aprobadas (2026-11-19). Ronda 072-A en curso.

## 1. Decisiones técnicas (D1–D22)

| # | Decisión propuesta | Alternativa descartada | Por qué |
|---|---|---|---|
| **D1** | **Una spec, dos rondas fusionables por separado**: 072-A (packs, ficha flexible, plantillas, personas, `/inicio`) → 2.12.0; 072-B (marco de módulos, puente `moduleTools`, idempotencia, `diagnostico`) → 2.13.0. Cada una con su staging y merge. | (a) Los 4 pilares en un merge. (b) Partir en 072/073 y mover Eventos a 074. | (a) Una regresión del puente bloquearía plantillas que ya venden. (b) Válida, pero renumera el roadmap y separa el diseño del puente del de los packs. **Si producto prefiere (b), el contenido no cambia, solo la numeración.** |
| **D2** | **Pack ≠ Módulo.** Pack = presentación + semilla (datos), `organization.vertical_pack`. Módulo = capacidad con código (tablas, rutas, herramientas), `organization.modules.modules`. Un pack *recomienda* módulos. | Pack que contiene rutas y herramientas. | Una clínica puede querer el cotizador sin cambiar de nicho; un módulo sirve a varios nichos (trampa T10). |
| **D3** | Packs como **datos TypeScript tipados en `src/verticals/`**, versionados con el código; **un solo nivel de herencia**: todo pack = `extenderPack(PACK_DEFAULT, parcial)`; arrays reemplazan, objetos se mezclan 1 nivel. | Packs en BD editables; cadenas de herencia (`salud → dental → …`). | Type-safety, revisión de código, pruebas; sin T3. Lo editable por negocio va en D5. |
| **D4** | **Puntos de extensión aditivos, no reemplazo de vistas**: nav = modelo de datos (`appNavGroups(experiencia)`), Inicio = catálogo de widgets, Ficha lateral = panel del núcleo con campos tipados + secciones de módulo. | Slots que reemplazan Shell/Nav, Inicio y Ficha por pack. | Reemplazar es un fork dentro del repo (T2): el Shell trae atajos, avisos, soporte, offline; la ficha trae SSE y guardado. |
| **D5** | **Override por negocio = solo datos**: `organization.vertical_overrides` jsonb (`vocabulario`, `nav.ocultas`, `nav.orden`, `inicio.widgets`), `zod .strict()`, ≤4 KB, escrito solo por la agencia. | `src/verticals/<slug-del-cliente>/` con código. | T1: código por cliente no escala ni se prueba. Si un cliente necesita código, es un módulo o un pack. |
| **D6** | **Tema**: sin capa nueva de tokens. El pack sugiere `appearance` en su semilla y puede **aportar temas al catálogo global `TEMAS`** (pasan la prueba de contraste). El acento sigue siendo de la marca. | Tokens CSS por pack encima de 062. | Ya hay tres capas (tema, default del negocio, cookie personal); una cuarta rompe la precedencia y las pruebas de contraste (H10). |
| **D7** | **`/inicio` es página del núcleo**; solo existe en el menú y como destino de la raíz si el pack define `inicio`. `default` no lo define → raíz y menú idénticos a 2.11.0. | Inicio para todos. | Cero regresión para negocios actuales; se puede encender en `default` después. |
| **D8** | **Vocabulario acotado** a un diccionario cerrado (`contacto/s`, `lead/s`, `pipeline`, `cita/s`, `bandeja`, `ficha`, `inicio`, `resultados`, `agente`, `etapa`) aplicado solo a nav, `<h1>`, estados vacíos de esas páginas y título del panel de ficha. | Vocabulario en toda la UI. | T4: es i18n disfrazado; 400 textos a medias. |
| **D9** | **Ficha flexible = esquema sobre `contact.ficha`**: definiciones en `organization.ficha_fields` jsonb (≤20 campos); los valores siguen en `contact.ficha`. Clave inmutable; quitar un campo no borra valores. | (a) `contact.custom_fields` nuevo. (b) Tabla `ficha_field`. | (a) Dos verdades (T5); Nea ya escribe `ficha`. (b) Sobre-diseño para ≤20 filas que se editan y reemplazan en bloque (UI, Blueprint). |
| **D10** | **Validación tipada floja**: claves del esquema se coercionan; inválidas → `ignored[{key, reason}]` (aditivo), sin 422; claves fuera del esquema → normalización actual; `required` nunca bloquea una escritura. | 422 por valor inválido. | El LLM deriva; tirar datos de calificación cuesta conversaciones (misma filosofía de `server/bot/ficha.ts`). |
| **D11** | **Nea, esquema dinámico**: con `fichaSchema.fields` no vacío, `update_ficha` = campos + `notas`; sin esquema, el B2B de hoy byte a byte. «Datos por reunir»: ≤3 obligatorios faltantes, en orden, subordinada a la prioridad de agenda. | Mezclar B2B + campos; listar todos los faltantes. | El B2B confunde a una clínica (H4); 3 bastan para guiar sin inflar el prompt (T8). |
| **D12** | `fichaSchema` aditivo en **`/api/brains/context` y `/api/bot/context`**; **no** se envía el id del pack a Nea. | Solo en `brains`; mandar `vertical` a Nea. | `single` también se beneficia; Nea no debe ramificar por nicho (Principio X en el cerebro también). |
| **D13** | **`moduleTools`** (no `customTools`): solo definidas por código de módulos del CRM. Nombre `^[a-z][a-z0-9_]{2,47}$` con prefijo `<modulo>_`; ≤8 por negocio; esquema ≤4 KB c/u, ≤12 KB total; reservados = nativas de Nea + `notas`. | Herramientas/webhooks definidos por el tenant. | T6: elimina SSRF e inyección por descripción; el nombre evita prometer lo que no hay. |
| **D14** | **`POST /api/brains/tools/{name}`** con `withBrain`; cuerpo `{conversationId, dispatchId, args}` ≤16 KB; módulo efectivo recalculado; 409 `ai_paused`; `AbortSignal` 8 s → 504; respuesta ≤4 KB. **Idempotencia** para `efecto:"escritura"` en tabla `brain_tool_call` (`unique(org, idempotency_key)`, clave = `sha256(dispatchId·name·args canónicos)`), retención 30 días. Admite `estado:"en_curso"` para trabajo largo. | Sin idempotencia; clave por `tool_call.id` del LLM. | T7: el `tool_call.id` cambia si el turno se reintenta tras *lease* vencido; `dispatchId` + args no. |
| **D15** | **Nea: registro por turno inmutable** = `REGISTRO` nativo + dinámicas validadas del contexto. Clave `modulo:<m>`; `permite()` de perfil y rol aceptan claves `modulo:*` *si vinieron en el contexto de este turno* (el CRM ya filtró). Nunca se muta `REGISTRO`. | Registrar en el `REGISTRO` global. | Estado compartido entre negocios (lo que la 071 eliminó); H6/H7. |
| **D16** | **Rutas de módulo como carpetas reales** `src/app/(app)/m/<modulo>/` que re-exportan de `src/modulos/<modulo>/paginas/`, guardadas por `layout.tsx` con `exigirModulo()` → `notFound()`; APIs en `src/app/api/m/<modulo>/` con `withModulo`; prueba-guardarraíl. | Catch-all `/m/[...slug]` con registro en tiempo de ejecución. | Carpetas reales conservan `params` tipados, `loading`/`error`/`metadata` por ruta y división de código de Next; el catch-all no da nada que no dé el router. |
| **D17** | **Bundle**: la experiencia resuelta es un objeto serializable que baja por props (packs = datos, 0 KB en cliente); las piezas cliente de módulos se cargan por `next/dynamic` desde `src/modulos/registro-cliente.ts` (único import del núcleo hacia módulos en cliente). | Importar componentes de pack directamente en el Shell. | Un nicho no paga el JS de otro. |
| **D18** | **Módulo `diagnostico`** (oculto a dueños, solo la agencia lo enciende) con `diagnostico_eco` (lectura) y `diagnostico_marca` (escritura idempotente: nota de sistema en la conversación). | Herramienta de prueba en el núcleo. | E2E real del puente sin lógica de la 073 y sin ensuciar el núcleo. |
| **D19** | **Personas por pack** + universales (`hostil`, `pide_humano`, `fuera_de_kb`, `sin_rumbo`); rangos de teléfono por pack; `default` = las 8 actuales. | Personas en BD. | Determinismo del Laboratorio (FR-030 de 001). |
| **D20** | **Plantillas = `semilla` parcial de Blueprint** validada en prueba; «Aplicar plantilla» explícito con dry-run; cambiar de pack no reaplica. Secciones `vertical` y `fichaFields` aditivas, `version: 1`. | Aplicar semilla al cambiar de pack; Blueprint v2. | No pisar lo que el negocio ya editó; v1 sigue válido. |
| **D21** | **Migraciones aditivas**: `0032_motor_nicho` (072-A: `vertical_pack`, `vertical_overrides`, `ficha_fields` + `check`s) y `0033_llamadas_de_herramienta` (072-B: `brain_tool_call`). | Una sola migración. | Cada ronda se despliega sola. |
| **D22** | **`single`**: pack `default` fijo (sin UI para cambiarlo); ficha flexible sí (Ajustes → Ficha); módulos y `moduleTools` no existen (H8). | Packs y módulos en `single`. | Cero cambio para instalaciones de una empresa; se abre después si hay demanda. |

## 2. Arquitectura

### 2.1 Árbol nuevo

```text
vocero-crm/src/
  verticals/                     # 072-A — SOLO datos, sin React, sin servidor
    tipos.ts                     # VerticalPack, VerticalOverrides, TerminoVocabulario, WidgetRef
    extender.ts                  # extenderPack(base, parcial) — 1 nivel
    default/pack.ts
    clinica-salud/pack.ts        # vocabulario, nav, inicio, fichaFields, semilla, personas
    eventos-mobiliario/pack.ts
    registro.ts                  # PACKS as const satisfies Record<string, VerticalPack>; PackId
    resolver.ts                  # resolverExperiencia(pack, overrides, modulos) — PURO
  server/verticals/
    experiencia.ts               # experienciaDe(orgId) con cache(): lee columnas → resolver
  server/ficha/
    esquema.ts                   # fichaFieldsSchema (zod), coercion por tipo, faltantes()
  components/inicio/widgets/     # widgets del núcleo (Server Components)
  app/(app)/inicio/page.tsx
  app/(app)/settings/ficha/page.tsx

  modulos/                       # 072-B — código aislado
    tipos.ts                     # defineModulo, ModuleTool, Efecto
    registro.ts                  # servidor: MODULOS; CATALOGO_VERTICAL derivado
    registro-cliente.ts          # cliente: next/dynamic por sección/widget
    diagnostico/{modulo.ts, herramientas.ts, paginas/inicio.tsx}
  server/modulos/guardas.ts      # exigirModulo(session, clave), withModulo(handler)
  server/brains/herramientas.ts  # moduleToolsDe(orgId), ejecutarHerramienta(...)
  app/(app)/m/diagnostico/{layout.tsx, page.tsx}
  app/api/brains/tools/[name]/route.ts

nea-agent/app/
  herramientas/ficha.py          # 072-A — esquema dinámico + faltantes
  herramientas/dinamicas.py      # 072-B — validar moduleTools, registro_del_turno()
```

### 2.2 Flujo de la experiencia (072-A)

```text
(app)/layout.tsx  (Server)
  └─ experienciaDe(session.organizationId)          cache() por petición
       ├─ organization.vertical_pack  → PACKS[id] ?? PACKS.default
       ├─ organization.vertical_overrides → zod safeParse (basura = sin overrides)
       └─ modulosDe(session)  (072-B: entradas/widgets de módulos encendidos)
  └─ <AppShell experiencia={…serializable…}>
        AppNav → appNavGroups({ agenda, role, experiencia })   ← nav.ts sigue puro
```

- `appNavGroups` sin `experiencia` (o con `default`) devuelve **lo mismo que
  2.11.0** (prueba de instantánea).
- Íconos: el pack nombra íconos de una lista cerrada `ICONOS_NAV` (mapa
  `string → LucideIcon` en `nav.ts`); nada de importar íconos arbitrarios.
- `src/app/page.tsx`: tras `guideFirst`, `redirect(experiencia.inicio ? "/inicio" : "/inbox")`.

### 2.3 Inicio y widgets

`WidgetRef = { tipo: TipoWidget; params?: … }` con `TipoWidget` cerrado:
`sin_responder`, `leads_por_etapa`, `citas_de_hoy` (solo con agenda efectiva),
`proximos_por_fecha` (`params.campo` = clave `date` de la ficha; consulta
`contact.ficha->>campo` dentro de una ventana de 30 días, `limit 10`, por
organización), `accesos_rapidos`. Cada widget: Server Component async con
`<Suspense>` y `ErrorBoundary` propios. `proximos_por_fecha` no lleva índice
en la 072 (volumen por negocio bajo); se mide en staging y, si hace falta, se
agrega un índice de expresión parcial en una migración posterior.

### 2.4 Ficha flexible

```ts
type FichaField = {
  key: string;            // ^[a-z][a-z0-9_]{1,39}$, ≠ "notas"
  label: string;          // ≤60
  type: "text" | "number" | "date" | "select" | "boolean";
  options?: string[];     // solo select, 1..30, ≤60 c/u, únicas normalizadas
  required?: boolean;
  description?: string;   // ≤160, una línea, para el bot
};
type FichaSchema = { version: 1; fields: FichaField[] }; // ≤20, orden = posición
```

- `upsertFicha({organizationId, contactId, ficha})` lee `ficha_fields` (misma
  transacción de lectura) → `aplicarEsquema(patch, esquema)` →
  `{ ficha, ignored }` → `mergeFicha` de siempre. La respuesta suma `ignored`
  solo si no está vacío (sin esquema, respuesta idéntica).
- Coerción: `number` acepta `"1.200"`/`"1,5"` según `es-CO`; `date` acepta
  `AAAA-MM-DD` (y `DD/MM/AAAA` → normaliza); `select` compara sin acentos ni
  mayúsculas y guarda la opción canónica; `boolean` usa `SI`/`NO` de `lib/ficha.ts`.
- `FichaPanel`: recibe `esquema` → controles por tipo (`Input type=date`,
  `select`, `Switch`), luego «Otros datos» con el editor de hoy.
- `/api/brains/context` y `/api/bot/context`: `fichaSchema` (ver contrato).

**Nea (072-A)**
- `app/herramientas/ficha.py`: `esquema_de_ficha(context)` → si
  `context.fichaSchema.fields`, construye `properties` (`text→string`,
  `number→number`, `date→string` con `description` «AAAA-MM-DD», `select→string
  enum`, `boolean→boolean`), `description = label + " — " + description`
  (truncada a 200), + `notas`; si no, `_de_tools("update_ficha")` intacto.
  Validación defensiva: claves inválidas o tipos desconocidos se descartan
  (log), más de 20 → se toman las 20 primeras.
- `faltantes(context) -> list[tuple[key,label]]`: obligatorios sin valor en
  `contact.ficha`, en orden, máx. 3.
- `app/prompt.py`, bloque CONTEXTO ACTUAL, **solo si hay faltantes**:
  `- Datos por reunir (uno a la vez, en este orden, sin repetir lo ya dicho; nunca condiciones una cita ni una cotización a ellos): Fecha del evento, Número de invitados.`
- `_update_ficha`: si el CRM responde `ignored`, devuelve
  `{"ok": True, "ignorados": [k…]}`.
- `herramientas()` del chasis **no cambia** (dorados).

### 2.5 Módulos y puente (072-B)

```ts
type Efecto = "lectura" | "escritura";
type ModuleTool<A extends z.ZodTypeAny> = {
  nombre: `${string}_${string}`;          // prefijo = clave del módulo (prueba)
  descripcion: string;                    // ≤400, revisada en código
  args: A;                                // zod; JSON Schema con z.toJSONSchema
  efecto: Efecto;
  ejecutar(ctx: { organizationId: string; conversationId: string; dispatchId: string; signal: AbortSignal },
           args: z.infer<A>): Promise<ResultadoHerramienta>;
};
type ResultadoHerramienta =
  | { ok: true; result: Record<string, unknown>; estado?: "hecho" | "en_curso" }
  | { ok: false; error: string; detalle?: string };
```

**Ruta `POST /api/brains/tools/[name]`** (orden de comprobaciones):
1. `withBrain` → ámbito (401 uniforme).
2. `name` contra patrón; `leerCuerpoAcotado(16 KB)` → 413; JSON + `zod` del sobre → 422.
3. `modulosDeOrganizacion(orgId)` → herramienta en módulo efectivo; si no → 404 `tool_not_found`.
4. Conversación de la organización (404) y no pausada (409 `ai_paused`).
5. `args` contra `tool.args` → 422 `invalid_args` (con `path`).
6. Si `escritura`: `insert … on conflict do nothing returning` en
   `brain_tool_call` (`estado='en_curso'`); si existía → devuelve su
   `response` guardada (o `{ok:true, estado:"en_curso"}` si sigue en curso).
7. `Promise.race(ejecutar, timeout 8 s)` con `AbortController` → 504 `tool_timeout`
   (la fila queda `fallida` y una repetición vuelve a intentar).
8. Respuesta serializada ≤4 KB (si no, `{ok:false, error:"resultado_grande"}` y log).

**Nea (072-B)** — `app/herramientas/dinamicas.py`:
- `validar(context) -> list[ToolSpec]`: lee `context.moduleTools`; descarta
  nombres que no cumplan el patrón, que estén en `REGISTRO.nombres()` o
  `RESERVADOS`, esquemas >4 KB, total >12 KB, más de 8; cada `ToolSpec` con
  `clave=f"modulo:{module}"`, `esquema` = el del contexto, `ejecutar` = proxy.
- `registro_del_turno(caps) -> Registro`: nuevo `Registro` con nativas + dinámicas
  (si el contexto no trae `moduleTools`, **es** `REGISTRO`: misma instancia).
- `tool_schemas`, `solo_encendidas`, `ToolRuntime.execute` reciben/usan el
  registro del turno (se pasa por `Capacidades` o por el `ToolRuntime`).
- `permite`: `clave.startswith("modulo:")` → `True` si la herramienta vino en
  el contexto del turno (no pasa por `profile.tools`, que es el catálogo fijo).
- `CrmClient.call_tool(conv_id, name, args)` → `POST /api/brains/tools/{name}`
  (`BrainsCrmClient`; en `single` no existe y la herramienta no se ofrece).
  Errores: 401/403 → `CrmRechazo` (terminal, como hoy); 404 →
  `herramienta_no_disponible`; 409 → `ai_paused` (el turno no sigue mandando);
  422 → `argumentos_invalidos` + detalle; 504/5xx/timeout 10 s → `crm_error`.
- Prompt: si hay herramientas de módulo, **una** línea en CONTEXTO ACTUAL:
  `- Este negocio tiene herramientas propias; úsalas solo para lo que dice su descripción y nunca las nombres al cliente.`
  Sin herramientas → dorados intactos.

### 2.6 Seguridad transversal
Ver [spec §8](spec.md#8-seguridad-y-aislamiento). Pruebas obligatorias: A↛B en
`/api/brains/tools`, `/m/*`, `/api/m/*`, `/inicio` (widgets solo leen su org),
`ficha_fields` de A no afecta la ficha de B.

## 3. Migraciones

```sql
-- 0032_motor_nicho.sql (072-A)
ALTER TABLE organization ADD COLUMN IF NOT EXISTS vertical_pack text NOT NULL DEFAULT 'default';
ALTER TABLE organization ADD COLUMN IF NOT EXISTS vertical_overrides jsonb;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS ficha_fields jsonb;
ALTER TABLE organization ADD CONSTRAINT organization_vertical_pack_ck
  CHECK (vertical_pack ~ '^[a-z][a-z0-9-]{1,39}$') NOT VALID;  -- luego VALIDATE
ALTER TABLE organization ADD CONSTRAINT organization_vertical_overrides_tam_ck
  CHECK (vertical_overrides IS NULL OR pg_column_size(vertical_overrides) < 8192) NOT VALID;
ALTER TABLE organization ADD CONSTRAINT organization_ficha_fields_tam_ck
  CHECK (ficha_fields IS NULL OR pg_column_size(ficha_fields) < 16384) NOT VALID;

-- 0033_llamadas_de_herramienta.sql (072-B)
CREATE TABLE IF NOT EXISTS brain_tool_call (
  id text PRIMARY KEY,                          -- btc_…
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  dispatch_id text NOT NULL,
  tool text NOT NULL,
  idempotency_key text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('en_curso','hecha','fallida')),
  response jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS brain_tool_call_idem_uq ON brain_tool_call(organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS brain_tool_call_created_idx ON brain_tool_call(created_at);
```
Generadas con `drizzle-kit generate` y ajustadas a mano para `IF NOT EXISTS`
(re-ejecutables, Principio IV). Purga de >30 días en la tarea de retención existente.

## 4. Packs entregados (resumen; detalle en `src/verticals/*/pack.ts`)

| | `default` | `clinica-salud` | `eventos-mobiliario` |
|---|---|---|---|
| Vocabulario | núcleo | contacto→Paciente, cita→Valoración, pipeline→Pacientes en proceso, lead→Paciente potencial | contacto→Cliente, lead→Solicitud, pipeline→Solicitudes, cita→Visita |
| Inicio | no | `citas_de_hoy`, `sin_responder`, `leads_por_etapa`, `accesos_rapidos` | `proximos_por_fecha(fecha_evento)`, `sin_responder`, `leads_por_etapa` (+ `mobiliario.cotizaciones_pendientes` en 073) |
| Nav | 2.11.0 | Inicio primero; «Citas» antes de «Pipeline» | Inicio primero; «Citas» oculta salvo agenda encendida (como hoy); módulos recomendados: `mobiliario` (073) |
| Ficha semilla | — | `tratamiento_interes` (select), `primera_vez` (bool, req.), `eps_o_particular` (select, req.), `sede_preferida` (select), `urgencia_dolor` (bool) | `fecha_evento` (date, req.), `tipo_evento` (select, req.), `num_invitados` (number, req.), `ciudad_evento` (text), `presupuesto_aprox` (number) |
| Agente semilla | — | trato `usted`, `stallEnabled: true`, «no das diagnósticos ni precios de tratamientos no publicados» | trato `tu`, `stallEnabled: false` (ventas consultivas largas) |
| Etapas | por defecto | Nuevo · Valoración agendada · Valoración realizada · Tratamiento propuesto | Nuevo · Cotización enviada · Separación pendiente · Confirmado |
| Apariencia | — | tema `papel`, densidad cómoda, acento sugerido azul clínico | tema nuevo `fiesta` (aportado al catálogo) |
| Personas | 8 actuales | `paciente_valoracion`, `pregunta_precios_sedes`, `paciente_molesto_cita` + universales | `novios_boda`, `evento_corporativo`, `cumpleanos_ultimo_minuto` + universales |

## 5. Estrategia de verificación (PC de gama baja)

**Local** (por bloque): `npx pnpm@11.5.0 typecheck` · `npx pnpm@11.5.0 lint` ·
`npx pnpm@11.5.0 exec vitest run --maxWorkers=1 --no-file-parallelism <archivos>` ·
`python -m pytest -q` (venv temporal del scratchpad).
**CI/staging**: `next build`, Vitest completo, pytest con Postgres, E2E
(`e2e-plataforma` extendido + guion nuevo `tests/e2e/072-motor-multi-nicho.md`),
smoke en staging con un negocio de cada pack.

Pruebas clave nuevas:
- CRM: `verticals/registro.test.ts` (cada semilla válida contra `blueprintSchema`;
  prefijos/ids; herencia), `nav.test.ts` (instantánea `default` = 2.11.0),
  `ficha-esquema.test.ts` (coerción, `ignored`, sin esquema = idéntico),
  `blueprint-072.test.ts` (idempotencia de la plantilla), `brains-tools.test.ts`
  (códigos, A↛B, idempotencia, timeout), `modulos-guardas.test.ts`
  (guardarraíl de carpetas `m/`), `personas.test.ts` (sin choques de teléfono).
- Nea: `test_ficha_dinamica_072.py`, `test_datos_por_reunir_072.py`,
  `test_herramientas_dinamicas_072.py` (colisiones, límites, registro por turno
  sin fuga entre organizaciones, `CrmRechazo`, `ignorados`), dorados B0 intactos
  + 2 fixtures nuevos.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| `proximos_por_fecha` lento con muchas filas (jsonb sin índice) | `limit`, ventana de 30 días, medición en staging; índice de expresión después si hace falta |
| El modelo ignora «Datos por reunir» o pregunta dos cosas a la vez | Persona de Laboratorio + juez (SC-3); la regla «UNA pregunta» del chasis ya existe |
| Packs crecen hasta volverse productos | Revisión: un pack solo contiene datos de `VerticalPack`; todo lo demás es módulo |
| Una Nea vieja contra un CRM 072-B | No conoce `moduleTools` → no las ofrece; nada se rompe |
| `.strict()` del Blueprint en clientes MCP viejos | Las secciones nuevas son opcionales; un cliente viejo nunca las manda |
