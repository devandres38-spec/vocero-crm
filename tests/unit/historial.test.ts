import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";
import { historialDe, historialSchema } from "@/server/bot/historial";
import { baseGrabadora } from "./fixtures/base-grabadora";

/** 071 (D4; 067 §5) — El historial para el cerebro: filtrado, en orden y aislado. */
const fila = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt: new Date(`2026-11-11T10:00:0${id.slice(-1)}Z`),
  waTimestamp: null,
  direction: "in",
  type: "text",
  text: `texto ${id}`,
  origin: "operator",
  aiGenerated: false,
  privacyFlags: null,
  buttonId: null,
  buttons: null,
  ...extra,
});

describe("071 — historial", () => {
  it("los últimos, del más viejo al más nuevo, con las llaves opcionales solo si hay", async () => {
    const { db, responder } = baseGrabadora();
    responder(schema.conversation, [{ id: "cv_1" }]);
    // La base los devuelve del más nuevo al más viejo (orderBy desc).
    responder(schema.message, [
      fila("msg_3", {
        direction: "out",
        origin: "ai",
        aiGenerated: true,
        buttons: [{ id: "aviso_acepto", title: "Acepto" }],
      }),
      fila("msg_2", { privacyFlags: ["salud"], text: "[mensaje con información de salud omitido]" }),
      fila("msg_1", { buttonId: "aviso_acepto" }),
    ]);
    const h = await historialDe("org_1", "cv_1", 20, db as never);
    expect(h?.map((m) => m.id)).toEqual(["msg_1", "msg_2", "msg_3"]);
    expect(h?.[0]).toEqual({
      id: "msg_1",
      at: "2026-11-11T10:00:01.000Z",
      direction: "in",
      type: "text",
      text: "texto msg_1",
      origin: null,
      aiGenerated: false,
      buttonId: "aviso_acepto",
    });
    expect(h?.[1]?.privacyFlags).toEqual(["salud"]);
    expect(h?.[2]).toMatchObject({ origin: "ai", buttons: [{ id: "aviso_acepto", title: "Acepto" }] });
    expect("privacyFlags" in (h?.[0] ?? {})).toBe(false);
  });

  it("solo lee mensajes de esa conversación y esa organización", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.conversation, [{ id: "cv_1" }]);
    await historialDe("org_1", "cv_1", 20, db as never);
    const [conv, mensajes] = ops;
    expect(conv?.where?.params).toEqual(expect.arrayContaining(["org_1", "cv_1"]));
    expect(mensajes?.tabla).toBe(schema.message);
    expect(mensajes?.where?.params).toEqual(expect.arrayContaining(["org_1", "cv_1"]));
  });

  it("una conversación de otro negocio: null (404)", async () => {
    const { db, ops } = baseGrabadora();
    expect(await historialDe("org_1", "cv_x", 20, db as never)).toBeNull();
    expect(ops).toHaveLength(1);
  });

  it("nunca lee las notas internas", () => {
    const fuente = readFileSync("src/server/bot/historial.ts", "utf8");
    expect(fuente).not.toMatch(/conversationNote|conversation_note\b(?!`)/);
  });

  it("limit de 1 a 50, 20 por defecto", () => {
    expect(historialSchema.parse({ conversationId: "cv_1" }).limit).toBe(20);
    expect(historialSchema.safeParse({ conversationId: "cv_1", limit: "51" }).success).toBe(false);
    expect(historialSchema.safeParse({ conversationId: "cv_1", limit: "0" }).success).toBe(false);
  });
});

