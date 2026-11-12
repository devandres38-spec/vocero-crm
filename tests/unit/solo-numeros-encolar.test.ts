import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseGrabadora } from "./fixtures/base-grabadora";

/** 079 (T5) — «Solo estos números» en la puerta de encolar. */
const h = vi.hoisted(() => ({
  base: null as unknown as ReturnType<typeof import("./fixtures/base-grabadora").baseGrabadora>,
  encolar: vi.fn(async () => ({ notBefore: new Date() })),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => h.base.db };
});
vi.mock("@/server/dispatch/outbox", () => ({ encolarDespacho: h.encolar }));
vi.mock("@/server/dispatch/worker", () => ({ iniciarWorker: vi.fn(), programarTanda: vi.fn() }));

import { schema } from "@/lib/db";
import { despacharAlCerebro } from "@/server/dispatch/encolar";

beforeEach(() => {
  h.base = baseGrabadora();
  h.encolar.mockClear();
});

function preparar(opts: {
  identidad?: string;
  activo?: boolean;
  numeros?: string[];
  enabled?: boolean;
  isTest?: boolean;
}) {
  h.base.responder(schema.conversation, [
    { aiEnabled: true, handoffAt: null, isTest: opts.isTest ?? false, contactId: "ct_1" },
  ]);
  h.base.responder(schema.agentProfile, [
    {
      enabled: opts.enabled ?? true,
      soloNumerosActivo: opts.activo ?? true,
      soloNumeros: opts.numeros ?? ["573001112233"],
    },
  ]);
  h.base.responder(schema.contact, [{ waIdentity: opts.identidad ?? "573001112233" }]);
}

describe("079 — encolar con «Solo estos números»", () => {
  it("un número de la lista se encola", async () => {
    preparar({ identidad: "573001112233" });
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).toHaveBeenCalledTimes(1);
  });

  it("otro número no se encola: queda en la bandeja", async () => {
    preparar({ identidad: "573009998877" });
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).not.toHaveBeenCalled();
  });

  it("521… en la ingesta casa con 52… en la lista", async () => {
    preparar({ identidad: "5215512345678", numeros: ["525512345678"] });
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).toHaveBeenCalledTimes(1);
  });

  it("Instagram y bsuid no se encolan con la lista encendida", async () => {
    for (const identidad of ["ig:123", "bsuid:CO.abc"]) {
      h.base = baseGrabadora();
      preparar({ identidad });
      await despacharAlCerebro("cv_1", "org_1", "msg_1");
    }
    expect(h.encolar).not.toHaveBeenCalled();
  });

  it("fuera de la lista con salud SÍ se encola (D9), sin leer el contacto", async () => {
    preparar({ identidad: "573009998877" });
    await despacharAlCerebro("cv_1", "org_1", "msg_1", { salud: true });
    expect(h.encolar).toHaveBeenCalledTimes(1);
    expect(h.base.ops.some((o) => o.tabla === schema.contact)).toBe(false);
  });

  it("apagada: pasa cualquiera y ni se lee el contacto", async () => {
    preparar({ identidad: "ig:123", activo: false });
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).toHaveBeenCalledTimes(1);
    expect(h.base.ops.some((o) => o.tabla === schema.contact)).toBe(false);
  });

  it("el contacto se busca dentro del negocio", async () => {
    preparar({ identidad: "573001112233" });
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    const busqueda = h.base.ops.find((o) => o.tabla === schema.contact);
    expect(busqueda?.where?.params).toEqual(expect.arrayContaining(["ct_1", "org_1"]));
  });
});
