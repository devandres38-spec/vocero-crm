import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 070 (D6; D7 de la 067) — «No acepto» borra, y solo con un rechazo
 * registrado para ESA conversación del negocio.
 */
const h = vi.hoisted(() => ({
  base: null as unknown as ReturnType<
    typeof import("./fixtures/base-grabadora").baseGrabadora
  >,
  rechazo: true,
  ficha: vi.fn(async () => {}),
  eventos: vi.fn(async () => 0),
  archivo: vi.fn(async () => {}),
  publish: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => h.base.db };
});
vi.mock("@/server/consent", () => ({
  rechazoRegistrado: vi.fn(async () => h.rechazo),
}));
vi.mock("@/server/bot/ficha", () => ({ vaciarFicha: h.ficha }));
vi.mock("@/server/webhooks/borrar", () => ({
  borrarEventosDeWebhook: h.eventos,
}));
vi.mock("@/server/whatsapp/media", () => ({ deleteMediaFile: h.archivo }));
vi.mock("@/server/events/bus", () => ({ publish: h.publish }));

import { schema } from "@/lib/db";
import { olvidarPorRechazo } from "@/server/inbox/olvidar";

function preparar() {
  h.base = baseGrabadora();
  h.base.responder(schema.conversation, [{ id: "cv_1", contactId: "ct_1" }]);
  h.base.responder(schema.message, [
    { waMessageId: "wamid.1", mediaAssetId: "ma_1" },
    { waMessageId: "wamid.2", mediaAssetId: null },
    { waMessageId: null, mediaAssetId: null },
  ]);
  // returning del delete de mensajes, y del de adjuntos.
  h.base.responder(schema.message, [
    { id: "msg_1" },
    { id: "msg_2" },
    { id: "msg_3" },
  ]);
  h.base.responder(schema.mediaAsset, [{ id: "ma_1" }]);
}

beforeEach(() => {
  h.rechazo = true;
  for (const f of [h.ficha, h.eventos, h.archivo, h.publish]) f.mockClear();
  preparar();
});

const borrados = (tabla: unknown) =>
  h.base.ops.filter((o) => o.op === "delete" && o.tabla === tabla);

describe("070 — forget", () => {
  it("con rechazo: borra los mensajes de ESA conversación del negocio, sus adjuntos y sus eventos, y vacía la ficha", async () => {
    const r = await olvidarPorRechazo("org_1", "cv_1");
    expect(r).toEqual({ ok: true, deleted: 3 });

    const [mensajes] = borrados(schema.message);
    expect(mensajes?.where?.params).toEqual(
      expect.arrayContaining(["org_1", "cv_1"]),
    );
    expect(mensajes?.where?.sql).toContain('"organization_id"');
    expect(mensajes?.where?.sql).toContain('"conversation_id"');

    expect(borrados(schema.mediaAsset)).toHaveLength(1);
    expect(h.archivo).toHaveBeenCalledWith("org_1", "ma_1");
    expect(h.eventos).toHaveBeenCalledWith(expect.anything(), "org_1", [
      "wamid.1",
      "wamid.2",
    ]);
    expect(h.ficha).toHaveBeenCalledWith(expect.anything(), "org_1", "ct_1");
    expect(h.publish).toHaveBeenCalledWith("org_1", {
      type: "conversation.updated",
      data: { conversation: { id: "cv_1" } },
    });
  });

  it("la conversación se busca dentro del negocio", async () => {
    await olvidarPorRechazo("org_1", "cv_1");
    const [conv] = h.base.ops.filter(
      (o) => o.op === "select" && o.tabla === schema.conversation,
    );
    expect(conv?.where?.params).toEqual(
      expect.arrayContaining(["org_1", "cv_1"]),
    );
  });

  it("sin rechazo: 409 sin_rechazo y nada se borra", async () => {
    h.rechazo = false;
    expect(await olvidarPorRechazo("org_1", "cv_1")).toEqual({
      ok: false,
      motivo: "sin_rechazo",
    });
    expect(h.base.ops.filter((o) => o.op === "delete")).toEqual([]);
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.eventos).not.toHaveBeenCalled();
  });

  it("una conversación de otro negocio (o que no existe): no_encontrada y nada se borra", async () => {
    h.base = baseGrabadora();
    expect(await olvidarPorRechazo("org_1", "cv_x")).toEqual({
      ok: false,
      motivo: "no_encontrada",
    });
    expect(h.base.ops.filter((o) => o.op === "delete")).toEqual([]);
  });

  it("repetirlo no encuentra mensajes: deleted 0", async () => {
    h.base = baseGrabadora();
    h.base.responder(schema.conversation, [{ id: "cv_1", contactId: "ct_1" }]);
    expect(await olvidarPorRechazo("org_1", "cv_1")).toEqual({
      ok: true,
      deleted: 0,
    });
    expect(h.archivo).not.toHaveBeenCalled();
  });
});
