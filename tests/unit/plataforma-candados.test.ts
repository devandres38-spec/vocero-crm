import { afterEach, describe, expect, it, vi } from "vitest";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { despachoActivo } from "@/server/brains/config";
import { comprobarSegmento, llaveDeMedia } from "@/lib/storage/medios";
import { organizationPathBloqueado } from "@/lib/auth";

/** 069 (US1) — Los candados del modo plataforma y su ausencia en `single`. */

const KEY = "llave-de-prueba-suficientemente-larga";
const conLlave = () =>
  new Request("http://x/api/bot/profile", { headers: { "x-api-key": KEY } });

afterEach(() => vi.unstubAllEnvs());

describe("069 — /api/bot/* por modo", () => {
  it("`multi`: 404 vacío aunque la llave sea válida", async () => {
    vi.stubEnv("TENANCY", "multi");
    vi.stubEnv("BOT_API_KEY", KEY);
    const res = requireBotKey(conLlave());
    expect(res?.status).toBe(404);
    expect(await res?.text()).toBe("");
  });

  it("`multi`: la organización de la instancia no existe", async () => {
    vi.stubEnv("TENANCY", "multi");
    expect(await resolveInstanceOrg()).toBeNull();
  });

  it("`single`: la llave válida pasa y sin llave es 401, como siempre", () => {
    vi.stubEnv("BOT_API_KEY", KEY);
    expect(requireBotKey(conLlave())).toBeNull();
    expect(requireBotKey(new Request("http://x/api/bot/profile"))?.status).toBe(401);
  });
});

describe("069 — despacho al cerebro por modo", () => {
  it("`single` con URL y llave: activo", () => {
    vi.stubEnv("BRAIN_DISPATCH_URL", "http://nea:8000/despacho");
    vi.stubEnv("BOT_API_KEY", KEY);
    expect(despachoActivo()).toBe(true);
  });

  it("`multi` con la misma configuración: apagado hasta la 070", () => {
    vi.stubEnv("TENANCY", "multi");
    vi.stubEnv("BRAIN_DISPATCH_URL", "http://nea:8000/despacho");
    vi.stubEnv("BOT_API_KEY", KEY);
    expect(despachoActivo()).toBe(false);
  });
});

describe("069 — segmentos de ruta de medios", () => {
  it.each([".", "..", "...", "a/b", "a\b", "", "../org_B", "org A"])("rechaza %j", (s) => {
    expect(() => comprobarSegmento(s)).toThrow(/segmento de ruta inválido/);
  });

  it.each(["org_abc123", "ma_x1.jpg", "a-b.c_d", ".oculto"])("acepta %j", (s) => {
    expect(() => comprobarSegmento(s)).not.toThrow();
  });

  it("un asset `..` no sale de la carpeta de su organización", () => {
    expect(() => llaveDeMedia("org_A", "..")).toThrow();
  });
});

describe("069 — API propia del plugin organization cerrada", () => {
  it.each([
    "/organization/create",
    "/organization/invite-member",
    "/organization/accept-invitation",
    "/organization/update",
    "/organization/delete",
    "/organization/add-member",
  ])("bloquea %s", (p) => {
    expect(organizationPathBloqueado(p)).toBe(true);
  });

  it("deja set-active (selector) y lo que no es del plugin", () => {
    expect(organizationPathBloqueado("/organization/set-active")).toBe(false);
    expect(organizationPathBloqueado("/sign-in/email")).toBe(false);
  });
});
