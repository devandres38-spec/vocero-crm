import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/** 069 (US3) — Aceptar una invitación: los casos y el uso único. */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null, signUp: vi.fn() }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { signUpEmail: h.signUp } }),
  runInternalSignup: <T>(fn: () => Promise<T>) => fn(),
}));

import { aceptarInvitacion, leerInvitacion } from "@/server/platform/aceptar";
import { hashToken } from "@/server/platform/invitaciones";

const TOKEN = "t".repeat(43);
const ahora = new Date("2026-11-17T12:00:00Z");
const futuro = new Date("2026-11-20T12:00:00Z");
const fake = () => h.fake!;

const invitacion = (over: Record<string, unknown> = {}) => ({
  status: "pending",
  expiresAt: futuro,
  email: "dueno@ferreteria.co",
  role: "owner",
  orgId: "org_A",
  orgName: "Ferretería Rojas",
  orgSlug: "ferreteria-rojas",
  ...over,
});
/** La fila que lee la transacción (con bloqueo). */
const filaTx = (over: Record<string, unknown> = {}) => ({
  id: "inv_1",
  organizationId: "org_A",
  status: "pending",
  expiresAt: futuro,
  role: "owner",
  email: "dueno@ferreteria.co",
  ...over,
});

beforeEach(() => {
  fake().reiniciar();
  h.signUp.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("069 — leer una invitación", () => {
  it.each([
    [{ status: "accepted" }, "usada"],
    [{ status: "canceled" }, "revocada"],
    [{ expiresAt: new Date("2026-11-10T00:00:00Z") }, "vencida"],
  ])("%j → %s", async (over, estado) => {
    fake().responder(schema.invitation, [invitacion(over)]);
    expect((await leerInvitacion(TOKEN, ahora)).estado).toBe(estado);
  });

  it("un token que no existe no revela nada", async () => {
    expect(await leerInvitacion(TOKEN, ahora)).toEqual({ estado: "inexistente" });
    expect(await leerInvitacion("", ahora)).toEqual({ estado: "inexistente" });
  });

  it("vigente: dice el negocio y si el correo ya tiene cuenta", async () => {
    fake().responder(schema.invitation, [invitacion()]);
    fake().responder(schema.user, [{ id: "u_1" }]);
    expect(await leerInvitacion(TOKEN, ahora)).toMatchObject({
      estado: "vigente",
      organizacion: { name: "Ferretería Rojas", slug: "ferreteria-rojas" },
      cuentaExiste: true,
    });
  });
});

describe("069 — aceptar", () => {
  it("correo nuevo: crea la cuenta y la membresía, y marca la invitación usada", async () => {
    fake().responder(schema.invitation, [invitacion()]);
    fake().responder(schema.user, []);
    fake().responder(schema.invitation, [filaTx()]);
    fake().responder(schema.member, []);
    h.signUp.mockResolvedValue({ user: { id: "u_nuevo" } });

    const r = await aceptarInvitacion({
      token: TOKEN,
      sesion: null,
      nueva: { name: "Dueño", password: "secreta123" },
      ahora,
    });
    expect(r).toMatchObject({ organizationId: "org_A", userId: "u_nuevo", cuentaCreada: true });
    expect(h.signUp).toHaveBeenCalledWith({
      body: { name: "Dueño", email: "dueno@ferreteria.co", password: "secreta123" },
    });
    expect(fake().de(schema.member, "insert")[0]?.valores).toMatchObject({
      organizationId: "org_A",
      userId: "u_nuevo",
      role: "owner",
    });
    expect(fake().de(schema.invitation, "update")[0]?.valores).toEqual({ status: "accepted", acceptedAt: ahora });
    expect(fake().de(schema.platformAuditLog)[0]?.valores.action).toBe("invitacion_aceptada");
  });

  it("con sesión del MISMO correo (otro caso de mayúsculas): acepta sin tocar su cuenta", async () => {
    fake().responder(schema.invitation, [invitacion()]);
    fake().responder(schema.user, [{ id: "u_1" }]);
    fake().responder(schema.invitation, [filaTx()]);
    fake().responder(schema.member, []);
    const r = await aceptarInvitacion({
      token: TOKEN,
      sesion: { userId: "u_1", email: "Dueno@Ferreteria.co" },
      ahora,
    });
    expect(r.cuentaCreada).toBe(false);
    expect(h.signUp).not.toHaveBeenCalled();
    expect(fake().de(schema.member, "insert")).toHaveLength(1);
  });

  it("idempotente: si ya es miembro no se duplica la membresía", async () => {
    fake().responder(schema.invitation, [invitacion()]);
    fake().responder(schema.user, [{ id: "u_1" }]);
    fake().responder(schema.invitation, [filaTx()]);
    fake().responder(schema.member, [{ id: "mem_1" }]);
    await aceptarInvitacion({ token: TOKEN, sesion: { userId: "u_1", email: "dueno@ferreteria.co" }, ahora });
    expect(fake().de(schema.member, "insert")).toEqual([]);
  });

  it("sesión de OTRO correo → 403 y nada se crea", async () => {
    fake().responder(schema.invitation, [invitacion()]);
    fake().responder(schema.user, []);
    await expect(
      aceptarInvitacion({ token: TOKEN, sesion: { userId: "u_x", email: "otra@persona.co" }, ahora })
    ).rejects.toMatchObject({ code: "otro_correo", status: 403 });
    expect(fake().escrituras).toEqual([]);
  });

  it("el correo ya tiene cuenta y no hay sesión → que inicie sesión (no se crea otra)", async () => {
    fake().responder(schema.invitation, [invitacion()]);
    fake().responder(schema.user, [{ id: "u_1" }]);
    await expect(
      aceptarInvitacion({ token: TOKEN, sesion: null, nueva: { name: "X", password: "12345678" }, ahora })
    ).rejects.toMatchObject({ code: "inicia_sesion" });
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("uso único: si otra pestaña la usó entre la lectura y la transacción → 410", async () => {
    fake().responder(schema.invitation, [invitacion()]);
    fake().responder(schema.user, [{ id: "u_1" }]);
    fake().responder(schema.invitation, [filaTx({ status: "accepted" })]);
    await expect(
      aceptarInvitacion({ token: TOKEN, sesion: { userId: "u_1", email: "dueno@ferreteria.co" }, ahora })
    ).rejects.toMatchObject({ code: "invitacion_usada", status: 410 });
    expect(fake().de(schema.member, "insert")).toEqual([]);
  });

  it.each([
    [{ status: "canceled" }, "invitacion_revocada"],
    [{ expiresAt: new Date("2026-11-01T00:00:00Z") }, "invitacion_vencida"],
  ])("%j → %s", async (over, code) => {
    fake().responder(schema.invitation, [invitacion(over)]);
    await expect(aceptarInvitacion({ token: TOKEN, sesion: null, ahora })).rejects.toMatchObject({ code });
  });

  it("el token en claro no se guarda: se busca por su SHA-256", () => {
    expect(hashToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(TOKEN)).not.toContain(TOKEN);
  });
});
