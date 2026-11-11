import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import {
  avisarSeguimiento,
  enviarAvisosPendientes,
  registrarTraspaso,
} from "@/server/avisos/avisos";
import { AvisoError, enviarTelegram } from "@/server/avisos/telegram";
import { avisoDeSeguimiento, avisoDeTraspaso } from "@/server/avisos/textos";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 071 (3.10, D7; D4 de Aliantis) — Avisos de traspaso por Telegram: sin datos
 * del paciente, con freno de 30 minutos en el seguimiento, y sin el token en
 * ningún log.
 */
const ENV = {
  AVISOS: "on",
  TELEGRAM_BOT_TOKEN: "123:token-secreto",
  TELEGRAM_API_BASE_URL: "http://tg",
} as unknown as NodeJS.ProcessEnv;
const AHORA = new Date("2026-11-11T12:00:00Z");
const MIN = 60_000;

function fetchQue(status: number) {
  const llamadas: { url: string; body: { chat_id: string; text: string } }[] =
    [];
  const f = vi.fn(async (url: string, init: { body: string }) => {
    llamadas.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: status < 300 }), { status });
  });
  return { f: f as unknown as typeof fetch, llamadas };
}

const pendiente = (extra: Record<string, unknown> = {}) => ({
  id: "avs_1",
  organizationId: "org_1",
  conversationId: "cv_abcdef123",
  handoffAt: AHORA,
  reason: "salud",
  status: "pendiente",
  attempts: 0,
  createdAt: AHORA,
  ...extra,
});

let errores: string[] = [];
beforeEach(() => {
  errores = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errores.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
    errores.push(a.map(String).join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("071 — los textos no llevan datos del paciente", () => {
  it("traspaso: negocio, motivo, referencia corta y pendientes; nada más", () => {
    const t = avisoDeTraspaso({
      negocio: "Clínica Dental Sonrisa",
      motivo: "salud",
      conversationId: "cv_abcdef123456",
      abiertos: 2,
    });
    expect(t).toBe(
      "Clínica Dental Sonrisa: nueva derivación (salud o urgencia).\nRef. cv_abcde · 2 pendientes. Revisa la bandeja.",
    );
  });

  it("un motivo desconocido no se filtra tal cual", () => {
    expect(
      avisoDeTraspaso({
        negocio: "N",
        motivo: "tiene cáncer",
        conversationId: "cv_1",
        abiertos: 1,
      }),
    ).toContain("(otro motivo)");
  });

  it("seguimiento: solo la referencia", () => {
    expect(
      avisoDeSeguimiento({ negocio: "N", conversationId: "cv_abcdef123" }),
    ).toBe("N: la persona de la ref. cv_abcde escribió otra vez.");
  });
});

describe("071 — enviar a Telegram", () => {
  it("un fallo nunca lleva el token, la URL ni el texto", async () => {
    for (const [status, tipo] of [
      [401, "token"],
      [400, "grupo"],
      [500, "pasajero"],
    ] as const) {
      const { f } = fetchQue(status);
      const err = await enviarTelegram(
        { base: "http://tg", token: "123:token-secreto", chatId: "-100" },
        "texto del aviso",
        f,
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AvisoError);
      expect((err as AvisoError).tipo).toBe(tipo);
      expect(String((err as AvisoError).message)).not.toMatch(
        /token-secreto|http:\/\/tg|texto del aviso/,
      );
    }
  });
});

describe("071 — anotar el aviso al traspasar", () => {
  it("con AVISOS encendido, un traspaso deja una fila pendiente", async () => {
    const { db, ops } = baseGrabadora();
    await registrarTraspaso(
      {
        organizationId: "org_1",
        conversationId: "cv_1",
        handoffAt: AHORA,
        reason: "salud",
      },
      { db: db as never, env: ENV },
    );
    expect(ops[0]).toMatchObject({ op: "insert", tabla: schema.avisoTraspaso });
    expect(ops[0]?.valores).toMatchObject({
      conversationId: "cv_1",
      reason: "salud",
      handoffAt: AHORA,
    });
  });

  it("sin AVISOS, con manual_reply o en el Laboratorio: nada", async () => {
    const { db, ops } = baseGrabadora();
    const base = {
      organizationId: "org_1",
      conversationId: "cv_1",
      handoffAt: AHORA,
      reason: "salud",
    };
    await registrarTraspaso(base, { db: db as never, env: {} as NodeJS.ProcessEnv });
    await registrarTraspaso(
      { ...base, reason: "manual_reply" },
      { db: db as never, env: ENV },
    );
    await registrarTraspaso(
      { ...base, esPrueba: true },
      { db: db as never, env: ENV },
    );
    expect(ops).toEqual([]);
  });
});

describe("071 — la pasada del worker", () => {
  it("envía al grupo del negocio y lo marca enviado; el texto no lleva nombre ni teléfono", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.avisoTraspaso, [pendiente()]);
    responder(schema.avisoCanal, [
      { chatId: "-100123", negocio: "Clínica Sonrisa" },
    ]);
    responder(schema.conversation, [{ abiertos: 3 }]);
    const { f, llamadas } = fetchQue(200);
    expect(
      await enviarAvisosPendientes(AHORA, {
        db: db as never,
        env: ENV,
        fetchImpl: f,
      }),
    ).toBe(1);
    expect(llamadas[0]?.url).toBe("http://tg/bot123:token-secreto/sendMessage");
    expect(llamadas[0]?.body.chat_id).toBe("-100123");
    expect(llamadas[0]?.body.text).toBe(
      "Clínica Sonrisa: nueva derivación (salud o urgencia).\nRef. cv_abcde · 3 pendientes. Revisa la bandeja.",
    );
    expect(ops.at(-1)?.valores).toMatchObject({
      status: "enviado",
      notifiedAt: AHORA,
    });
  });

  it("sin grupo registrado: omitido, sin llamar a Telegram", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.avisoTraspaso, [pendiente()]);
    const { f, llamadas } = fetchQue(200);
    await enviarAvisosPendientes(AHORA, {
      db: db as never,
      env: ENV,
      fetchImpl: f,
    });
    expect(llamadas).toEqual([]);
    expect(ops.at(-1)?.valores).toMatchObject({ status: "omitido" });
  });

  it("token inválido: fallido de inmediato, y el log no lleva el token", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.avisoTraspaso, [pendiente()]);
    responder(schema.avisoCanal, [{ chatId: "-100", negocio: "N" }]);
    responder(schema.conversation, [{ abiertos: 1 }]);
    await enviarAvisosPendientes(AHORA, {
      db: db as never,
      env: ENV,
      fetchImpl: fetchQue(401).f,
    });
    expect(ops.at(-1)?.valores).toMatchObject({ status: "fallido" });
    expect(errores.join("\n")).not.toContain("token-secreto");
  });

  it("un fallo pasajero se reintenta; pasados 60 minutos, fallido", async () => {
    for (const [creado, esperado] of [
      [AHORA, "pendiente"],
      [new Date(AHORA.getTime() - 60 * MIN), "fallido"],
    ] as const) {
      const { db, ops, responder } = baseGrabadora();
      responder(schema.avisoTraspaso, [pendiente({ createdAt: creado })]);
      responder(schema.avisoCanal, [{ chatId: "-100", negocio: "N" }]);
      responder(schema.conversation, [{ abiertos: 1 }]);
      await enviarAvisosPendientes(AHORA, {
        db: db as never,
        env: ENV,
        fetchImpl: fetchQue(500).f,
      });
      expect(ops.at(-1)?.valores).toMatchObject({ status: esperado });
    }
  });

  it("con AVISOS apagado no hace nada", async () => {
    const { db, ops } = baseGrabadora();
    expect(
      await enviarAvisosPendientes(AHORA, { db: db as never, env: {} as NodeJS.ProcessEnv }),
    ).toBe(0);
    expect(ops).toEqual([]);
  });
});

describe("071 — el seguimiento, con freno de 30 minutos", () => {
  const datos = {
    organizationId: "org_1",
    conversationId: "cv_abcdef123",
    handoffAt: AHORA,
  };

  it("se reclama solo si el último seguimiento fue hace 30 minutos o más", async () => {
    const { db, ops, responder } = baseGrabadora();
    responder(schema.avisoTraspaso, [{ id: "avs_1" }]);
    responder(schema.avisoCanal, [{ chatId: "-100", negocio: "N" }]);
    const { f, llamadas } = fetchQue(200);
    expect(
      await avisarSeguimiento(datos, {
        db: db as never,
        env: ENV,
        fetchImpl: f,
        ahora: AHORA,
      }),
    ).toBe(true);
    const reclamo = ops[0];
    expect(reclamo?.op).toBe("update");
    expect(reclamo?.where?.sql).toContain('"last_followup_at" is null');
    expect(reclamo?.where?.sql).toMatch(/"last_followup_at" <= \$\d+/);
    expect(reclamo?.where?.params).toContainEqual(
      new Date(AHORA.getTime() - 30 * MIN).toISOString(),
    );
    expect(llamadas[0]?.body.text).toBe(
      "N: la persona de la ref. cv_abcde escribió otra vez.",
    );
  });

  it("si no se pudo reclamar (hubo uno hace menos de 30 minutos): no se envía", async () => {
    const { db } = baseGrabadora();
    const { f, llamadas } = fetchQue(200);
    expect(
      await avisarSeguimiento(datos, {
        db: db as never,
        env: ENV,
        fetchImpl: f,
        ahora: AHORA,
      }),
    ).toBe(false);
    expect(llamadas).toEqual([]);
  });
});
