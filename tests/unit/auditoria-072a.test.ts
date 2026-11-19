import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./helpers/fake-db";

/**
 * Auditoría 072-A — Pruebas de regresión de los hallazgos A-1..A-8 (los de
 * Nea, A-8, viven en `nea-agent/tests/test_ficha_dinamica_072.py`) y
 * M-1..M-9, más los bajos que se pueden fijar sin navegador.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null }));
vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});

import { schema } from "@/lib/db";
import {
  aFecha,
  aNumero,
  aplicarEsquema,
  CLAVES_RESERVADAS,
  faltantes,
  fichaFieldSchema,
  opcionesDeTexto,
  valorPropio,
  type FichaField,
} from "@/lib/ficha-campos";
import { MAX_KEYS, mergeFicha, normalizeFicha, parcheDeFicha, type Ficha } from "@/server/bot/ficha";
import {
  guardarFichaFields,
  leerRetirados,
  puedeEditarFicha,
  retiradosTras,
  tiposCambiados,
} from "@/server/ficha/esquema";
import { TODAS_LAS_PERSONAS, personasDelPack } from "@/server/lab/personas";
import { personasDelRol } from "@/server/lab/runner";
import { DEMO_PHONES } from "@/server/seed/demo";
import { aplicarVertical } from "@/server/platform/blueprint/secciones/vertical";
import type { Tx } from "@/server/platform/blueprint/secciones/metadata";
import { bytesUtf8, leerOverrides, verticalOverridesSchema } from "@/verticals/resolver";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import { aFila, nuevoUid } from "@/components/settings/ficha-campos-client";
import { guardarParcheFicha } from "@/components/ficha-guardar";
import {
  aplicarPlantillaAlFormulario,
  campoParaEnviar,
  formularioDesdeBlueprint,
  formularioDesdePlantilla,
  seccionesDelFormulario,
  type DefaultsForm,
  type TechoForm,
} from "@/lib/platform/formulario-blueprint";
import type { OrganizationBlueprint } from "@/lib/platform/blueprint";

const raiz = path.resolve(import.meta.dirname, "..", "..");
const fuente = (...p: string[]) => readFileSync(path.join(raiz, ...p), "utf8");

const EVENTOS: FichaField[] = [
  { key: "fecha_evento", label: "Fecha del evento", type: "date", required: true },
  { key: "num_invitados", label: "Número de invitados", type: "number", required: true },
  { key: "ciudad", label: "Ciudad", type: "text" },
];

const DEFAULTS: DefaultsForm = {
  country: "CO",
  locale: "es-CO",
  timezone: "America/Bogota",
  currency: "COP",
  accent: "#2563eb",
  etapas: ["Nuevo", "Calificado"],
};
const TECHO: TechoForm = { agenda: true, atribucion: true, channels: ["whatsapp"] };

// ─────────────────────────────────────────────────────────── ALTOS ───

describe("A-1 — teléfonos de las personas vs. la demo", () => {
  it("ninguna persona (base o de pack) comparte teléfono con DEMO_CONTACTS", () => {
    const demo = new Set(DEMO_PHONES);
    const choques = TODAS_LAS_PERSONAS.filter((p) => demo.has(p.phone)).map((p) => `${p.key}:${p.phone}`);
    expect(choques).toEqual([]);
  });
});

describe("A-2 — identidad estable de las filas del editor de campos", () => {
  it("cada fila nace con un uid único que no depende de la clave", () => {
    const a = aFila({ key: "", label: "", type: "text" }, true);
    const b = aFila({ key: "", label: "", type: "text" }, true);
    expect(a.uid).not.toBe(b.uid);
    expect(nuevoUid()).not.toBe(nuevoUid());
  });

  it("las listas usan el uid como `key` de React (no la clave que cambia al teclear)", () => {
    const ajustes = fuente("src", "components", "settings", "ficha-campos-client.tsx");
    expect(ajustes).toContain("<li key={f.uid}");
    expect(ajustes).not.toMatch(/key=\{`\$\{f\.key\}-\$\{i\}`\}/);
    const nicho = fuente("src", "components", "plataforma", "formulario", "pestana-nicho.tsx");
    expect(nicho).toContain("<li key={c.uid");
    expect(nicho).not.toMatch(/key=\{`\$\{i\}-\$\{c\.key\}`\}/);
  });

  it("los campos del formulario de /platform traen uid (de Blueprint y nuevos)", () => {
    const f = formularioDesdeBlueprint({ version: 1, fichaFields: { fields: EVENTOS } } as OrganizationBlueprint, DEFAULTS, TECHO);
    const uids = f.fichaFields.fields.map((c) => c.uid);
    expect(uids.every(Boolean)).toBe(true);
    expect(new Set(uids).size).toBe(uids.length);
  });
});

describe("A-3 / B-1 — opciones de una lista con comas", () => {
  it("una opción por línea: la coma es parte de la opción", () => {
    expect(opcionesDeTexto("Bogotá, D.C.\r\nMedellín\n\n  Cali  ")).toEqual(["Bogotá, D.C.", "Medellín", "Cali"]);
  });

  it("el formulario guarda el texto crudo y lo parsea al enviar (sin uid ni marcas)", () => {
    const enviado = campoParaEnviar({
      uid: "x",
      guardado: true,
      key: "sede",
      label: "Sede",
      type: "select",
      options: ["vieja"],
      opcionesTexto: "Bogotá, D.C.\nMedellín,",
    });
    expect(enviado).toEqual({ key: "sede", label: "Sede", type: "select", options: ["Bogotá, D.C.", "Medellín,"] });
    // Sin texto crudo (recién cargado), viajan las opciones tal cual.
    expect(campoParaEnviar({ key: "s", label: "S", type: "select", options: ["A", "B"] }).options).toEqual(["A", "B"]);
    expect(campoParaEnviar({ key: "t", label: "T", type: "text", opcionesTexto: "x" })).toEqual({ key: "t", label: "T", type: "text" });
  });

  it("la pestaña Nicho ya no parte por coma en cada tecla", () => {
    const nicho = fuente("src", "components", "plataforma", "formulario", "pestana-nicho.tsx");
    expect(nicho).not.toContain('.split(",")');
    expect(nicho).toContain("opcionesTexto: e.target.value");
  });
});

describe("A-4 — inmutabilidad del tipo en dos pasos y TOCTOU", () => {
  beforeEach(() => h.fake!.reiniciar());

  it("puro: un campo retirado no vuelve con otro tipo", () => {
    expect(tiposCambiados([], [{ key: "num_invitados", label: "N", type: "date" }], { num_invitados: "number" })).toEqual([
      "num_invitados",
    ]);
    expect(tiposCambiados([], [{ key: "num_invitados", label: "N", type: "number" }], { num_invitados: "number" })).toEqual([]);
    const sin = EVENTOS.filter((f) => f.key !== "num_invitados");
    expect(retiradosTras(EVENTOS, sin, {})).toEqual({ num_invitados: "number" });
    expect(retiradosTras(sin, EVENTOS, { num_invitados: "number" })).toEqual({});
    expect(leerRetirados({ version: 1, fields: [], retirados: { a: "zzz" } })).toEqual({});
    expect(leerRetirados(null)).toEqual({});
  });

  it("borrar `number` y recrearlo como `date` en otro guardado → tipo_inmutable", async () => {
    // Paso 1: se quita `num_invitados` (sus valores siguen en contact.ficha).
    h.fake!.responder(schema.organization, [{ fichaFields: { version: 1, fields: EVENTOS } }]);
    const sin = EVENTOS.filter((f) => f.key !== "num_invitados");
    expect(await guardarFichaFields("org_1", sin)).toMatchObject({ ok: true, cambio: true });
    const guardado = h.fake!.de(schema.organization, "update")[0]!.valores.fichaFields;
    expect(guardado).toMatchObject({ retirados: { num_invitados: "number" } });

    // Paso 2: se recrea la misma clave como fecha → se rechaza.
    h.fake!.responder(schema.organization, [{ fichaFields: guardado }]);
    expect(await guardarFichaFields("org_1", [...sin, { key: "num_invitados", label: "Fecha", type: "date" }])).toEqual({
      ok: false,
      error: "tipo_inmutable",
      claves: ["num_invitados"],
    });

    // Con su tipo de siempre sí vuelve, y sale de la memoria.
    h.fake!.responder(schema.organization, [{ fichaFields: guardado }]);
    await guardarFichaFields("org_1", EVENTOS);
    const ultimo = h.fake!.de(schema.organization, "update").at(-1)!.valores.fichaFields as { retirados?: unknown };
    expect(ultimo.retirados).toBeUndefined();
  });

  it("lee y escribe en UNA transacción con la fila bloqueada", async () => {
    const tx = vi.spyOn(h.fake!.db, "transaction");
    h.fake!.responder(schema.organization, [{ fichaFields: null }]);
    await guardarFichaFields("org_1", EVENTOS);
    expect(tx).toHaveBeenCalledTimes(1);
    tx.mockRestore();
    expect(fuente("src", "server", "ficha", "esquema.ts")).toContain('.for("update")');
  });
});

describe("A-5 — MAX_KEYS acota la ficha resultante", () => {
  const llena = (): Ficha => Object.fromEntries(Array.from({ length: MAX_KEYS }, (_, i) => [`k${i}`, i]));

  it("una clave libre NUEVA con la ficha llena se ignora", () => {
    const r = mergeFicha(llena(), { nueva: "x" });
    expect(Object.keys(r)).toHaveLength(MAX_KEYS);
    expect(r.nueva).toBeUndefined();
  });

  it("borrar y actualizar claves existentes siempre pasa", () => {
    const r = mergeFicha(llena(), { k0: null, k1: "cambio" });
    expect(r.k0).toBeUndefined();
    expect(r.k1).toBe("cambio");
    // Tras borrar, cabe una nueva.
    expect(mergeFicha(r, { otra: 1 }).otra).toBe(1);
  });

  it("las claves del esquema del negocio siempre entran", () => {
    const r = mergeFicha(llena(), { fecha_evento: "2027-03-14" }, new Set(["fecha_evento"]));
    expect(r.fecha_evento).toBe("2027-03-14");
  });

  it("muchas llamadas sucesivas con claves distintas no inflan la ficha", () => {
    let f: Ficha = {};
    for (let i = 0; i < 200; i++) f = mergeFicha(f, { [`bot_${i}`]: i });
    expect(Object.keys(f)).toHaveLength(MAX_KEYS);
  });
});

describe("A-6 — el esquema ve el valor CRUDO", () => {
  const TEXTO: FichaField[] = [{ key: "detalle", label: "Detalle", type: "text" }, ...EVENTOS];

  it("un texto de más de 500 se reporta (`texto_largo`), no se recorta en silencio", () => {
    const r = parcheDeFicha({ detalle: "a".repeat(600) }, TEXTO);
    expect(r.patch.detalle).toBeUndefined();
    expect(r.ignored).toEqual([{ key: "detalle", reason: "texto_largo" }]);
  });

  it("objetos, arreglos y NaN en un campo del esquema se reportan", () => {
    const r = parcheDeFicha({ detalle: { a: 1 }, ciudad: ["Cali"], num_invitados: Number.NaN }, TEXTO);
    expect(r.ignored).toEqual([
      { key: "detalle", reason: "no_es_texto" },
      { key: "ciudad", reason: "no_es_texto" },
      { key: "num_invitados", reason: "no_es_numero" },
    ]);
  });

  it("la cadena vacía no borra ni se reporta; `null` borra", () => {
    expect(parcheDeFicha({ ciudad: "  ", num_invitados: null }, TEXTO)).toEqual({ patch: { num_invitados: null }, ignored: [] });
  });

  it("lo libre sigue pasando por normalizeFicha (recorte a 500)", () => {
    const r = parcheDeFicha({ rubro: "b".repeat(600), ciudad: "Cali" }, TEXTO);
    expect((r.patch.rubro as string).length).toBe(500);
    expect(r.patch.ciudad).toBe("Cali");
  });

  it("sin esquema es exactamente normalizeFicha (respuesta de 2.11.0)", () => {
    const raw = { rubro: "salud", presupuesto: 50000, x: { y: 1 }, v: "" };
    expect(parcheDeFicha(raw, [])).toEqual({ patch: normalizeFicha(raw), ignored: [] });
  });

  it("PATCH /api/contacts/[id] devuelve `ignored` cuando hubo descartes", () => {
    const ruta = fuente("src", "app", "api", "contacts", "[id]", "route.ts");
    expect(ruta).toContain("ignored = res.ignored;");
    expect(ruta).toContain("...(ignored && ignored.length > 0 ? { ignored } : {})");
  });
});

describe("A-7 — el lápiz de «Otros datos» abre con su valor", () => {
  it("ambos disparadores pasan por abrirEdicionLibre (que fija el borrador)", () => {
    const panel = fuente("src", "components", "ficha-panel.tsx");
    expect(panel.match(/onClick=\{\(\) => abrirEdicionLibre\(clave, valor\)\}/g)).toHaveLength(2);
    expect(panel).not.toContain("onClick={() => setEditando(clave)}");
    expect(panel).toMatch(/function abrirEdicionLibre[\s\S]*?setBorrador\([\s\S]*?setEditando\(clave\)/);
  });
});

// ─────────────────────────────────────────────────────────── MEDIOS ───

describe("M-1 — los overrides sobreviven al formulario", () => {
  const overrides = { nav: { orden: ["/pipeline"] } };

  it("importar/editar un Blueprint con overrides los conserva al enviar", () => {
    const f = formularioDesdeBlueprint({ version: 1, vertical: { pack: "clinica-salud", overrides } } as OrganizationBlueprint, DEFAULTS, TECHO);
    expect(seccionesDelFormulario(f, "editar", TECHO).vertical).toEqual({ pack: "clinica-salud", overrides });
    expect(seccionesDelFormulario(f, "crear", TECHO).vertical).toEqual({ pack: "clinica-salud", overrides });
  });

  it("`overrides: null` (quitarlos) también viaja; ausente, no se manda", () => {
    const quitar = formularioDesdeBlueprint({ version: 1, vertical: { pack: "default", overrides: null } } as OrganizationBlueprint, DEFAULTS, TECHO);
    expect(seccionesDelFormulario(quitar, "editar", TECHO).vertical).toEqual({ pack: "default", overrides: null });
    const sin = formularioDesdeBlueprint({ version: 1, vertical: { pack: "default" } } as OrganizationBlueprint, DEFAULTS, TECHO);
    expect(seccionesDelFormulario(sin, "editar", TECHO).vertical).toEqual({ pack: "default" });
    expect(seccionesDelFormulario(sin, "crear", TECHO).vertical).toBeUndefined();
  });

  it("cargar una plantilla no se lleva los overrides del negocio", () => {
    const f = formularioDesdeBlueprint({ version: 1, vertical: { pack: "default", overrides } } as OrganizationBlueprint, DEFAULTS, TECHO);
    const g = aplicarPlantillaAlFormulario(f, "clinica-salud", DEFAULTS, TECHO);
    expect(g.vertical).toEqual({ pack: "clinica-salud", overrides });
  });
});

describe("M-2 — «Eventos próximos» sin archivados", () => {
  it("proximosPorFecha filtra archivedAt IS NULL dentro del scoped", () => {
    const w = fuente("src", "server", "inicio", "widgets.ts");
    const cuerpo = w.slice(w.indexOf("export async function proximosPorFecha"));
    expect(cuerpo.slice(0, cuerpo.indexOf(".orderBy("))).toContain("isNull(schema.contact.archivedAt)");
  });
});

describe("M-3 — verticalOverridesSchema", () => {
  const ok = (o: unknown) => verticalOverridesSchema.safeParse(o).success;
  const motivo = (o: unknown) => verticalOverridesSchema.safeParse(o).error?.issues[0]?.message;

  it("ocultar la Bandeja se rechaza con su motivo", () => {
    expect(motivo({ nav: { ocultas: ["/inbox"] } })).toBe("bandeja_no_se_oculta");
    expect(ok({ nav: { ocultas: ["/lab"] } })).toBe(true);
  });

  it("un Inicio sin widgets se rechaza", () => {
    expect(ok({ inicio: { widgets: [] } })).toBe(false);
    expect(ok({ inicio: { widgets: [{ tipo: "sin_responder" }] } })).toBe(true);
  });

  it("el tope se mide en bytes UTF-8", () => {
    expect(bytesUtf8("a")).toBe(1);
    expect(bytesUtf8("ñ")).toBe(2);
    expect(bytesUtf8("🎉")).toBe(4);
    expect(fuente("src", "verticals", "resolver.ts")).toContain("bytesUtf8(JSON.stringify(o)) <= TOPE_OVERRIDES_BYTES");
  });

  it("Inicio con todos sus widgets ocultos muestra un estado vacío", () => {
    expect(fuente("src", "app", "(app)", "inicio", "page.tsx")).toContain("widgets.length === 0");
  });
});

describe("M-4 — códigos de error 072 traducidos en /platform", () => {
  it.each([
    "pack_desconocido",
    "tipo_inmutable",
    "clave_invalida",
    "clave_reservada",
    "claves_repetidas",
    "opciones_requeridas",
    "opciones_solo_en_select",
    "opciones_repetidas",
    "href_invalido",
    "ajustes_no_se_ocultan",
    "bandeja_no_se_oculta",
    "overrides_grandes",
  ])("%s tiene mensaje para una persona", (codigo) => {
    const porCodigo = leerErrorPlataforma({ error: { code: codigo, message: "crudo" } });
    const porIssue = leerErrorPlataforma({ error: { code: "x", issues: [{ path: "p", message: codigo }] } });
    expect(porCodigo).not.toBe("crudo");
    expect(porIssue).not.toContain(codigo);
  });
});

describe("M-5 — Laboratorio por nicho", () => {
  const rol = () => personasDelRol("calificador");

  it("con el cierre por falta de rumbo apagado, el nicho no corre `sin_rumbo`", () => {
    const keys = personasDelPack("eventos-mobiliario", rol(), { stallEnabled: false }).map((p) => p.key);
    expect(keys).not.toContain("sin_rumbo");
    expect(keys).toHaveLength(6);
    expect(personasDelPack("eventos-mobiliario", rol(), { stallEnabled: true }).map((p) => p.key)).toContain("sin_rumbo");
  });

  it("`default` conserva sus 8 (regresión cero)", () => {
    expect(personasDelPack("default", rol(), { stallEnabled: false })).toHaveLength(8);
  });

  it("failRun publica el total REAL de casos, no PERSONAS.length", () => {
    const runner = fuente("src", "server", "lab", "runner.ts");
    expect(runner).not.toContain("PERSONAS.length");
    expect(runner).toContain('publishProgress(organizationId, runId, "failed", 0, casos.length)');
    expect(runner).toContain("stallEnabled: perfil?.stallEnabled");
  });
});

describe("M-6 — claves que chocan con Object.prototype", () => {
  it("constructor y prototype están reservadas", () => {
    expect(CLAVES_RESERVADAS).toEqual(expect.arrayContaining(["notas", "constructor", "prototype"]));
    for (const key of ["constructor", "prototype"]) {
      expect(fichaFieldSchema.safeParse({ key, label: "X", type: "text" }).success).toBe(false);
    }
  });

  it("solo se leen claves PROPIAS de la ficha", () => {
    expect(valorPropio({}, "constructor")).toBeUndefined();
    expect(valorPropio({}, "toString")).toBeUndefined();
    expect(valorPropio({ ciudad: "Cali" }, "ciudad")).toBe("Cali");
    // Un obligatorio sin valor propio cuenta como faltante (no como «la función constructor»).
    expect(faltantes([{ key: "constructor", label: "X", type: "text", required: true }], {})).toHaveLength(1);
  });

  it("aplicarEsquema no confunde una clave libre con una heredada", () => {
    expect(aplicarEsquema({ constructor: "x" }, EVENTOS).patch).toEqual({ constructor: "x" });
  });
});

describe("M-7 — números y fechas", () => {
  it("aNumero(\"0.125\") es 0.125, no 125", () => {
    expect(aNumero("0.125")).toBe(0.125);
    expect(aNumero("0,125")).toBe(0.125);
    expect(aNumero("-0.5")).toBe(-0.5);
    // Los miles de siempre siguen.
    expect(aNumero("1.250")).toBe(1250);
    expect(aNumero("12.500.000")).toBe(12500000);
    expect(aNumero("1,250.5")).toBe(1250.5);
  });

  it("aFecha no acepta basura tras el día", () => {
    expect(aFecha("2026-05-1099")).toBeNull();
    expect(aFecha("2026-05-10abc")).toBeNull();
    expect(aFecha("2026-05-10")).toBe("2026-05-10");
    expect(aFecha("2026-05-10T15:00:00Z")).toBe("2026-05-10");
    expect(aFecha("2026-05-10 15:00")).toBe("2026-05-10");
  });
});

describe("M-8 — puedeEditar del GET coincide con el PUT", () => {
  it("un acceso de soporte (aunque sea de configuración) solo lee", () => {
    expect(puedeEditarFicha({ role: "owner", via: "soporte", grant: { level: "configuracion" } })).toBe(false);
    expect(puedeEditarFicha({ role: "owner", via: "miembro" })).toBe(true);
    expect(puedeEditarFicha({ role: "admin" })).toBe(true);
    expect(puedeEditarFicha({ role: "member" })).toBe(false);
  });

  it("GET y PUT usan la misma regla", () => {
    const ruta = fuente("src", "app", "api", "settings", "ficha-fields", "route.ts");
    expect(ruta).toContain("puedeEditar: puedeEditarFicha(session)");
    expect(ruta).toContain("if (!puedeEditarFicha(session))");
  });
});

describe("M-10 — guardar la ficha falla de verdad", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });
  const responder = (status: number, body: unknown) => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  };

  it("un 4xx/5xx lanza (el panel muestra el error y no cierra)", async () => {
    responder(500, { error: { code: "internal" } });
    await expect(guardarParcheFicha("ct_1", { a: "1" })).rejects.toThrow(/No se pudo guardar/);
  });

  it("un `ignored` lanza (el valor no encajó)", async () => {
    responder(200, { contact: {}, ignored: [{ key: "num_invitados", reason: "no_es_numero" }] });
    await expect(guardarParcheFicha("ct_1", { num_invitados: "muchos" })).rejects.toThrow(/no encaja/);
  });

  it("sin descartes, resuelve", async () => {
    responder(200, { contact: {} });
    await expect(guardarParcheFicha("ct_1", { a: "1" })).resolves.toBeUndefined();
  });

  it("el panel cierra solo tras guardar y muestra el error; sí/no con aBooleano", () => {
    const panel = fuente("src", "components", "ficha-panel.tsx");
    expect(panel).toContain("if (await guardar({ [clave]: valor })) setEditando(null);");
    expect(panel).toContain("if (await onGuardar(r.valor)) setEditando(false);");
    expect(panel).toContain('role="alert"');
    expect(panel).toContain('aBooleano(valor) ? "si" : "no"');
  });

  it("Ajustes → Ficha no se queda en «Cargando…» si falla el GET, y la clave de una fila nueva se edita", () => {
    const ajustes = fuente("src", "components", "settings", "ficha-campos-client.tsx");
    expect(ajustes).toContain("setErrorCarga(true)");
    expect(ajustes).toContain("Reintentar");
    expect(ajustes).toContain("cambiar(i, { key: e.target.value.toLowerCase() })");
  });
});

// ─────────────────────────────────────────────────────────── BAJOS ───

describe("B-2 — Inicio y el logo", () => {
  it("/inicio sin sesión usa el mismo destino que el layout, y el logo lleva al Inicio", () => {
    const inicio = fuente("src", "app", "(app)", "inicio", "page.tsx");
    expect(inicio).toContain("redirect(destinoSinOrganizacion(await contextoActual()))");
    expect(inicio).not.toContain('redirect("/login")');
    expect(fuente("src", "components", "app-nav.tsx")).toContain('href={inicio ? "/inicio" : "/inbox"}');
  });
});

describe("B-3 — el tipo de un campo guardado no se cambia en /platform", () => {
  it("lo cargado del negocio viene marcado; lo de una plantilla, no", () => {
    const f = formularioDesdeBlueprint({ version: 1, fichaFields: { fields: EVENTOS } } as OrganizationBlueprint, DEFAULTS, TECHO);
    expect(f.fichaFields.fields.every((c) => c.guardado === true)).toBe(true);
    const p = formularioDesdePlantilla("eventos-mobiliario", DEFAULTS, TECHO);
    expect(p.fichaFields.fields.length).toBeGreaterThan(0);
    expect(p.fichaFields.fields.some((c) => c.guardado)).toBe(false);
    expect(fuente("src", "components", "plataforma", "formulario", "pestana-nicho.tsx")).toContain(
      'disabled={modo === "editar" && c.guardado === true}'
    );
  });
});

describe("B-4 — overrides ilegibles", () => {
  beforeEach(() => h.fake!.reiniciar());

  it("`overrides: null` limpia una columna con basura", async () => {
    h.fake!.responder(schema.organization, [{ pack: "default", overrides: { basura: true } }]);
    const r = await aplicarVertical(h.fake!.db as unknown as Tx, "org_1", { pack: "default", overrides: null });
    expect(r.cambio).toBe(true);
    expect(h.fake!.de(schema.organization, "update")[0]!.valores.verticalOverrides).toBeNull();
  });

  it("sin basura y sin cambios, no escribe", async () => {
    h.fake!.responder(schema.organization, [{ pack: "default", overrides: null }]);
    const r = await aplicarVertical(h.fake!.db as unknown as Tx, "org_1", { pack: "default", overrides: null });
    expect(r.cambio).toBe(false);
    expect(h.fake!.de(schema.organization, "update")).toHaveLength(0);
  });

  it("descartar unos overrides inválidos avisa a quien lo pida", () => {
    const aviso = vi.fn();
    expect(leerOverrides({ basura: true }, aviso)).toBeNull();
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(leerOverrides(null, aviso)).toBeNull();
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(fuente("src", "server", "verticals", "experiencia.ts")).toContain("vertical_overrides inválidos");
  });
});

describe("B-5 — detalles", () => {
  it("el ✓ de la ficha se deshabilita mientras guarda (las dos ediciones)", () => {
    const panel = fuente("src", "components", "ficha-panel.tsx");
    expect(panel.match(/disabled=\{guardando\}\s+onClick=\{\(\) => void confirmar(Edicion\(clave\))?\(?\)?\}/g)?.length).toBe(2);
  });

  it("get_vertical_pack recuerda que la semilla necesita `version: 1`", () => {
    expect(fuente("src", "server", "platform", "mcp", "herramientas.ts")).toContain("combínalo con `version: 1`");
  });
});
