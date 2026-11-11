import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 073 (D14 de Aliantis) — La firma de los webhooks de Meta, por negocio y
 * canal, y obligatoria en producción. Nada se guarda antes de verificarla.
 */
const h = vi.hoisted(() => ({
  orgs: [] as string[],
  secretos: {} as Record<string, string>,
  recibir: vi.fn(async (..._a: unknown[]) => Response.json({ received: true })),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ META_WEBHOOK_VERIFY_TOKEN: "segmento-secreto", META_APP_SECRET: "c".repeat(32) }),
}));
vi.mock("@/server/webhooks/organizacion", async (orig) => ({
  ...(await orig<typeof import("@/server/webhooks/organizacion")>()),
  organizacionesDeLaEntrega: async () => h.orgs,
}));
vi.mock("@/server/whatsapp/app-secret", async (orig) => ({
  ...(await orig<typeof import("@/server/whatsapp/app-secret")>()),
  appSecretDe: async (org: string, canal: string) => h.secretos[`${org}:${canal}`] ?? null,
}));
vi.mock("@/server/webhooks/recibir", () => ({ recibirEvento: h.recibir }));
vi.mock("@/server/channels/enabled", () => ({ isChannelEnabled: () => true }));

import { POST as postIg } from "@/app/api/webhooks/ig/[webhookToken]/route";
import { POST as postMessenger } from "@/app/api/webhooks/messenger/[webhookToken]/route";
import { POST as postWa } from "@/app/api/webhooks/wa/[webhookToken]/route";
import type { Buscadores } from "@/server/webhooks/organizacion";
import { verificarFirmaMeta, type DepsFirma } from "@/server/webhooks/firma";

const A = "a".repeat(32);
const B = "b".repeat(32);
const firmar = (cuerpo: string, secreto: string) =>
  `sha256=${createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex")}`;

const WA = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "waba_a", changes: [{ value: { metadata: { phone_number_id: "pn_a" } } }] }],
});
const IG = JSON.stringify({ object: "instagram", entry: [{ id: "ig_a", messaging: [] }] });
const MS = JSON.stringify({ object: "page", entry: [{ id: "page_a", messaging: [] }] });

function deps(over: Partial<DepsFirma> = {}): DepsFirma {
  return {
    organizaciones: async () => h.orgs,
    secretoDe: async (org, canal) => h.secretos[`${org}:${canal}`] ?? null,
    obligatoria: () => false,
    ...over,
  };
}

beforeEach(() => {
  h.orgs = ["org_a"];
  h.secretos = { "org_a:whatsapp": A, "org_a:instagram": A, "org_a:messenger": A, "org_b:whatsapp": B };
  h.recibir.mockClear();
});

describe("073 — verificarFirmaMeta", () => {
  it("con la firma del negocio al que va: pasa con su organización", async () => {
    expect(await verificarFirmaMeta("whatsapp", JSON.parse(WA), WA, firmar(WA, A), deps())).toEqual({
      ok: true,
      organizationId: "org_a",
    });
  });

  it("con la firma de OTRO negocio: rechazada", async () => {
    expect(await verificarFirmaMeta("whatsapp", JSON.parse(WA), WA, firmar(WA, B), deps())).toEqual({
      ok: false,
      motivo: "firma_invalida",
    });
  });

  it("cada canal con su secreto: la de WhatsApp no vale en Messenger", async () => {
    h.secretos["org_a:messenger"] = B;
    expect(
      await verificarFirmaMeta("messenger", JSON.parse(MS), MS, firmar(MS, A), deps())
    ).toMatchObject({ ok: false });
    const pedidos: string[] = [];
    await verificarFirmaMeta("instagram", JSON.parse(IG), IG, firmar(IG, A), {
      ...deps(),
      secretoDe: async (org, canal) => {
        pedidos.push(`${org}:${canal}`);
        return A;
      },
    });
    expect(pedidos).toEqual(["org_a:instagram"]);
  });

  it("la `META_APP_SECRET` global ya no abre nada", async () => {
    expect(
      await verificarFirmaMeta("whatsapp", JSON.parse(WA), WA, firmar(WA, "c".repeat(32)), deps())
    ).toMatchObject({ ok: false });
  });

  it("sin secreto: rechazada en producción, aceptada fuera de ella", async () => {
    h.secretos = {};
    expect(
      await verificarFirmaMeta("whatsapp", JSON.parse(WA), WA, null, deps({ obligatoria: () => true }))
    ).toEqual({ ok: false, motivo: "sin_secreto" });
    expect(await verificarFirmaMeta("whatsapp", JSON.parse(WA), WA, null, deps())).toEqual({
      ok: true,
      organizationId: "org_a",
    });
  });

  it("una entrega con dos negocios: rechazada", async () => {
    h.orgs = ["org_a", "org_b"];
    expect(
      await verificarFirmaMeta("whatsapp", JSON.parse(WA), WA, firmar(WA, A), deps())
    ).toEqual({ ok: false, motivo: "varios_negocios" });
  });

  it("una entrega de ningún negocio conectado: pasa sin organización (se descarta, nada que proteger)", async () => {
    h.orgs = [];
    expect(await verificarFirmaMeta("whatsapp", JSON.parse(WA), WA, null, deps({ obligatoria: () => true }))).toEqual({
      ok: true,
      organizationId: null,
    });
  });
});

describe("073 — organizacionesDeLaEntrega", () => {
  const b: Buscadores = {
    porPhoneNumberId: async (id) => ({ pn_a: { organizationId: "org_a" }, pn_b: { organizationId: "org_b" } })[id] ?? null,
    porWabaId: async (id) => (id === "waba_c" ? { organizationId: "org_c" } : null),
    porIgUserId: async () => null,
    porPageId: async () => null,
    porCuentaZernio: async () => null,
  };

  it("junta los negocios de todas las entradas (número, o la WABA si no hay número)", async () => {
    const payload = {
      entry: [
        { id: "waba_a", changes: [{ value: { metadata: { phone_number_id: "pn_a" } } }] },
        { id: "waba_b", changes: [{ value: { metadata: { phone_number_id: "pn_b" } } }] },
        { id: "waba_c", changes: [{ value: {} }] },
      ],
    };
    // La real: arriba está simulada para las rutas.
    const { organizacionesDeLaEntrega } = await vi.importActual<
      typeof import("@/server/webhooks/organizacion")
    >("@/server/webhooks/organizacion");
    expect((await organizacionesDeLaEntrega("whatsapp", payload, b)).sort()).toEqual([
      "org_a",
      "org_b",
      "org_c",
    ]);
  });
});

describe("073 — las rutas: nada se guarda sin la firma del negocio", () => {
  const params = { params: Promise.resolve({ webhookToken: "segmento-secreto" }) };
  const pedir = (cuerpo: string, firma?: string) =>
    new Request("http://localhost/x", {
      method: "POST",
      body: cuerpo,
      headers: firma ? { "x-hub-signature-256": firma } : {},
    });

  it("WhatsApp: firma de otro negocio → 401 y no se guarda", async () => {
    const r = await postWa(pedir(WA, firmar(WA, B)), params);
    expect(r.status).toBe(401);
    expect(h.recibir).not.toHaveBeenCalled();
  });

  it("WhatsApp: firma correcta → se guarda con la organización verificada", async () => {
    const r = await postWa(pedir(WA, firmar(WA, A)), params);
    expect(r.status).toBe(200);
    expect(h.recibir).toHaveBeenCalledWith("whatsapp", expect.anything(), WA, "webhook", {
      organizationId: "org_a",
    });
  });

  it("Instagram y Messenger: lo mismo, con el secreto de su canal", async () => {
    expect((await postIg(pedir(IG, firmar(IG, B)), params)).status).toBe(401);
    expect((await postMessenger(pedir(MS, firmar(MS, B)), params)).status).toBe(401);
    expect(h.recibir).not.toHaveBeenCalled();
    expect((await postIg(pedir(IG, firmar(IG, A)), params)).status).toBe(200);
    expect((await postMessenger(pedir(MS, firmar(MS, A)), params)).status).toBe(200);
    expect(h.recibir.mock.calls.map((c) => c[0])).toEqual(["meta_instagram", "meta_messenger"]);
  });
});
