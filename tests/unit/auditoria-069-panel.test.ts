import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";
import { archivosTs, leerSinComentarios, rel } from "./helpers/fuentes";

/**
 * Auditoría 069, Fix-C/D — Lo que el panel rediseñado necesita del servidor:
 * el directorio (color, región y módulos de cada negocio), el logo desde la
 * ficha (con la misma validación que Ajustes → Marca, y auditado), el filtro
 * del directorio y la puerta única de toda la API de plataforma.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null, esSuperAdmin: vi.fn(), media: vi.fn() }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/tenant/consultas", () => ({ esSuperAdmin: h.esSuperAdmin }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));
vi.mock("@/server/whatsapp/media", () => ({
  saveMediaFile: h.media,
  deleteMediaFile: vi.fn(async () => undefined),
  readMediaFile: vi.fn(async () => Buffer.from("x")),
}));

import { listarOrganizaciones } from "@/server/platform/organizaciones";
import { PUT as subirLogo, GET as verLogo } from "@/app/api/platform/organizations/[idOrSlug]/favicon/route";
import { filtrarNegocios, type NegocioDirectorio } from "@/components/plataforma/directorio-negocios";
import { mover } from "@/components/plataforma/formulario/controles";

const fake = () => h.fake!;
const TOKEN = `alp_${"x".repeat(43)}`;
const filaToken = (scopes: string[]) => ({
  id: "pat_1",
  userId: "u_ops",
  scopes,
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: new Date(),
});
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

beforeEach(() => {
  fake().reiniciar();
  h.esSuperAdmin.mockResolvedValue(true);
  vi.stubEnv("TENANCY", "multi");
  vi.stubEnv("PLATFORM_BASE_DOMAIN", "aliantis.co");
  vi.stubEnv("AGENDA", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Fix-D — directorio", () => {
  it("cada negocio trae su color, país, moneda y módulos efectivos (dentro del techo)", async () => {
    fake().responder(schema.organization, [
      {
        id: "org_A",
        slug: "clinica-sol",
        name: "Clínica Sol",
        status: "activa",
        createdAt: new Date(),
        suspendedAt: null,
        metadata: JSON.stringify({ region: { country: "CO" }, branding: { name: "Sol", accent: "#3f5972", currency: "COP" } }),
        modules: { agenda: false },
      },
      { id: "org_B", slug: "b", name: "B", status: "suspendida", createdAt: new Date(), suspendedAt: new Date(), metadata: null, modules: null },
    ]);
    fake().responder(schema.member, [{ organizationId: "org_A", n: 3 }]);
    const [a, b] = await listarOrganizaciones();
    expect(a).toMatchObject({ accent: "#3f5972", country: "CO", currency: "COP", miembros: 3, modulos: { agenda: false } });
    expect(b).toMatchObject({ country: null, miembros: 0, modulos: { agenda: true } });
    expect(a).not.toHaveProperty("metadata");
  });

  const n = (o: Partial<NegocioDirectorio>): NegocioDirectorio => ({
    id: "x",
    slug: "x",
    name: "X",
    status: "activa",
    miembros: 0,
    accent: "#0d3b9e",
    country: null,
    currency: "COP",
    agenda: false,
    atribucion: false,
    canales: ["whatsapp"],
    soporteVigente: false,
    ...o,
  });
  const xs = [
    n({ id: "1", name: "Peluquería Única", slug: "peluqueria" }),
    n({ id: "2", name: "Taller Rojas", slug: "taller-rojas", status: "suspendida" }),
  ];

  it("busca por nombre (sin acentos) o por dirección, y filtra por estado", () => {
    expect(filtrarNegocios(xs, "UNICA", "todos").map((o) => o.id)).toEqual(["1"]);
    expect(filtrarNegocios(xs, "rojas", "todos").map((o) => o.id)).toEqual(["2"]);
    expect(filtrarNegocios(xs, "", "suspendida").map((o) => o.id)).toEqual(["2"]);
    expect(filtrarNegocios(xs, "rojas", "activa")).toEqual([]);
  });

  it("mover reordena sin salirse de la lista", () => {
    expect(mover(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(mover(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("Fix-C — logo desde la ficha", () => {
  const params = { params: Promise.resolve({ idOrSlug: "clinica-sol" }) };
  const req = (body: Uint8Array, method = "PUT") =>
    new Request("https://aliantis.co/api/platform/organizations/clinica-sol/favicon", {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/png" },
      body: new Blob([new Uint8Array(body)]),
    });

  it("PNG válido con `provision` → se guarda y queda auditado `icono_cambiado`", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read", "provision"])]);
    fake().responder(schema.organization, [{ id: "org_A", slug: "clinica-sol" }]);
    fake().responder(schema.organization, [{ metadata: null }]); // getBranding
    fake().responder(schema.organization, [{ metadata: null }]); // saveBranding lee antes de escribir
    const res = await subirLogo(req(PNG), params);
    expect(res.status).toBe(200);
    expect(h.media).toHaveBeenCalledWith("org_A", "favicon", expect.any(Uint8Array), "image/png");
    expect(fake().de(schema.platformAuditLog).map((e) => e.valores)).toEqual([
      expect.objectContaining({ action: "icono_cambiado", organizationId: "org_A", via: "api", detail: { mime: "image/png" } }),
    ]);
  });

  it("un archivo que no es imagen → 422 sin guardar ni auditar", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read", "provision"])]);
    fake().responder(schema.organization, [{ id: "org_A", slug: "clinica-sol" }]);
    const res = await subirLogo(req(new TextEncoder().encode("<html>hola</html>")), params);
    expect(res.status).toBe(422);
    expect(h.media).not.toHaveBeenCalled();
    expect(fake().de(schema.platformAuditLog)).toEqual([]);
  });

  it("solo `read` no sube (403); sin credenciales, 404", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    expect((await subirLogo(req(PNG), params)).status).toBe(403);
    const anonimo = new Request("https://aliantis.co/x", { method: "GET" });
    expect((await verLogo(anonimo, params)).status).toBe(404);
  });
});

describe("Fix-C — la puerta única de la API de plataforma", () => {
  it("toda ruta de /api/platform pasa por requirePlataforma (el MCP, por su token)", () => {
    const rutas = archivosTs(join(process.cwd(), "src/app/api/platform")).filter((f) => f.endsWith("route.ts"));
    expect(rutas.length).toBeGreaterThan(10);
    for (const f of rutas) {
      const fuente = leerSinComentarios(f);
      if (rel(f) === "src/app/api/platform/mcp/route.ts") {
        expect(fuente, rel(f)).toMatch(/verificarToken\(/);
        continue;
      }
      const metodos = fuente.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
      // `cambiarEstadoHttp` (suspender/reactivar) lleva la guarda dentro: se comprueba abajo.
      const guardas = fuente.match(/requirePlataforma\(|cambiarEstadoHttp\(/g) ?? [];
      expect(guardas.length, rel(f)).toBeGreaterThanOrEqual(metodos.length);
    }
    const estado = leerSinComentarios(join(process.cwd(), "src/server/platform/estado-http.ts"));
    expect(estado).toMatch(/requirePlataforma\(req, \{ scope: "provision" \}\)/);
  });
});
