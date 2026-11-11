import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";
import { RESERVA_VIEJA_MS, reservarEnvio } from "@/server/bot/envio-idempotente";
import { baseGrabadora } from "./fixtures/base-grabadora";

/** 071 (D6; T2 de la 067) — La llave del cerebro se reserva antes de llamar a Meta. */
const AHORA = new Date("2026-11-11T12:00:00Z");
const ENTRADA = { organizationId: "org_1", conversationId: "cv_1", clave: "trn_1:0", text: "Hola" };
const reservar = (db: unknown) => reservarEnvio(ENTRADA, { db: db as never, ahora: AHORA });

describe("071 — reservar el envío", () => {
  it("una llave nueva se reserva con un saliente pending, sin wa_message_id", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.message, [{ id: "msg_1" }]);
    expect(await reservar(db)).toEqual({ tipo: "nueva", messageId: "msg_1" });
    expect(ops[0]).toMatchObject({ op: "insert", tabla: schema.message });
    expect(ops[0]?.valores).toMatchObject({
      organizationId: "org_1",
      clientMessageId: "trn_1:0",
      status: "pending",
      direction: "out",
    });
    expect(ops[0]?.valores).not.toHaveProperty("waMessageId");
  });

  it("repetida y ya enviada: repetido, sin tocar nada", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.message, []);
    responder(schema.message, [{ id: "msg_1", status: "pending", waMessageId: "wamid.1", createdAt: AHORA }]);
    expect(await reservar(db)).toEqual({ tipo: "repetido", messageId: "msg_1" });
    expect(ops.some((o) => o.op === "update")).toBe(false);
    // La llave se busca dentro del negocio.
    expect(ops[1]?.where?.params).toEqual(expect.arrayContaining(["org_1", "trn_1:0"]));
  });

  it("repetida y del Laboratorio (sent, sin wa_message_id): repetido", async () => {
    const { db, responder } = baseGrabadora();
    responder(schema.message, []);
    responder(schema.message, [{ id: "msg_1", status: "sent", waMessageId: null, createdAt: AHORA }]);
    expect(await reservar(db)).toEqual({ tipo: "repetido", messageId: "msg_1" });
  });

  it("reservada hace menos de 2 minutos y sin enviar: en curso", async () => {
    const { db, responder } = baseGrabadora();
    responder(schema.message, []);
    responder(schema.message, [
      { id: "msg_1", status: "pending", waMessageId: null, createdAt: new Date(AHORA.getTime() - 30_000) },
    ]);
    expect(await reservar(db)).toEqual({ tipo: "en_curso" });
  });

  it("fallida: se reserva otra vez y se reintenta", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.message, []);
    responder(schema.message, [{ id: "msg_1", status: "failed", waMessageId: null, createdAt: AHORA }]);
    responder(schema.message, [{ id: "msg_1" }]);
    expect(await reservar(db)).toEqual({ tipo: "reintento", messageId: "msg_1" });
    expect(ops.at(-1)?.valores).toMatchObject({ status: "pending", error: null });
  });

  it("una reserva vieja (2 minutos o más) se da por caída y se reintenta", async () => {
    const { db, responder } = baseGrabadora();
    responder(schema.message, []);
    responder(schema.message, [
      { id: "msg_1", status: "pending", waMessageId: null, createdAt: new Date(AHORA.getTime() - RESERVA_VIEJA_MS) },
    ]);
    responder(schema.message, [{ id: "msg_1" }]);
    expect(await reservar(db)).toEqual({ tipo: "reintento", messageId: "msg_1" });
  });

  it("si otro la retomó entretanto: en curso", async () => {
    const { db, responder } = baseGrabadora();
    responder(schema.message, []);
    responder(schema.message, [{ id: "msg_1", status: "failed", waMessageId: null, createdAt: AHORA }]);
    responder(schema.message, []);
    expect(await reservar(db)).toEqual({ tipo: "en_curso" });
  });

  it("el índice único de la llave es por organización (migración 0030)", () => {
    const sql = readFileSync("drizzle/0030_contrato_y_avisos.sql", "utf8");
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "message_org_client_msg_uq" ON "message" USING btree \("organization_id","client_message_id"\) WHERE "message"\."client_message_id" is not null/
    );
  });
});
