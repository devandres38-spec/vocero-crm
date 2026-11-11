import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 071 (D5; 067 §4b) — La segunda red de salud omite el texto de ENTRANTES de
 * esa conversación y organización, y borra su copia en `webhook_event`.
 */
const h = vi.hoisted(() => ({
  base: null as unknown as ReturnType<
    typeof import("./fixtures/base-grabadora").baseGrabadora
  >,
  eventos: vi.fn(async () => 0),
  publish: vi.fn(),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => h.base.db };
});
vi.mock("@/server/webhooks/borrar", () => ({
  borrarEventosDeWebhook: h.eventos,
}));
vi.mock("@/server/events/bus", () => ({ publish: h.publish }));

import { schema } from "@/lib/db";
import { omitirPorSalud } from "@/server/inbox/omitir";
import { HEALTH_OMITTED_TEXT } from "@/server/privacy/privacy-filter";

beforeEach(() => {
  h.base = baseGrabadora();
  h.eventos.mockClear();
  h.publish.mockClear();
});

describe("071 — omit", () => {
  it("omite el texto, suma salud, borra el pie y la copia en webhook_event", async () => {
    h.base.responder(schema.conversation, [{ id: "cv_1" }]);
    h.base.responder(schema.message, [
      {
        id: "msg_1",
        text: "me pica la garganta",
        privacyFlags: ["correo"],
        waMessageId: "wamid.1",
        mediaAssetId: null,
      },
      {
        id: "msg_2",
        text: null,
        privacyFlags: null,
        waMessageId: "wamid.2",
        mediaAssetId: "ma_2",
      },
    ]);
    const r = await omitirPorSalud("org_1", "cv_1", [
      "msg_1",
      "msg_2",
      "msg_ajeno",
    ]);
    expect(r).toEqual({ ok: true, omitted: 2 });

    const [lectura] = h.base.ops.filter(
      (o) => o.op === "select" && o.tabla === schema.message,
    );
    // Solo entrantes de esa conversación y organización.
    expect(lectura?.where?.params).toEqual(
      expect.arrayContaining(["org_1", "cv_1", "in"]),
    );
    expect(lectura?.where?.sql).toContain('"direction"');

    const cambios = h.base.ops.filter(
      (o) => o.op === "update" && o.tabla === schema.message,
    );
    expect(cambios.map((c) => c.valores)).toEqual([
      { text: HEALTH_OMITTED_TEXT, privacyFlags: ["correo", "salud"] },
      { text: null, privacyFlags: ["salud"] },
    ]);
    const pie = h.base.ops.find(
      (o) => o.op === "update" && o.tabla === schema.mediaAsset,
    );
    expect(pie?.valores).toMatchObject({ caption: null });
    expect(h.eventos).toHaveBeenCalledWith(expect.anything(), "org_1", [
      "wamid.1",
      "wamid.2",
    ]);
    expect(h.publish).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ type: "conversation.updated" }),
    );
  });

  it("de otra organización (o que no existe): 404 y nada cambia", async () => {
    expect(await omitirPorSalud("org_1", "cv_x", ["msg_1"])).toEqual({
      ok: false,
    });
    expect(h.base.ops.filter((o) => o.op === "update")).toEqual([]);
    expect(h.eventos).not.toHaveBeenCalled();
  });

  it("sin entrantes válidos: omitted 0 y nada cambia", async () => {
    h.base.responder(schema.conversation, [{ id: "cv_1" }]);
    expect(await omitirPorSalud("org_1", "cv_1", ["msg_saliente"])).toEqual({
      ok: true,
      omitted: 0,
    });
    expect(h.base.ops.filter((o) => o.op === "update")).toEqual([]);
    expect(h.publish).not.toHaveBeenCalled();
  });
});
