# Contrato interno: Vertical Packs y Módulos

Contrato **dentro de `vocero-crm`** (no publicado fuera), fijado en tipos y en
pruebas. Define qué puede y qué no puede aportar un pack y un módulo.

## 1. Vertical Pack — solo datos (`src/verticals/`)

```ts
export type TerminoVocabulario =
  | "contacto" | "lead" | "pipeline" | "cita" | "bandeja" | "ficha"
  | "inicio" | "resultados" | "agente" | "etapa";

export type Termino = { uno: string; varios: string };

export type TipoWidgetNucleo =
  | "sin_responder" | "leads_por_etapa" | "citas_de_hoy"
  | "proximos_por_fecha" | "accesos_rapidos";

export type WidgetRef =
  | { tipo: Exclude<TipoWidgetNucleo, "proximos_por_fecha"> }
  | { tipo: "proximos_por_fecha"; params: { campo: string; titulo?: string } }
  | { tipo: `${string}.${string}` };            // widget de módulo (072-B)

export type VerticalPack = {
  id: string;                                  // ^[a-z][a-z0-9-]{1,39}$
  label: string;
  description: string;
  vocabulario: Partial<Record<TerminoVocabulario, Termino>>;
  nav: { orden?: string[]; ocultas?: string[]; iconos?: Partial<Record<string, IconoNav>> };
  inicio: { widgets: WidgetRef[] } | null;     // null = sin /inicio (default)
  fichaFields: FichaField[];                   // sugeridos (van en la semilla)
  semilla: BlueprintEntradaParcial;            // validada contra blueprintSchema en prueba
  personas: Persona[];                         // propias; las universales se suman solas
  temas?: Partial<Record<string, Tema>>;       // aportes al catálogo global TEMAS
  modulosRecomendados: string[];               // claves del registro de módulos
};
```

**Prohibido en un pack** (revisión + prueba de que `src/verticals/**` no
importa React, `next/*`, `@/server/*` ni `@/lib/db`): componentes, rutas,
consultas, herramientas del bot, lógica condicional por organización.

**Herencia**: `extenderPack(PACK_DEFAULT, parcial)`. Un nivel. Objetos
(`vocabulario`, `nav.iconos`) se mezclan un nivel; arrays (`widgets`,
`fichaFields`, `personas`, `orden`, `ocultas`) reemplazan.

**Resolución** (`resolverExperiencia`, pura):
`PACKS[org.vertical_pack] ?? PACKS.default` → ⊕ `vertical_overrides`
(validado; inválido = ignorado) → ⊕ aportes de módulos efectivos → `ExperienciaResuelta`
(serializable: sin funciones ni componentes).

## 2. Módulo — código aislado (`src/modulos/<clave>/`) · 072-B

```ts
export function defineModulo<const T extends ModuloDef>(def: T): T;

type ModuloDef = {
  clave: string;                               // ^[a-z][a-z0-9]{2,23}$
  label: string;
  oculto?: boolean;                            // no se lista a dueños (p. ej. diagnostico)
  nav?: { href: `/m/${string}`; label: string; icono: IconoNav; grupo: "trabajo" | "agente" }[];
  widgets?: { clave: string; label: string }[];      // componente en registro-cliente/servidor
  seccionesFicha?: { clave: string; label: string }[];
  herramientas?: ModuleTool<z.ZodTypeAny>[];
};
```

Reglas (cada una con su prueba):
1. Todo `href` del módulo empieza por `/m/<clave>`; toda herramienta por `<clave>_`.
2. Toda tabla del módulo tiene `organization_id NOT NULL` y su nombre empieza por un prefijo propio (`mob_` en 073).
3. El módulo escribe en tablas del núcleo **solo** por sus puertas únicas
   (`upsertFicha`, `moverEtapa…`, `sendMediaMessage`, `leads/stage-history.ts`).
4. El núcleo importa módulos **solo** desde `src/modulos/registro.ts` y
   `src/modulos/registro-cliente.ts` (prueba con `import` estático por grep).
5. Toda carpeta `src/app/(app)/m/<clave>/` tiene `layout.tsx` que llama
   `exigirModulo(session, "<clave>")`; toda ruta `src/app/api/m/<clave>/**`
   usa `withModulo("<clave>", …)`.
6. Apagado para un negocio → 404 en páginas, APIs y `POST /api/brains/tools`.
