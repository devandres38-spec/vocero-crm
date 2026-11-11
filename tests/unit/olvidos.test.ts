import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 070 (D7) — El aviso de `conversation.deleted` pasa por `olvido_pendiente`:
 * si el cerebro no confirma, el worker lo reintenta a 1 min, 5, 30 y cada
 * hora, hasta 7 días.
 */
const h = vi.hoisted(() => ({ activo: true }));
vi.mock("@/server/brains/config", () => ({
  leerConfigDespacho: () => ({ active: h.activo }),
}));

import { schema } from "@/lib/db";
import type { EventoOlvido } from "@/server/brains/contract";
import {
  PLAZO_OLVIDO_MS,
  avisarOlvidoConRed,
  esperaTras,
  reintentarOlvidos,
} from "@/server/dispatch/olvidos";

const EVENTO = {
  type: "conversation.deleted",
  eventId: "olv_1",
  organization: { id: "org_1", slug: null },
  conversation: { id: "cv_1", channel: "whatsapp" },
  contact: { id: "ct_1", identity: "573001112233" },
  deletedAt: "2026-11-10T12:00:00.000Z",
} as EventoOlvido;
const AHORA = new Date("2026-11-10T12:00:00Z");
const MIN = 60_000;

beforeEach(() => {
  h.activo = true;
  delete process.env.OLVIDO_REINTENTO_MS;
});

describe("070 — la espera entre intentos", () => {
  it("1 min, 5 min, 30 min y después cada hora", () => {
    expect([1, 2, 3, 4, 9].map((n) => esperaTras(n))).toEqual([
      MIN,
      5 * MIN,
      30 * MIN,
      60 * MIN,
      60 * MIN,
    ]);
  });
  it("la base se puede bajar para el E2E", () => {
    process.env.OLVIDO_REINTENTO_MS = "1500";
    expect(esperaTras(2)).toBe(7500);
  });
});

describe("070 — avisar con red", () => {
  it("anota antes de avisar y borra la fila si el cerebro confirma", async () => {
    const { db, ops } = baseGrabadora();
    const avisar = vi.fn(async () => "avisado" as const);
    expect(
      await avisarOlvidoConRed(EVENTO, {
        db: db as never,
        avisar,
        ahora: AHORA,
      }),
    ).toBe("avisado");
    expect(ops.map((o) => o.op)).toEqual(["insert", "delete"]);
    expect(ops[0]?.valores).toMatchObject({
      id: "olv_1",
      organizationId: "org_1",
      conversationId: "cv_1",
      evento: EVENTO,
    });
  });

  it("si no confirma, queda para el worker en 1 minuto", async () => {
    const { db, ops } = baseGrabadora();
    const avisar = vi.fn(async () => "sin_confirmar" as const);
    expect(
      await avisarOlvidoConRed(EVENTO, {
        db: db as never,
        avisar,
        ahora: AHORA,
      }),
    ).toBe("sin_confirmar");
    expect(ops.map((o) => o.op)).toEqual(["insert", "update"]);
    expect(ops[1]?.valores).toMatchObject({
      attempts: 1,
      notBefore: new Date(AHORA.getTime() + MIN),
      leasedUntil: null,
    });
  });

  it("sin despacho configurado no hay a quién avisar: no se anota nada", async () => {
    h.activo = false;
    const { db, ops } = baseGrabadora();
    const avisar = vi.fn();
    expect(await avisarOlvidoConRed(EVENTO, { db: db as never, avisar })).toBe(
      "no_aplica",
    );
    expect(ops).toEqual([]);
    expect(avisar).not.toHaveBeenCalled();
  });
});

describe("070 — el reintento del worker", () => {
  const fila = (attempts: number, creado: Date) => ({
    id: "olv_1",
    evento: EVENTO,
    attempts,
    createdAt: creado,
  });

  it("toma las vencidas, avisa con el mismo evento y borra la confirmada", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.olvidoPendiente, [{ id: "olv_1" }]);
    responder(schema.olvidoPendiente, [fila(1, AHORA)]);
    const avisar = vi.fn(async () => "avisado" as const);
    expect(await reintentarOlvidos(AHORA, { db: db as never, avisar })).toBe(1);
    expect(avisar).toHaveBeenCalledWith(EVENTO);
    expect(ops.at(-1)?.op).toBe("delete");
  });

  it("sin confirmar: el segundo intento espera 5 minutos", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.olvidoPendiente, [{ id: "olv_1" }]);
    responder(schema.olvidoPendiente, [fila(1, AHORA)]);
    await reintentarOlvidos(AHORA, {
      db: db as never,
      avisar: async () => "sin_confirmar",
    });
    expect(ops.at(-1)?.valores).toMatchObject({
      attempts: 2,
      notBefore: new Date(AHORA.getTime() + 5 * MIN),
    });
  });

  it("a los 7 días sin confirmar queda agotado", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.olvidoPendiente, [{ id: "olv_1" }]);
    responder(schema.olvidoPendiente, [
      fila(40, new Date(AHORA.getTime() - PLAZO_OLVIDO_MS)),
    ]);
    await reintentarOlvidos(AHORA, {
      db: db as never,
      avisar: async () => "sin_confirmar",
    });
    expect(ops.at(-1)?.valores).toMatchObject({ status: "agotado" });
  });

  it("sin filas vencidas no avisa a nadie", async () => {
    const { db } = baseGrabadora();
    const avisar = vi.fn();
    expect(await reintentarOlvidos(AHORA, { db: db as never, avisar })).toBe(0);
    expect(avisar).not.toHaveBeenCalled();
  });
});
