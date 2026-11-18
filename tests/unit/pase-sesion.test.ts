import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 069 (staging) — Cookies de un host + pase de sesión de un solo uso.
 *
 * - Sin `crossSubDomainCookies`: la sesión de la raíz y la de un subdominio
 *   no se pisan, y `*.sslip.io` (Public Suffix List) funciona.
 * - El pase: firmado, ≤ 60 s, atado al host, de un solo uso y re-verificado.
 * - La puerta de las páginas de `/platform`: login sin sesión, 404 a quien no
 *   es Super-Admin, y desde un subdominio, a la raíz.
 */

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  membresia: vi.fn(),
  esSuperAdmin: vi.fn(),
  grantVigente: vi.fn(),
  orgPorId: vi.fn(),
  orgPorSlug: vi.fn(),
  sesion: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ BETTER_AUTH_SECRET: "s".repeat(40), APP_BASE_URL: "http://169.58.118.66.sslip.io" }),
}));
vi.mock("@/server/tenant/consultas", () => ({
  membresia: h.membresia,
  esSuperAdmin: h.esSuperAdmin,
  grantVigente: h.grantVigente,
  orgPorId: h.orgPorId,
  orgPorSlug: h.orgPorSlug,
  membresiasDe: vi.fn(async () => []),
}));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: h.sesion } }) }));

import { accesoPermiteEntrar, canjearPase, emitirPase, firmarPase, leerPase, PASE_TTL_MS } from "@/server/platform/pase";
import { resetRateLimit } from "@/lib/rate-limit";
import { decidirPaginaPlataforma } from "@/server/platform/guardia";
import { POST as pedirPase } from "@/app/api/pase/route";

const fake = () => h.fake!;
const SECRETO = "s".repeat(40);
const BASE = "169.58.118.66.sslip.io";
const ORG = { id: "org_A", slug: "clinica", status: "activa", modules: null };
const AHORA = Date.UTC(2026, 10, 17, 12, 0, 0);

beforeEach(() => {
  fake().reiniciar();
  resetRateLimit();
  vi.stubEnv("TENANCY", "multi");
  vi.stubEnv("PLATFORM_BASE_DOMAIN", BASE);
  vi.stubEnv("APP_BASE_URL", `http://${BASE}`);
  h.orgPorId.mockResolvedValue(ORG);
  h.orgPorSlug.mockImplementation(async (slug: string) => (slug === "clinica" ? ORG : { ...ORG, id: "org_B", slug }));
  h.membresia.mockResolvedValue(null);
  h.esSuperAdmin.mockResolvedValue(false);
  h.grantVigente.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("cookies de un host", () => {
  it("Better Auth ya no comparte la cookie entre subdominios", () => {
    const fuente = readFileSync("src/lib/auth/index.ts", "utf8");
    expect(fuente).not.toMatch(/crossSubDomainCookies/);
    expect(fuente).toMatch(/pasePlataforma\(\)/);
  });
});

describe("pase — firma (pura)", () => {
  const carga = { u: "u_1", o: "org_A", n: "nonce", e: AHORA + 30_000 };

  it("ida y vuelta", () => {
    expect(leerPase(firmarPase(carga, SECRETO), SECRETO, AHORA)).toEqual(carga);
  });
  it("otra clave, firma alterada o carga alterada → null", () => {
    const t = firmarPase(carga, SECRETO);
    expect(leerPase(t, "otra".repeat(10), AHORA)).toBeNull();
    expect(leerPase(`${t}x`, SECRETO, AHORA)).toBeNull();
    const otra = Buffer.from(JSON.stringify({ ...carga, u: "u_admin" })).toString("base64url");
    expect(leerPase(`${otra}.${t.split(".")[1]}`, SECRETO, AHORA)).toBeNull();
    expect(leerPase("basura", SECRETO, AHORA)).toBeNull();
  });
  it("vencido, o con una vida mayor a 60 s → null", () => {
    expect(leerPase(firmarPase(carga, SECRETO), SECRETO, carga.e)).toBeNull();
    expect(leerPase(firmarPase({ ...carga, e: AHORA + PASE_TTL_MS + 1 }, SECRETO), SECRETO, AHORA)).toBeNull();
  });
});

describe("pase — emitir", () => {
  it("sin membresía ni soporte vigente → 403, sin escribir nada", async () => {
    const r = await emitirPase("u_1", "org_A", null, AHORA);
    expect(r).toEqual({ ok: false, error: { status: 403, code: "sin_acceso" } });
    expect(fake().escrituras).toEqual([]);
  });

  it("miembro → nonce de un uso que vence en 60 s, auditoría y URL en el subdominio (http en staging)", async () => {
    h.membresia.mockResolvedValue({ role: "owner" });
    const r = await emitirPase("u_1", "org_A", "1.2.3.4", AHORA);
    if (!r.ok) throw new Error("debía emitir");
    expect(r.url).toMatch(new RegExp(`^http://clinica\\.${BASE.replace(/\./g, "\\.")}/api/auth/pase/canjear\\?t=`));
    const [nonce] = fake().de(schema.verification, "insert").map((e) => e.valores);
    expect(nonce).toMatchObject({ value: "u_1:org_A", expiresAt: new Date(AHORA + PASE_TTL_MS) });
    expect(String(nonce?.identifier)).toMatch(/^pase:/);
    expect(fake().de(schema.platformAuditLog)[0]?.valores).toMatchObject({
      action: "pase_emitido",
      organizationId: "org_A",
      detail: { acceso: "miembro" },
    });
  });

  it("Super-Admin con soporte vigente → emite (acceso «soporte»); sin ser Super-Admin, el grant no cuenta", async () => {
    h.grantVigente.mockResolvedValue({ id: "sop_1", level: "lectura", expiresAt: new Date(AHORA + 3_600_000) });
    expect((await emitirPase("u_1", "org_A", null, AHORA)).ok).toBe(false);
    h.esSuperAdmin.mockResolvedValue(true);
    expect((await emitirPase("u_1", "org_A", null, AHORA)).ok).toBe(true);
  });

  it("en `single` no existe", async () => {
    vi.stubEnv("TENANCY", "single");
    expect(await emitirPase("u_1", "org_A", null, AHORA)).toMatchObject({ ok: false, error: { status: 404 } });
  });
});

describe("pase — canjear", () => {
  const token = (u = "u_1", o = "org_A") => firmarPase({ u, o, n: "n1", e: AHORA + 30_000 }, SECRETO);

  it("en su subdominio, sin usar y con acceso → ok; borra el nonce y audita", async () => {
    h.membresia.mockResolvedValue({ role: "owner" });
    const r = await canjearPase(token(), `clinica.${BASE}`, null, AHORA);
    expect(r).toEqual({ ok: true, userId: "u_1", organizationId: "org_A" });
    expect(fake().de(schema.verification, "delete")).toHaveLength(1);
    expect(fake().de(schema.platformAuditLog)[0]?.valores).toMatchObject({ action: "pase_canjeado" });
  });

  it("en otro host (otro negocio o la raíz) → host_ajeno, sin consumirlo", async () => {
    h.membresia.mockResolvedValue({ role: "owner" });
    expect(await canjearPase(token(), `otro.${BASE}`, null, AHORA)).toEqual({ ok: false, motivo: "host_ajeno" });
    expect(await canjearPase(token(), BASE, null, AHORA)).toEqual({ ok: false, motivo: "host_ajeno" });
    expect(fake().de(schema.verification, "delete")).toEqual([]);
  });

  it("un solo uso: el segundo canje no encuentra el nonce → usado", async () => {
    h.membresia.mockResolvedValue({ role: "owner" });
    fake().responder("delete:returning", [{ id: "v1" }]);
    fake().responder("delete:returning", []);
    expect((await canjearPase(token(), `clinica.${BASE}`, null, AHORA)).ok).toBe(true);
    expect(await canjearPase(token(), `clinica.${BASE}`, null, AHORA)).toEqual({ ok: false, motivo: "usado" });
  });

  it("si el acceso se cerró entre emitir y canjear → sin_acceso", async () => {
    expect(await canjearPase(token(), `clinica.${BASE}`, null, AHORA)).toEqual({ ok: false, motivo: "sin_acceso" });
  });

  it("firma inválida o vencido → invalido", async () => {
    expect(await canjearPase("x.y", `clinica.${BASE}`, null, AHORA)).toEqual({ ok: false, motivo: "invalido" });
    expect(await canjearPase(token(), `clinica.${BASE}`, null, AHORA + 31_000)).toEqual({ ok: false, motivo: "invalido" });
  });
});

describe("POST /api/pase", () => {
  const pedir = (headers: Record<string, string> = {}) =>
    pedirPase(
      new Request(`http://${BASE}/api/pase`, {
        method: "POST",
        headers: { host: BASE, "content-type": "application/json", ...headers },
        body: JSON.stringify({ organizationId: "org_A" }),
      })
    );

  it("sin sesión → 401; sin Origin o de otro origen → 403; en `single` → 404", async () => {
    h.sesion.mockResolvedValue(null);
    expect((await pedir({ origin: `http://${BASE}` })).status).toBe(401);
    expect((await pedir()).status).toBe(403);
    expect((await pedir({ origin: "https://evil.example" })).status).toBe(403);
    vi.stubEnv("TENANCY", "single");
    expect((await pedir({ origin: `http://${BASE}` })).status).toBe(404);
  });

  it("con sesión y acceso → la URL del pase; sin acceso → 403", async () => {
    h.sesion.mockResolvedValue({ user: { id: "u_1" } });
    expect((await pedir({ origin: `http://${BASE}` })).status).toBe(403);
    h.membresia.mockResolvedValue({ role: "owner" });
    const res = await pedir({ origin: `http://${BASE}` });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toContain(`clinica.${BASE}/api/auth/pase/canjear`);
  });
});

describe("puerta de las páginas de /platform", () => {
  const base = { multi: true, hostDeNegocio: false, urlRaizPlatform: `http://${BASE}/platform`, sesion: true, superAdmin: true };
  it("sin sesión → login (no 404)", () => {
    expect(decidirPaginaPlataforma({ ...base, sesion: false, superAdmin: false })).toEqual({ tipo: "redirigir", a: "/login" });
  });
  it("con sesión de alguien que no es Super-Admin → 404", () => {
    expect(decidirPaginaPlataforma({ ...base, superAdmin: false })).toEqual({ tipo: "404" });
  });
  it("desde el subdominio de un negocio → a <raiz>/platform", () => {
    expect(decidirPaginaPlataforma({ ...base, hostDeNegocio: true })).toEqual({ tipo: "redirigir", a: `http://${BASE}/platform` });
  });
  it("fuera de `multi` → 404; Super-Admin en la raíz → pasa", () => {
    expect(decidirPaginaPlataforma({ ...base, multi: false })).toEqual({ tipo: "404" });
    expect(decidirPaginaPlataforma(base)).toEqual({ tipo: "pasar" });
  });
});

describe("auditoría final F-03 — negocios suspendidos", () => {
  const SUSPENDIDA = { ...ORG, status: "suspendida" };

  it("regla pura: el miembro no entra a uno suspendido; el soporte sí", () => {
    expect(accesoPermiteEntrar("miembro", "activa")).toBe(true);
    expect(accesoPermiteEntrar("miembro", "suspendida")).toBe(false);
    expect(accesoPermiteEntrar("soporte", "suspendida")).toBe(true);
    expect(accesoPermiteEntrar(null, "activa")).toBe(false);
  });

  it("emitir para un miembro de un negocio suspendido → 403 organizacion_suspendida, sin escribir", async () => {
    h.orgPorId.mockResolvedValue(SUSPENDIDA);
    h.membresia.mockResolvedValue({ role: "owner" });
    expect(await emitirPase("u_1", "org_A", null, AHORA)).toEqual({
      ok: false,
      error: { status: 403, code: "organizacion_suspendida" },
    });
    expect(fake().escrituras).toEqual([]);
  });

  it("Super-Admin con soporte vigente en un suspendido → emite", async () => {
    h.orgPorId.mockResolvedValue(SUSPENDIDA);
    h.esSuperAdmin.mockResolvedValue(true);
    h.grantVigente.mockResolvedValue({ id: "sop_1", level: "lectura", expiresAt: new Date(AHORA + 3_600_000) });
    expect((await emitirPase("u_1", "org_A", null, AHORA)).ok).toBe(true);
  });

  it("canjear como miembro de un negocio que se suspendió entre medias → sin_acceso", async () => {
    h.orgPorSlug.mockResolvedValue(SUSPENDIDA);
    h.membresia.mockResolvedValue({ role: "owner" });
    const token = firmarPase({ u: "u_1", o: "org_A", n: "n9", e: AHORA + 30_000 }, SECRETO);
    expect(await canjearPase(token, `clinica.${BASE}`, null, AHORA)).toEqual({ ok: false, motivo: "sin_acceso" });
  });
});

describe("auditoría final F-04 — límites y limpieza del pase", () => {
  const pedir = (host = BASE) =>
    pedirPase(
      new Request(`http://${host}/api/pase`, {
        method: "POST",
        headers: { host, origin: `http://${host}`, "content-type": "application/json" },
        body: JSON.stringify({ organizationId: "org_A" }),
      })
    );

  it("emitir purga los pases vencidos de `verification` antes de guardar el nuevo", async () => {
    h.membresia.mockResolvedValue({ role: "owner" });
    await emitirPase("u_1", "org_A", null, AHORA);
    const ops = fake()
      .escrituras.filter((e) => e.tabla === schema.verification)
      .map((e) => e.op);
    expect(ops).toEqual(["delete", "insert"]);
  });

  it("solo en el dominio raíz: desde el subdominio de un negocio → 404", async () => {
    h.sesion.mockResolvedValue({ user: { id: "u_1" } });
    expect((await pedir(`clinica.${BASE}`)).status).toBe(404);
  });

  it("más de 10 pases por minuto para la misma persona → 429", async () => {
    h.sesion.mockResolvedValue({ user: { id: "u_1" } });
    h.membresia.mockResolvedValue({ role: "owner" });
    const estados: number[] = [];
    for (let i = 0; i < 11; i++) estados.push((await pedir()).status);
    expect(estados.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(estados[10]).toBe(429);
  });
});
