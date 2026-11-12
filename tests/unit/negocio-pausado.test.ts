import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 076 (respuesta 2 de Andres) — Un negocio pausado por Andres:
 * - su personal no inicia sesión (403 con el motivo) ni usa una sesión vieja;
 * - el bot queda como con el Agente apagado: lo normal no se despacha, lo de
 *   salud SÍ (D9: la seguridad del paciente no se pausa).
 */
const h = vi.hoisted(() => ({
  base: null as unknown as ReturnType<typeof import("./fixtures/base-grabadora").baseGrabadora>,
  encolar: vi.fn(async () => ({ notBefore: new Date() })),
  membresia: null as null | { organizationId: string; role: string; pausado: boolean },
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => h.base.db };
});
vi.mock("@/server/dispatch/outbox", () => ({ encolarDespacho: h.encolar }));
vi.mock("@/server/dispatch/worker", () => ({ iniciarWorker: vi.fn(), programarTanda: vi.fn() }));
vi.mock("@/server/db-sistema", () => ({ membresiaDe: async () => h.membresia }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: async () => ({ user: { id: "usr_1" }, session: {} }) } }),
}));

import { schema } from "@/lib/db";
import { NegocioPausado, requireSession } from "@/lib/auth/session";
import { antesDeCrearSesion, MENSAJE_NEGOCIO_PAUSADO } from "@/server/auth/on-signup";
import { despacharAlCerebro } from "@/server/dispatch/encolar";

const CONV_VIVA = [{ aiEnabled: true, handoffAt: null, isTest: false }];

beforeEach(() => {
  h.base = baseGrabadora();
  h.encolar.mockClear();
  h.membresia = null;
});

describe("076 — el bot de un negocio pausado", () => {
  it("con el Agente encendido pero el negocio pausado, lo normal NO se despacha", async () => {
    h.base.responder(schema.conversation, CONV_VIVA);
    h.base.responder(schema.agentProfile, [{ enabled: true }]);
    h.base.responder(schema.organization, [{ pausadoEn: new Date() }]);
    await despacharAlCerebro("cv_1", "org_1", "msg_1", { salud: false });
    expect(h.encolar).not.toHaveBeenCalled();
  });

  it("lo marcado con salud SÍ se despacha (D9)", async () => {
    h.base.responder(schema.conversation, CONV_VIVA);
    h.base.responder(schema.agentProfile, [{ enabled: true }]);
    h.base.responder(schema.organization, [{ pausadoEn: new Date() }]);
    await despacharAlCerebro("cv_1", "org_1", "msg_1", { salud: true });
    expect(h.encolar).toHaveBeenCalledTimes(1);
  });

  it("sin pausa y con el Agente encendido, como siempre", async () => {
    h.base.responder(schema.conversation, CONV_VIVA);
    h.base.responder(schema.agentProfile, [{ enabled: true }]);
    h.base.responder(schema.organization, [{ pausadoEn: null }]);
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).toHaveBeenCalledTimes(1);
  });
});

describe("076 — el personal de un negocio pausado", () => {
  it("no inicia sesión: 403 con el motivo", async () => {
    h.membresia = { organizationId: "org_1", role: "owner", pausado: true };
    await expect(antesDeCrearSesion({ userId: "usr_1" })).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: expect.objectContaining({ message: MENSAJE_NEGOCIO_PAUSADO }),
    });
  });

  it("sin pausa, la sesión nace con su negocio; un superadmin, sin ninguno", async () => {
    h.membresia = { organizationId: "org_1", role: "owner", pausado: false };
    expect(await antesDeCrearSesion({ userId: "usr_1" })).toEqual({
      data: { userId: "usr_1", activeOrganizationId: "org_1" },
    });
    h.membresia = null;
    expect(await antesDeCrearSesion({ userId: "usr_super" })).toEqual({
      data: { userId: "usr_super", activeOrganizationId: null },
    });
  });

  it("una sesión que ya tenía tampoco sirve (NegocioPausado)", async () => {
    h.membresia = { organizationId: "org_1", role: "member", pausado: true };
    await expect(requireSession()).rejects.toBeInstanceOf(NegocioPausado);
    h.membresia = { organizationId: "org_1", role: "member", pausado: false };
    await expect(requireSession()).resolves.toMatchObject({ organizationId: "org_1" });
  });
});
