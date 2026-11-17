import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";

/**
 * 069 (D12, US2) — `aplicarBlueprint` contra una base falsa que registra lo
 * que se escribe. Las respuestas de cada SELECT se encolan por tabla.
 */

type Escritura = { op: "insert" | "update"; tabla: unknown; valores: Record<string, unknown> };

const estado = vi.hoisted(() => ({
  respuestas: new Map<unknown, unknown[][]>(),
  escrituras: [] as { op: "insert" | "update"; tabla: unknown; valores: Record<string, unknown> }[],
}));

function responder(tabla: unknown, filas: unknown[]) {
  const cola = estado.respuestas.get(tabla) ?? [];
  cola.push(filas);
  estado.respuestas.set(tabla, cola);
}

function fakeDb() {
  const select = () => {
    let tabla: unknown;
    const b: Record<string, unknown> = {
      from(t: unknown) {
        tabla = t;
        return b;
      },
      innerJoin: () => b,
      where: () => b,
      orderBy: () => b,
      groupBy: () => b,
      limit: () => Promise.resolve(estado.respuestas.get(tabla)?.shift() ?? []),
      then: (res: (v: unknown) => unknown) => res(estado.respuestas.get(tabla)?.shift() ?? []),
    };
    return b;
  };
  const db = {
    select,
    insert: (tabla: unknown) => ({
      values: (valores: Record<string, unknown> | Record<string, unknown>[]) => {
        for (const v of Array.isArray(valores) ? valores : [valores]) {
          estado.escrituras.push({ op: "insert", tabla, valores: v });
        }
        const p = Promise.resolve();
        return Object.assign(p, {
          onConflictDoNothing: () => ({ returning: () => Promise.resolve([{}]) }),
        });
      },
    }),
    update: (tabla: unknown) => ({
      set: (valores: Record<string, unknown>) => ({
        where: () => {
          estado.escrituras.push({ op: "update", tabla, valores });
          return Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ id: "x" }]) });
        },
      }),
    }),
    execute: () => Promise.resolve(),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return db;
}

vi.mock("@/lib/db", async (original) => ({
  ...(await original<typeof import("@/lib/db")>()),
  getDb: () => fakeDb(),
}));
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ APP_BASE_URL: "https://crm.local" }),
}));

import { aplicarBlueprint, BlueprintError } from "@/server/platform/blueprint/aplicar";
import { hashToken } from "@/server/platform/invitaciones";

const actor = { userId: "u_ops", via: "api" as const, tokenId: "pat_1" };
const de = (tabla: unknown, op?: Escritura["op"]) =>
  estado.escrituras.filter((e) => e.tabla === tabla && (!op || e.op === op));

beforeEach(() => {
  estado.respuestas.clear();
  estado.escrituras.length = 0;
  vi.stubEnv("TENANCY", "multi");
  vi.stubEnv("PLATFORM_BASE_DOMAIN", "aliantis.co");
});
afterEach(() => vi.unstubAllEnvs());

describe("069 — crear por Blueprint", () => {
  const bp = {
    version: 1,
    organization: { slug: "ferreteria-rojas", name: "Ferretería Rojas" },
    region: { country: "CO", locale: "es-CO", timezone: "America/Bogota" },
    owner: { email: "Dueno@Ferreteria.co" },
  };

  it("crea la organización sembrada, con región, marca e invitación de un uso", async () => {
    const r = await aplicarBlueprint(actor, { crear: true }, bp);
    expect(r.created).toBe(true);
    expect(r.slug).toBe("ferreteria-rojas");
    expect(r.sections).toMatchObject({ organization: "creada", region: "creada", brand: "creada", owner: "creada" });

    const [org] = de(schema.organization, "insert");
    expect(org?.valores).toMatchObject({ slug: "ferreteria-rojas", name: "Ferretería Rojas", status: "activa" });
    expect(de(schema.pipelineStage, "insert")).toHaveLength(5);
    expect(de(schema.agentProfile, "insert")).toHaveLength(1);

    const meta = JSON.parse(String(de(schema.organization, "update")[0]?.valores.metadata));
    expect(meta.region).toEqual({ country: "CO", locale: "es-CO", timezone: "America/Bogota" });
    expect(meta.branding.name).toBe("Ferretería Rojas");

    // El enlace sale una vez; en la base solo su hash, y el correo normalizado.
    expect(r.invitation?.status).toBe("creada");
    const url = r.invitation && "url" in r.invitation ? r.invitation.url : "";
    expect(url).toMatch(/^https:\/\/ferreteria-rojas\.aliantis\.co\/invitacion\/[\w-]{43}$/);
    const token = url.split("/").pop()!;
    const [inv] = de(schema.invitation, "insert");
    expect(inv?.valores).toMatchObject({ email: "dueno@ferreteria.co", role: "owner", status: "pending" });
    expect(inv?.valores.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(estado.escrituras.map((e) => e.valores))).not.toContain(token);

    // Auditado: alta, invitación y Blueprint, con la vía y el token.
    const acciones = de(schema.platformAuditLog).map((e) => e.valores.action);
    expect(acciones).toEqual(["organizacion_creada", "invitacion_creada", "blueprint_aplicado"]);
    expect(de(schema.platformAuditLog)[2]?.valores).toMatchObject({ via: "api", tokenId: "pat_1" });
  });

  it("slug en uso → 409 sin escribir nada", async () => {
    responder(schema.organization, [{ id: "org_otro" }]);
    await expect(aplicarBlueprint(actor, { crear: true }, bp)).rejects.toMatchObject({
      code: "slug_en_uso",
      status: 409,
    });
    expect(estado.escrituras).toEqual([]);
  });

  it("sin slug o sin nombre → 422", async () => {
    await expect(
      aplicarBlueprint(actor, { crear: true }, { version: 1, organization: { name: "X" } })
    ).rejects.toMatchObject({ code: "slug_requerido" });
    await expect(
      aplicarBlueprint(actor, { crear: true }, { version: 1, organization: { slug: "abc" } })
    ).rejects.toMatchObject({ code: "nombre_requerido" });
  });

  it("Blueprint inválido → 422 con la ruta exacta", async () => {
    const err = await aplicarBlueprint(actor, { crear: true }, { ...bp, brand: { accent: "azul" } }).catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintError);
    expect(err.issues).toEqual([{ path: "brand.accent", message: "color_invalido" }]);
  });

  it("`dryRun`: el plan sin URL de invitación, y solo queda la auditoría del plan", async () => {
    const r = await aplicarBlueprint(actor, { crear: true }, bp, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.invitation).toEqual({ status: "se_generaria" });
    // En la base falsa la transacción no se deshace; lo que importa es que
    // no se emitió ningún token y que el plan quedó auditado sin organización.
    expect(de(schema.invitation, "insert")).toEqual([]);
    const ultima = de(schema.platformAuditLog).at(-1)?.valores;
    expect(ultima).toMatchObject({ action: "blueprint_aplicado", organizationId: null });
    expect((ultima?.detail as { dryRun: boolean }).dryRun).toBe(true);
  });
});

describe("069 — aplicar sobre una existente (idempotencia)", () => {
  const fila = {
    id: "org_A",
    name: "Clínica Sol",
    slug: "clinica-sol",
    metadata: JSON.stringify({
      region: { country: "MX", locale: "es-MX", timezone: "America/Mexico_City" },
      branding: { name: "Clínica Sol", accent: "#10c4a5", currency: "MXN", favicon: null },
    }),
    modules: { agenda: true },
  };

  it("lo mismo que ya tiene → todo `sin_cambios` y ninguna escritura salvo la auditoría", async () => {
    responder(schema.organization, [fila]);
    const r = await aplicarBlueprint(
      actor,
      { organizationId: "org_A" },
      {
        version: 1,
        organization: { slug: "clinica-sol", name: "Clínica Sol" },
        region: { country: "MX", locale: "es-MX", timezone: "America/Mexico_City" },
        brand: { name: "Clínica Sol", accent: "#10C4A5", currency: "MXN" },
        modules: { agenda: true },
      }
    );
    expect(r.sections).toEqual({
      organization: "sin_cambios",
      region: "sin_cambios",
      brand: "sin_cambios",
      modules: "sin_cambios",
    });
    expect(estado.escrituras.filter((e) => e.tabla !== schema.platformAuditLog)).toEqual([]);
  });

  it("solo cambia lo que trae; lo ausente no se toca", async () => {
    responder(schema.organization, [fila]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, region: { locale: "es-CO" } });
    expect(r.sections).toEqual({ region: "actualizada" });
    const meta = JSON.parse(String(de(schema.organization, "update")[0]?.valores.metadata));
    expect(meta.region).toEqual({ country: "MX", locale: "es-CO", timezone: "America/Mexico_City" });
    expect(meta.branding.accent).toBe("#10c4a5");
  });

  it("el slug es inmutable", async () => {
    responder(schema.organization, [fila]);
    await expect(
      aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, organization: { slug: "otra-cosa" } })
    ).rejects.toMatchObject({ code: "slug_inmutable" });
  });

  it("organización inexistente → 404", async () => {
    await expect(aplicarBlueprint(actor, { organizationId: "org_X" }, { version: 1 })).rejects.toMatchObject({
      code: "organizacion_inexistente",
      status: 404,
    });
  });

  it("owner con invitación pendiente → `pendiente`, sin enlace nuevo", async () => {
    responder(schema.organization, [fila]);
    responder(schema.member, []); // no es miembro
    responder(schema.invitation, [{ id: "inv_1", expiresAt: new Date(Date.now() + 1e6) }]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, owner: { email: "a@b.co" } });
    expect(r.invitation).toEqual({ status: "pendiente" });
    expect(r.sections.owner).toBe("sin_cambios");
    expect(de(schema.invitation, "insert")).toEqual([]);
  });

  it("owner que ya es miembro → `ya_miembro`", async () => {
    responder(schema.organization, [fila]);
    responder(schema.member, [{ id: "mem_1" }]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, owner: { email: "a@b.co" } });
    expect(r.invitation).toEqual({ status: "ya_miembro" });
  });

  it("`regenerate` revoca la pendiente y emite un enlace nuevo", async () => {
    responder(schema.organization, [fila]);
    responder(schema.member, []);
    responder(schema.invitation, [{ id: "inv_1", expiresAt: new Date(Date.now() + 1e6) }]);
    const r = await aplicarBlueprint(
      actor,
      { organizationId: "org_A" },
      { version: 1, owner: { email: "a@b.co", regenerate: true } }
    );
    expect(r.invitation?.status).toBe("creada");
    expect(de(schema.invitation, "update")[0]?.valores).toEqual({ status: "canceled" });
  });

  it("secciones de la US8 todavía no se aplican: 422 explícito", async () => {
    await expect(
      aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, pipeline: { stages: ["Nuevo"] } })
    ).rejects.toMatchObject({ code: "seccion_no_disponible" });
  });
});
