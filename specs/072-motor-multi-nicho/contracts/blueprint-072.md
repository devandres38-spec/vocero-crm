# Contrato `OrganizationBlueprint` v1 — delta 072 (+ MCP)

Aditivo sobre el Blueprint de la 069/070/071 (`src/lib/platform/blueprint.ts`).
`version` sigue siendo `1`; las secciones nuevas son **opcionales**, `.strict()`,
y una sección ausente no se toca. `buscarSecretos` las recorre igual que al resto.

## 1. Sección `vertical`

```jsonc
"vertical": {
  "pack": "clinica-salud",                 // id de PACKS; desconocido → 422 pack_desconocido
  "overrides": {                           // opcional; null = quitar overrides
    "vocabulario": { "contacto": { "uno": "Paciente", "varios": "Pacientes" } },
    "nav": { "ocultas": ["/results"], "orden": ["/inicio", "/inbox", "/bookings"] },
    "inicio": { "widgets": [ { "tipo": "citas_de_hoy" }, { "tipo": "sin_responder" } ] }
  }
}
```

- `vocabulario`: solo claves de `TerminoVocabulario`; `uno`/`varios` ≤30.
- `nav.ocultas` / `nav.orden`: solo `href` que existan en la navegación
  resuelta (pack + módulos); `/settings` no se oculta.
- `inicio.widgets`: ≤8, `tipo` del catálogo (núcleo o `<modulo>.<widget>`); un
  widget de módulo apagado se acepta y no se pinta (aviso en `warnings`).
- ≤4 KB serializado → si no, 422 `overrides_grandes`.
- Estados: `actualizada` si cambia `pack` u `overrides`; `sin_cambios` si no.
- **Cambiar `pack` no aplica su semilla** (D20).

## 2. Sección `fichaFields`

```jsonc
"fichaFields": {
  "fields": [ { "key": "fecha_evento", "label": "Fecha del evento", "type": "date", "required": true } ]
}
```

- Reemplaza el esquema completo (`fields: []` = quitar esquema). Reglas de
  [brains-072 §1](brains-072.md#1-get-apibrainscontext-y-get-apibotcontext-072-a).
- **Clave inmutable**: un campo existente no puede cambiar de `type` (422
  `tipo_inmutable`); para cambiarlo, otra clave. Quitar un campo no borra valores.
- Idempotente: mismo arreglo (comparación canónica) → `sin_cambios`.

## 3. Plantillas

`get_vertical_pack(id).semilla` es una `BlueprintEntrada` parcial: `pipeline`,
`agent`, `knowledge` (`mode: "merge"`), `quickReplies` (`mode: "merge"`),
`appearance`, `fichaFields`, `vertical: { pack: id }`. Sin `organization`,
`owner`, `brain` ni `region`. Aplicarla = `apply_blueprint` con la semilla
mezclada con lo que mande la agencia (lo de la agencia gana). Dos aplicaciones
seguidas → todo `sin_cambios`.

## 4. MCP (`PLATFORM_MCP`)

| Herramienta | Alcance | Entrada | Salida |
|---|---|---|---|
| `list_vertical_packs` *(nueva)* | `read` | — | `[{ id, label, description, recommendedModules, fichaFieldsCount, hasHome }]` |
| `get_vertical_pack` *(nueva)* | `read` | `{ id }` | `{ id, label, description, vocabulario, inicio, nav, semilla }` |
| `get_catalog` | `read` | — | + `verticalPacks` (lo de `list_vertical_packs`) + `fichaFields` (límites y tipos) + `modules.verticals` derivado del registro de módulos (072-B) |
| `plan_blueprint` / `apply_blueprint` | `provision` | Blueprint con `vertical`/`fichaFields` | Igual que hoy |

Auditoría: aplicar `vertical` o `fichaFields` registra la sección en la
bitácora de plataforma como el resto.
