import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 071 — La ruta `POST /api/bot/messages`: la llave se reserva ANTES de llamar
 * a Meta, un repetido no envía, y con el Agente apagado solo pasa un mensaje
 * de seguridad por cada entrante de salud.
 */
const h = vi.hoisted(() => ({
  orden: [] as string[],
  reserva: { tipo: "nueva", messageId: "msg_r" } as unknown,
  conv: {
    aiEnabled: true,
    handoffAt: null,
    isTest: false,
    channel: "whatsapp",
  } as Record<string, unknown>,
  agente: true,
  saludPendiente: true,
  /** 077 — Si no es null, `sendText` lanza ese SendError. */
  fallo: null as string | null,
}));

vi.mock("@/server/bot/auth", () => ({
  requireBot: async () => ({ organizationId: "org_1" }),
}));
vi.mock("@/server/bot/envio-idempotente", () => ({
  reservarEnvio: vi.fn(async () => {
    h.orden.push("reservar");
    return h.reserva;
  }),
  marcarReservaFallida: vi.fn(async () => {
    h.orden.push("fallida");
  }),
}));
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/inbox/send")>();
  return {
    ...original,
    sendText: vi.fn(async (input: { reservado?: string; buttons?: unknown[] }) => {
      if (h.fallo) throw new original.SendError(h.fallo as never, "Este canal no admite botones");
      h.orden.push(`meta:${input.reservado ?? "-"}${input.buttons ? ":botones" : ""}`);
      return { messageId: input.reservado ?? "msg_n" };
    }),
  };
});
vi.mock("@/server/bot/seguridad", () => ({
  agenteEncendido: vi.fn(async () => h.agente),
  saludSinRespuesta: vi.fn(async () => h.saludPendiente),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  const cadena = {
    select: () => cadena,
    from: () => cadena,
    where: () => cadena,
    limit: async () => [h.conv],
  };
  return { ...original, getDb: () => cadena };
});

import { POST } from "@/app/api/bot/messages/route";

const pedir = (body: Record<string, unknown>) =>
  POST(
    new Request("http://x/api/bot/messages", {
      method: "POST",
      body: JSON.stringify({ conversationId: "cv_1", text: "Hola", ...body }),
    }),
  );

beforeEach(() => {
  h.orden.length = 0;
  h.reserva = { tipo: "nueva", messageId: "msg_r" };
  h.agente = true;
  h.saludPendiente = true;
  h.fallo = null;
  h.conv.channel = "whatsapp";
});

describe("071 — clientMessageId en la ruta", () => {
  it("la llave se reserva antes de llamar a Meta, y Meta actualiza esa reserva", async () => {
    const r = await pedir({ clientMessageId: "k1" });
    expect(r.status).toBe(200);
    expect(h.orden).toEqual(["reservar", "meta:msg_r"]);
  });

  it("un repetido devuelve el original y no llama a Meta", async () => {
    h.reserva = { tipo: "repetido", messageId: "msg_orig" };
    const r = await pedir({ clientMessageId: "k1" });
    expect(await r.json()).toEqual({ messageId: "msg_orig", repetido: true });
    expect(h.orden).toEqual(["reservar"]);
  });

  it("en curso: 409 mensaje_en_curso, sin llamar a Meta", async () => {
    h.reserva = { tipo: "en_curso" };
    const r = await pedir({ clientMessageId: "k1" });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("mensaje_en_curso");
    expect(h.orden).toEqual(["reservar"]);
  });

  it("sin llave, todo como hoy", async () => {
    await pedir({});
    expect(h.orden).toEqual(["meta:-"]);
  });
});

describe("071 (3.8) — el Agente apagado", () => {
  it("sin motivo: 409 agente_apagado, nada se envía", async () => {
    h.agente = false;
    const r = await pedir({});
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("agente_apagado");
    expect(h.orden).toEqual([]);
  });

  it("con motivo seguridad y un entrante de salud sin responder: se envía", async () => {
    h.agente = false;
    const r = await pedir({ motivo: "seguridad" });
    expect(r.status).toBe(200);
    expect(h.orden).toEqual(["meta:-"]);
  });

  it("con motivo seguridad pero ya respondido (o sin salud): 409", async () => {
    h.agente = false;
    h.saludPendiente = false;
    const r = await pedir({ motivo: "seguridad" });
    expect(r.status).toBe(409);
    expect(h.orden).toEqual([]);
  });

  it("con el Agente encendido, motivo se acepta y no cambia nada", async () => {
    const r = await pedir({ motivo: "seguridad" });
    expect(r.status).toBe(200);
  });
});

describe("077 — botones por canal", () => {
  const BOTONES = [
    { id: "consentimiento:acepto", title: "Acepto" },
    { id: "consentimiento:no_acepto", title: "No acepto" },
  ];

  for (const canal of ["whatsapp", "instagram", "messenger"]) {
    it(`${canal}: los botones llegan al envío`, async () => {
      h.conv.channel = canal;
      const r = await pedir({ buttons: BOTONES });
      expect(r.status).toBe(200);
      expect(h.orden).toEqual(["meta:-:botones"]);
    });
  }

  it("tiktok: 409 canal_sin_botones sin reservar ni llamar a nadie", async () => {
    h.conv.channel = "tiktok";
    const r = await pedir({ buttons: BOTONES, clientMessageId: "k1" });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("canal_sin_botones");
    expect(h.orden).toEqual([]);
  });

  it("por Zernio (lo decide el envío): 409 canal_sin_botones y la reserva queda fallida", async () => {
    h.conv.channel = "instagram";
    h.fallo = "canal_sin_botones";
    const r = await pedir({ buttons: BOTONES, clientMessageId: "k1" });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("canal_sin_botones");
    expect(h.orden).toEqual(["reservar", "fallida"]);
  });
});
