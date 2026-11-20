import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 073-A (D3) — Entrega saliente: un texto que el canal rechaza queda en el
 * hilo como `failed`; el cerebro distingue lo pasajero (503) de lo definitivo
 * (422 `envio_permanente`, con el código de Meta). Mocks copiados de
 * `responder-citando.test.ts`.
 */

const h = vi.hoisted(() => ({
  graphRequest: vi.fn(),
  uploadGraphMedia: vi.fn(),
  saveMediaFile: vi.fn(),
  publish: vi.fn(),
  getCredentialsByOrg: vi.fn(),
  /** Filas que devolverá cada `select`, en orden. */
  selectRows: [] as unknown[][],
  /** Cada INSERT: la tabla y los valores. */
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  /** Auditoría 073-A: el INSERT del mensaje fallido revienta. */
  insertFalla: false,
  pausar: vi.fn(async () => true),
}));

vi.mock("@/server/inbox/pausa", () => ({ pausarPorRespuestaHumana: h.pausar }));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest: h.graphRequest };
});

vi.mock("@/server/whatsapp/media", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/whatsapp/media")>();
  return {
    ...original,
    uploadGraphMedia: h.uploadGraphMedia,
    saveMediaFile: h.saveMediaFile,
    ensureAssetAvailable: vi.fn(async () => {}),
  };
});

vi.mock("@/server/events/bus", () => ({ publish: h.publish }));

vi.mock("@/server/whatsapp/credentials", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/whatsapp/credentials")>();
  return {
    ...original,
    getCredentialsByOrg: h.getCredentialsByOrg,
    getCredentialsByPhoneNumberId: vi.fn(async () => ({
      organizationId: "org_1",
    })),
  };
});

vi.mock("@/server/inbox/identity", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/inbox/identity")>();
  return {
    ...original,
    getOrCreateContactByIdentity: vi.fn(async () => ({
      contact: { id: "ct_1", channel: "whatsapp" },
    })),
  };
});

vi.mock("@/server/inbox/lead-activity", () => ({
  onLeadActivity: vi.fn(async () => {}),
}));
vi.mock("@/server/brains/config", () => ({ despachoActivo: () => false }));
vi.mock("@/server/dispatch/encolar", () => ({
  despacharAlCerebro: vi.fn(async () => {}),
}));

/**
 * Cadena de Drizzle simulada: todo método devuelve la cadena y al final se
 * resuelve (con `await` o con `.limit()`) a las filas encoladas.
 */
function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "orderBy",
    "set",
    "onConflictDoNothing",
  ]) {
    c[m] = () => c;
  }
  c.limit = () => Promise.resolve(result());
  c.returning = () => Promise.resolve(result());
  c.then = (ok: (v: unknown[]) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(ok, ko);
  return c;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  let seq = 0;
  return {
    ...original,
    getDb: () => ({
      select: () => {
        const rows = h.selectRows.shift() ?? [];
        return chain(() => rows);
      },
      insert: (table: unknown) => {
        let values: Record<string, unknown> = {};
        const c = chain(() => [
          {
            createdAt: new Date("2026-10-21T12:00:00Z"),
            waTimestamp: null,
            error: null,
            aiGenerated: false,
            origin: "operator",
            mediaAssetId: null,
            replyToWaMessageId: null,
            ...values,
            id: values.id ?? `row_${++seq}`,
          },
        ]);
        c.values = (v: Record<string, unknown>) => {
          if (h.insertFalla && v.status === "failed") throw new Error("base caída");
          values = v;
          h.inserts.push({ table, values: v });
          return c;
        };
        return c;
      },
      update: () => chain(() => []),
    }),
  };
});

import { schema } from "@/lib/db";
import { MetaApiError } from "@/lib/meta/client";

const insertsDeMensajes = () =>
  h.inserts.filter((i) => i.table === schema.message).map((i) => i.values);

const CONVERSACION_WA = {
  conversation: {
    id: "cv_1",
    organizationId: "org_1",
    isTest: false,
    channel: "whatsapp",
    lastInboundAt: new Date(),
    channelThreadRef: null,
  },
  contact: { id: "ct_1", phone: "573001234567", waUserId: null, waIdentity: "573001234567" },
};

function conectado() {
  h.getCredentialsByOrg.mockResolvedValue({
    organizationId: "org_1",
    phoneNumberId: "pn_1",
    token: "tok",
    status: "connected",
  });
}

beforeEach(() => {
  h.graphRequest.mockReset();
  h.publish.mockReset();
  h.getCredentialsByOrg.mockReset();
  h.selectRows.length = 0;
  h.inserts.length = 0;
  h.insertFalla = false;
  h.pausar.mockClear();
});

describe("sendText ante un rechazo del canal (073-A)", () => {
  it("el operador: el texto queda `failed` en el hilo y el error lleva su messageId y el código de Meta", async () => {
    conectado();
    h.graphRequest.mockRejectedValue(
      new MetaApiError("Recipient phone number not in allowed list", { status: 400, code: 131026 })
    );
    h.selectRows.push([CONVERSACION_WA]);
    const { sendText, SendError } = await import("@/server/inbox/send");

    const err = await sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola" }).catch(
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(SendError);
    expect((err as InstanceType<typeof SendError>).code).toBe("meta_error");
    expect((err as InstanceType<typeof SendError>).metaCode).toBe(131026);
    expect((err as InstanceType<typeof SendError>).messageId).toBeTruthy();
    expect(insertsDeMensajes()[0]).toMatchObject({
      text: "hola",
      status: "failed",
      origin: "operator",
      waMessageId: null,
    });
  });

  it("la IA con un fallo PASAJERO: no deja burbuja fallida (el cerebro reintenta)", async () => {
    conectado();
    h.graphRequest.mockRejectedValue(new MetaApiError("Service unavailable", { status: 503, code: 2 }));
    h.selectRows.push([CONVERSACION_WA]);
    const { sendText } = await import("@/server/inbox/send");

    await expect(
      sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola", aiGenerated: true })
    ).rejects.toMatchObject({ code: "meta_unavailable" });
    expect(insertsDeMensajes()).toEqual([]);
  });

  it("la IA con un rechazo DEFINITIVO: sí queda `failed`, marcado como de la IA", async () => {
    conectado();
    h.graphRequest.mockRejectedValue(
      new MetaApiError("Re-engagement message", { status: 400, code: 131047 })
    );
    h.selectRows.push([CONVERSACION_WA]);
    const { sendText } = await import("@/server/inbox/send");

    await expect(
      sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola", aiGenerated: true })
    ).rejects.toMatchObject({ code: "meta_error", metaCode: 131047 });
    expect(insertsDeMensajes()[0]).toMatchObject({ status: "failed", origin: "ai" });
  });
});

describe("respuesta del cerebro: pasajero vs. definitivo (contrato brains-073 §1)", () => {
  const CONV_CON_IA = { aiEnabled: true, handoffAt: null, isTest: false };

  it("rechazo definitivo de Meta → envio_permanente → 422 con el código de Meta", async () => {
    conectado();
    h.graphRequest.mockRejectedValue(
      new MetaApiError("Message undeliverable", { status: 400, code: 131026 })
    );
    h.selectRows.push([CONV_CON_IA], [CONVERSACION_WA]);
    const { responderComoCerebro } = await import("@/server/bot/nucleo/mensajes");
    const { respuestaDeFallo } = await import("@/server/brains/respuestas");

    const r = await responderComoCerebro({ organizationId: "org_1", conversationId: "cv_1", text: "hola" });
    expect(r).toMatchObject({ ok: false, code: "envio_permanente", metaCode: 131026 });
    if (r.ok) throw new Error("no debía salir");
    const res = respuestaDeFallo(r);
    expect(res.status).toBe(422);
    const cuerpo = (await res.json()) as { error: { code: string; message: string } };
    expect(cuerpo.error.code).toBe("envio_permanente");
    expect(cuerpo.error.message).toContain("Meta 131026");
  });

  it("Meta no disponible → canal_no_disponible → 503 meta_unavailable (reintentable)", async () => {
    conectado();
    h.graphRequest.mockRejectedValue(new MetaApiError("Service unavailable", { status: 503, code: 2 }));
    h.selectRows.push([CONV_CON_IA], [CONVERSACION_WA]);
    const { responderComoCerebro } = await import("@/server/bot/nucleo/mensajes");
    const { respuestaDeFallo } = await import("@/server/brains/respuestas");

    const r = await responderComoCerebro({ organizationId: "org_1", conversationId: "cv_1", text: "hola" });
    expect(r).toMatchObject({ ok: false, code: "canal_no_disponible" });
    if (r.ok) throw new Error("no debía salir");
    const res = respuestaDeFallo(r);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("meta_unavailable");
  });

  it("los códigos de siempre no cambian (ventana, texto largo, suspendida)", async () => {
    const { respuestaDeFallo } = await import("@/server/brains/respuestas");
    expect(respuestaDeFallo({ ok: false, code: "window_closed", message: "x" }).status).toBe(422);
    expect(respuestaDeFallo({ ok: false, code: "text_too_long", message: "x" }).status).toBe(422);
    expect(respuestaDeFallo({ ok: false, code: "ai_paused", message: "x" }).status).toBe(409);
    expect(respuestaDeFallo({ ok: false, code: "organizacion_suspendida", message: "x" }).status).toBe(403);
  });
});

describe("auditoría 073-A — envío", () => {
  it("429 de Meta es pasajero: meta_unavailable (503 reintentable) y sin burbuja de la IA", async () => {
    conectado();
    h.graphRequest.mockRejectedValue(new MetaApiError("Rate limit hit", { status: 429, code: 130429 }));
    h.selectRows.push([CONVERSACION_WA]);
    const { sendText } = await import("@/server/inbox/send");

    await expect(
      sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola", aiGenerated: true })
    ).rejects.toMatchObject({ code: "meta_unavailable", metaCode: 130429 });
    expect(insertsDeMensajes()).toEqual([]);
  });

  it("falloDelCanal: igual en los cuatro canales, siempre con el código de Meta", async () => {
    const { falloDelCanal } = await import("@/server/inbox/send");
    const casos: [number, string][] = [
      [0, "meta_unavailable"],
      [429, "meta_unavailable"],
      [500, "meta_unavailable"],
      [503, "meta_unavailable"],
      [400, "meta_error"],
      [404, "meta_error"],
    ];
    for (const [status, code] of casos) {
      const err = falloDelCanal(new MetaApiError("x", { status, code: 42 }), "no disponible");
      expect(err).toMatchObject({ code, metaCode: 42 });
    }
  });

  it("Instagram, Messenger y TikTok traducen con falloDelCanal (no con su copia)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fuente = readFileSync(join(process.cwd(), "src", "server", "inbox", "send.ts"), "utf8");
    for (const canal of ["Instagram", "Messenger", "TikTok"]) {
      expect(fuente).toContain(`falloDelCanal(err, "${canal} no está disponible`);
    }
    expect(fuente).not.toMatch(/err\.status === 0 \|\| err\.status >= 500/);
  });

  it("si guardar la burbuja fallida revienta, sale el SendError original del canal", async () => {
    conectado();
    h.insertFalla = true;
    h.graphRequest.mockRejectedValue(
      new MetaApiError("Recipient phone number not in allowed list", { status: 400, code: 131026 })
    );
    h.selectRows.push([CONVERSACION_WA]);
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendText, SendError } = await import("@/server/inbox/send");

    const err = await sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola" }).catch(
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(SendError);
    expect(err).toMatchObject({ code: "meta_error", metaCode: 131026 });
    expect((err as InstanceType<typeof SendError>).messageId).toBeUndefined();
    expect(espia).toHaveBeenCalled();
    espia.mockRestore();
  });
});

describe("073-B (D1) — responder desde la Bandeja pausa la IA", () => {
  it("operador: el texto sale y la IA se pausa con manual_reply", async () => {
    conectado();
    h.graphRequest.mockResolvedValue({ messages: [{ id: "wamid.1" }] });
    h.selectRows.push([CONVERSACION_WA]);
    const { sendText } = await import("@/server/inbox/send");
    await sendText({ conversationId: "cv_1", organizationId: "org_1", text: "Hola, te atiendo yo" });
    expect(h.pausar).toHaveBeenCalledWith("org_1", "cv_1");
  });

  it("la IA: no se pausa a sí misma", async () => {
    conectado();
    h.graphRequest.mockResolvedValue({ messages: [{ id: "wamid.2" }] });
    h.selectRows.push([CONVERSACION_WA]);
    const { sendText } = await import("@/server/inbox/send");
    await sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola", aiGenerated: true });
    expect(h.pausar).not.toHaveBeenCalled();
  });

  it("un fallo al pausar no tumba un mensaje que ya salió", async () => {
    conectado();
    h.graphRequest.mockResolvedValue({ messages: [{ id: "wamid.3" }] });
    h.selectRows.push([CONVERSACION_WA]);
    h.pausar.mockRejectedValueOnce(new Error("base caída"));
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendText } = await import("@/server/inbox/send");
    await expect(
      sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola" })
    ).resolves.toMatchObject({ messageId: expect.any(String) });
    espia.mockRestore();
  });

  it("si falla el envío, no se pausa (la persona no llegó a contestar)", async () => {
    conectado();
    h.graphRequest.mockRejectedValue(new MetaApiError("x", { status: 400, code: 131026 }));
    h.selectRows.push([CONVERSACION_WA]);
    const { sendText } = await import("@/server/inbox/send");
    await sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola" }).catch(() => null);
    expect(h.pausar).not.toHaveBeenCalled();
  });
});
