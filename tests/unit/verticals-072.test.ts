import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 072 (A1) — El registro de Vertical Packs: datos tipados, herencia de un
 * nivel, semillas que son Blueprint válido y ajustes por negocio que solo
 * son datos.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null }));
vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});

import { schema } from "@/lib/db";
import { fichaFieldsSchema } from "@/lib/ficha-campos";
import { blueprintSchema } from "@/lib/platform/blueprint";
import { experienciaDe } from "@/server/verticals/experiencia";
import { PACK_DEFAULT } from "@/verticals/default/pack";
import { extenderPack } from "@/verticals/extender";
import { esPackId, packDe, PACK_ID_RE, PACK_IDS, PACKS } from "@/verticals/registro";
import {
  EXPERIENCIA_DEFAULT,
  leerOverrides,
  resolverExperiencia,
  verticalOverridesSchema,
} from "@/verticals/resolver";
import { t, VOCABULARIO_BASE } from "@/verticals/vocabulario";

const VERTICALS = path.resolve(import.meta.dirname, "..", "..", "src", "verticals");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = path.join(dir, e);
    return statSync(full).isDirectory() ? archivos(full) : [full];
  });
}

describe("el registro", () => {
  it("entrega los tres packs con id válido y que coincide con su clave", () => {
    expect(PACK_IDS).toEqual(["default", "clinica-salud", "eventos-mobiliario"]);
    for (const id of PACK_IDS) {
      expect(PACKS[id].id).toBe(id);
      expect(id).toMatch(PACK_ID_RE);
    }
  });

  it("un id desconocido es `default`, nunca un error", () => {
    expect(packDe("ferreteria-magica").id).toBe("default");
    expect(packDe(null).id).toBe("default");
    expect(packDe("__proto__").id).toBe("default");
    expect(esPackId("toString")).toBe(false);
  });

  it("`default` está vacío: un negocio sin nicho ve lo de 2.11.0", () => {
    expect(EXPERIENCIA_DEFAULT).toEqual({
      pack: "default",
      vocabulario: VOCABULARIO_BASE,
      nav: { orden: [], ocultas: [], iconos: {} },
      inicio: null,
    });
  });

  it("cada semilla es un Blueprint v1 válido y cada ficha sugerida es un esquema válido", () => {
    for (const id of PACK_IDS) {
      const r = blueprintSchema.safeParse({ version: 1, ...PACKS[id].semilla });
      expect(r.success, `${id}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
      expect(fichaFieldsSchema.safeParse(PACKS[id].fichaFields).success, id).toBe(true);
    }
  });

  it("los widgets `proximos_por_fecha` apuntan a un campo `date` de su propia ficha", () => {
    for (const id of PACK_IDS) {
      for (const w of PACKS[id].inicio?.widgets ?? []) {
        if (w.tipo !== "proximos_por_fecha" || !("params" in w)) continue;
        const campo = PACKS[id].fichaFields.find((f) => f.key === w.params.campo);
        expect(campo?.type, `${id}: ${w.params.campo}`).toBe("date");
      }
    }
  });

  it("clínica y eventos se diferencian de verdad en vocabulario, inicio y ficha", () => {
    const c = resolverExperiencia("clinica-salud", null);
    const e = resolverExperiencia("eventos-mobiliario", null);
    expect(t(c.vocabulario, "contacto", "varios")).toBe("Pacientes");
    expect(t(e.vocabulario, "contacto", "varios")).toBe("Clientes");
    expect(c.inicio?.widgets[0]).toEqual({ tipo: "citas_de_hoy" });
    expect(e.inicio?.widgets[0]?.tipo).toBe("proximos_por_fecha");
    expect(PACKS["clinica-salud"].fichaFields.map((f) => f.key)).not.toEqual(
      PACKS["eventos-mobiliario"].fichaFields.map((f) => f.key)
    );
  });
});

describe("herencia de un nivel", () => {
  it("objetos se mezclan; arreglos reemplazan", () => {
    const base = extenderPack(PACK_DEFAULT, {
      id: "base-x",
      label: "x",
      description: "x",
      vocabulario: { cita: { uno: "Turno", varios: "Turnos" } },
      nav: { orden: ["/inbox"], iconos: { "/inbox": "bandeja" } },
      personas: [],
    });
    const hijo = extenderPack(base, {
      id: "hijo-x",
      label: "y",
      description: "y",
      vocabulario: { contacto: { uno: "Socio", varios: "Socios" } },
      nav: { orden: ["/pipeline"], iconos: { "/pipeline": "evento" } },
    });
    expect(hijo.vocabulario).toEqual({ cita: { uno: "Turno", varios: "Turnos" }, contacto: { uno: "Socio", varios: "Socios" } });
    expect(hijo.nav.orden).toEqual(["/pipeline"]);
    expect(hijo.nav.iconos).toEqual({ "/inbox": "bandeja", "/pipeline": "evento" });
    expect(hijo.inicio).toBeNull();
  });
});

describe("ajustes por negocio (solo datos)", () => {
  it("renombran, ocultan, ordenan y cambian el inicio", () => {
    const exp = resolverExperiencia("clinica-salud", {
      vocabulario: { contacto: { uno: "Usuario", varios: "Usuarios" } },
      nav: { ocultas: ["/results"] },
      inicio: { widgets: [{ tipo: "sin_responder" }] },
    });
    expect(t(exp.vocabulario, "contacto", "varios")).toBe("Usuarios");
    expect(t(exp.vocabulario, "cita")).toBe("Valoración");
    expect(exp.nav.ocultas).toEqual(["/results"]);
    expect(exp.nav.orden[0]).toBe("/inicio");
    expect(exp.inicio).toEqual({ widgets: [{ tipo: "sin_responder" }] });
  });

  it("basura o campos desconocidos = sin ajustes (no rompe la pantalla)", () => {
    for (const raw of ["x", 42, [], { codigo: "alert(1)" }, { nav: { ocultas: ["javascript:x"] } }]) {
      expect(leerOverrides(raw)).toBeNull();
      expect(resolverExperiencia("default", raw)).toEqual(EXPERIENCIA_DEFAULT);
    }
  });

  it("Ajustes no se oculta y el tamaño está acotado", () => {
    expect(verticalOverridesSchema.safeParse({ nav: { ocultas: ["/settings"] } }).success).toBe(false);
    expect(verticalOverridesSchema.safeParse({ nav: { ocultas: ["/settings/ai"] } }).success).toBe(false);
    const enorme = { nav: { orden: Array.from({ length: 20 }, (_, i) => `/${"a".repeat(50)}${i}`) }, vocabulario: Object.fromEntries(
      ["contacto", "lead", "pipeline", "cita", "bandeja", "ficha", "inicio", "resultados", "agente", "etapa"].map((k) => [k, { uno: "x".repeat(30), varios: "y".repeat(30) }])
    ) };
    expect(JSON.stringify(enorme).length).toBeLessThan(4096);
    expect(verticalOverridesSchema.safeParse(enorme).success).toBe(true);
    expect(verticalOverridesSchema.safeParse({ inicio: { widgets: Array(9).fill({ tipo: "sin_responder" }) } }).success).toBe(false);
  });
});

describe("guardarraíl: un pack son datos", () => {
  it("`src/verticals/**` no importa React, Next, el servidor ni la base", () => {
    const prohibidos = [/from "react"/, /from "next\//, /from "@\/server\//, /from "@\/lib\/db/, /from "@\/components\//];
    for (const file of archivos(VERTICALS)) {
      const code = readFileSync(file, "utf8");
      for (const re of prohibidos) expect(re.test(code), `${path.relative(VERTICALS, file)} ${re}`).toBe(false);
      // Lo que se importa de `@/lib` es solo de tipos o puro.
      for (const m of code.matchAll(/^import (?!type )[^;]*from "@\/lib\/([^"]+)"/gm)) {
        expect(["ficha-campos"]).toContain(m[1]);
      }
    }
  });
});

describe("migración 0032_motor_nicho", () => {
  const RAIZ = path.resolve(import.meta.dirname, "..", "..");
  const sql = readFileSync(path.join(RAIZ, "drizzle", "0032_motor_nicho.sql"), "utf8");

  it("es aditiva y re-ejecutable", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "vertical_pack" text DEFAULT 'default' NOT NULL/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "vertical_overrides" jsonb/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "ficha_fields" jsonb/);
    for (const ck of ["organization_vertical_pack_ck", "organization_vertical_overrides_tam_ck", "organization_ficha_fields_tam_ck"]) {
      expect(sql).toContain(`DROP CONSTRAINT IF EXISTS "${ck}"`);
    }
    expect(sql).not.toMatch(/DROP COLUMN|DROP TABLE|ALTER COLUMN/);
  });

  it("está en el journal, después de la 0031", () => {
    const journal = JSON.parse(readFileSync(path.join(RAIZ, "drizzle", "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags.indexOf("0032_motor_nicho")).toBe(tags.indexOf("0031_agente_trato") + 1);
  });
});

describe("experienciaDe (servidor)", () => {
  const original = process.env.TENANCY;
  afterEach(() => {
    process.env.TENANCY = original;
    h.fake!.reiniciar();
  });

  it("en `single` es `default` sin tocar la base (D22)", async () => {
    process.env.TENANCY = "single";
    h.fake!.responder(schema.organization, [{ verticalPack: "clinica-salud", verticalOverrides: null }]);
    expect(await experienciaDe("org_single")).toEqual(EXPERIENCIA_DEFAULT);
  });

  it("en `multi` lee el pack y los ajustes de ESA organización", async () => {
    process.env.TENANCY = "multi";
    h.fake!.responder(schema.organization, [{ verticalPack: "eventos-mobiliario", verticalOverrides: null }]);
    const exp = await experienciaDe("org_multi_1");
    expect(exp.pack).toBe("eventos-mobiliario");
  });

  it("un pack que ya no existe cae a `default` con aviso", async () => {
    process.env.TENANCY = "multi";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.fake!.responder(schema.organization, [{ verticalPack: "ferreteria", verticalOverrides: null }]);
    expect((await experienciaDe("org_multi_2")).pack).toBe("default");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
