import { describe, expect, it, vi } from "vitest";
import { resolverContexto, type DepsContexto, type OrgFila } from "@/server/tenant/contexto";

/**
 * 069 (D4, FR-010) — El resolvedor, sin base de datos. Dos negocios, A y B;
 * Ana es miembro de A, Beto de A y B, Ops es Super-Admin.
 */

const A: OrgFila = { id: "org_A", slug: "negocio-a", status: "activa", modules: null };
const B: OrgFila = { id: "org_B", slug: "negocio-b", status: "activa", modules: { agenda: false } };
const S: OrgFila = { id: "org_S", slug: "suspendido", status: "suspendida", modules: null };
const orgs = [A, B, S];
const miembros: Record<string, Record<string, string>> = {
  ana: { org_A: "owner" },
  beto: { org_A: "agent", org_B: "owner", org_S: "owner" },
};

function deps(over: Partial<DepsContexto> & { userId?: string | null; active?: string | null } = {}): DepsContexto {
  const userId = over.userId === undefined ? "ana" : over.userId;
  return {
    modo: "multi",
    base: "aliantis.co",
    host: "aliantis.co",
    sesion: async () => (userId ? { userId, activeOrganizationId: over.active ?? null } : null),
    techo: () => ({ agenda: true, atribucion: true, channels: new Set(["whatsapp"]) }),
    membresiaUnicaInstancia: async (u) => {
      const [organizationId, role] = Object.entries(miembros[u] ?? {})[0] ?? [];
      return organizationId && role ? { organizationId, role } : null;
    },
    orgPorSlug: async (s) => orgs.find((o) => o.slug === s) ?? null,
    orgPorId: async (id) => orgs.find((o) => o.id === id) ?? null,
    membresia: async (u, o) => (miembros[u]?.[o] ? { role: miembros[u]![o]! } : null),
    esSuperAdmin: async (u) => u === "ops",
    grantVigente: async () => null,
    ...over,
  };
}

describe("069 — resolvedor de organización", () => {
  it("sin sesión → anónimo", async () => {
    expect(await resolverContexto(deps({ userId: null }))).toEqual({ kind: "anonimo" });
  });

  it("`single`: la membresía de la instancia, módulos = techo (2.8.0)", async () => {
    const r = await resolverContexto(deps({ modo: "single", host: "negocio-b.aliantis.co" }));
    expect(r).toMatchObject({ kind: "organizacion", organizationId: "org_A", role: "owner", via: "miembro" });
    if (r.kind === "organizacion") expect(r.modulos.agenda).toBe(true);
  });

  it("host del negocio → esa organización, con su rol y sus módulos", async () => {
    const r = await resolverContexto(deps({ userId: "beto", host: "negocio-b.aliantis.co" }));
    expect(r).toMatchObject({ kind: "organizacion", organizationId: "org_B", role: "owner" });
    if (r.kind === "organizacion") expect(r.modulos.agenda).toBe(false);
  });

  it("A↛B: miembro solo de A en el host de B → ninguno, sin el id de B", async () => {
    const r = await resolverContexto(deps({ userId: "ana", host: "negocio-b.aliantis.co" }));
    expect(r).toEqual({ kind: "ninguno", userId: "ana", motivo: "no_miembro" });
  });

  it("el host manda sobre la organización activa de la sesión", async () => {
    const r = await resolverContexto(
      deps({ userId: "beto", host: "negocio-a.aliantis.co", active: "org_B" })
    );
    expect(r).toMatchObject({ kind: "organizacion", organizationId: "org_A", role: "agent" });
  });

  it("slug inexistente → ninguno", async () => {
    const r = await resolverContexto(deps({ host: "nadie.aliantis.co" }));
    expect(r).toMatchObject({ kind: "ninguno", motivo: "org_inexistente" });
  });

  it("raíz: la organización activa validada contra la membresía", async () => {
    expect(await resolverContexto(deps({ userId: "beto", active: "org_B" }))).toMatchObject({
      kind: "organizacion",
      organizationId: "org_B",
    });
    // Ana con una activa ajena (cookie vieja o manipulada) → no entra a B.
    expect(await resolverContexto(deps({ userId: "ana", active: "org_B" }))).toMatchObject({
      kind: "ninguno",
      motivo: "sin_organizacion",
    });
  });

  it("raíz sin organización activa → nunca «la primera»", async () => {
    const primera = vi.fn();
    const r = await resolverContexto(deps({ userId: "beto", membresiaUnicaInstancia: primera }));
    expect(r).toMatchObject({ kind: "ninguno", motivo: "sin_organizacion" });
    expect(primera).not.toHaveBeenCalled();
  });

  it("suspendida → suspendida (no organizacion)", async () => {
    const r = await resolverContexto(deps({ userId: "beto", host: "suspendido.aliantis.co" }));
    expect(r).toEqual({ kind: "suspendida", userId: "beto", organizationId: "org_S" });
  });

  it("Super-Admin en la raíz → plataforma", async () => {
    expect(await resolverContexto(deps({ userId: "ops" }))).toEqual({ kind: "plataforma", userId: "ops" });
  });

  it("Super-Admin sin acceso en el host de un negocio → ninguno (para auditar)", async () => {
    const r = await resolverContexto(deps({ userId: "ops", host: "negocio-a.aliantis.co" }));
    expect(r).toEqual({ kind: "ninguno", userId: "ops", motivo: "no_miembro", organizationId: "org_A" });
  });

  it("Super-Admin con acceso vigente → rol soporte en ESA organización", async () => {
    const grantVigente = vi.fn(async (_u: string, o: string) =>
      o === "org_A" ? { id: "sop_1", level: "lectura" as const, expiresAt: new Date() } : null
    );
    const a = await resolverContexto(deps({ userId: "ops", host: "negocio-a.aliantis.co", grantVigente }));
    expect(a).toMatchObject({ kind: "organizacion", organizationId: "org_A", role: "soporte", via: "soporte" });
    const b = await resolverContexto(deps({ userId: "ops", host: "negocio-b.aliantis.co", grantVigente }));
    expect(b).toMatchObject({ kind: "ninguno", organizationId: "org_B" });
  });

  it("el soporte no entra por la organización activa de la raíz", async () => {
    const grantVigente = vi.fn(async () => ({ id: "sop_1", level: "lectura" as const, expiresAt: new Date() }));
    const r = await resolverContexto(deps({ userId: "ops", active: "org_A", grantVigente }));
    expect(r).toEqual({ kind: "plataforma", userId: "ops" });
  });
});
