import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

/**
 * 2.13.1 — «Escribiendo…» es de la Graph API de WhatsApp. En Instagram,
 * Messenger o TikTok no se buscan credenciales de WhatsApp ni se llama a Meta.
 */

const h = vi.hoisted(() => ({
  conv: null as null | Record<string, unknown>,
  getCredentialsByOrg: vi.fn(),
  graphRequest: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  const select = () => {
    let tabla = "";
    const b: Record<string, unknown> = {
      from(t: unknown) {
        tabla = getTableName(t as never);
        return b;
      },
      where: () => b,
      orderBy: () => b,
      limit: async () => {
        if (tabla === "conversation") return h.conv ? [h.conv] : [];
        if (tabla === "message") return [{ waMessageId: "wamid.ultimo" }];
        return [];
      },
    };
    return b;
  };
  return { ...real, getDb: () => ({ select }) };
});

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: h.getCredentialsByOrg,
}));
vi.mock("@/lib/meta/client", () => ({ graphRequest: h.graphRequest }));

import { marcarEscribiendo } from "@/server/bot/nucleo/acciones";

function peticion(): Request {
  return new Request("http://local/api/bot/typing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: "cv_1" }),
  });
}

function conversacion(channel: string): Record<string, unknown> {
  return {
    id: "cv_1",
    organizationId: "org_A",
    channel,
    isTest: false,
    aiEnabled: true,
    handoffAt: null,
  };
}

describe("marcarEscribiendo por canal (2.13.1)", () => {
  beforeEach(() => {
    h.getCredentialsByOrg.mockReset();
    h.graphRequest.mockReset();
    h.getCredentialsByOrg.mockResolvedValue({ phoneNumberId: "pn_1", token: "t" });
    h.graphRequest.mockResolvedValue({});
  });

  it.each(["instagram", "messenger", "tiktok"])(
    "en %s no toca credenciales de WhatsApp ni a Meta",
    async (canal) => {
      h.conv = conversacion(canal);
      const res = await marcarEscribiendo(peticion(), "org_A");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false });
      expect(h.getCredentialsByOrg).not.toHaveBeenCalled();
      expect(h.graphRequest).not.toHaveBeenCalled();
    }
  );

  it("en WhatsApp sigue marcando leído + escribiendo", async () => {
    h.conv = conversacion("whatsapp");
    const res = await marcarEscribiendo(peticion(), "org_A");

    expect(await res.json()).toEqual({ ok: true });
    expect(h.graphRequest).toHaveBeenCalledTimes(1);
    expect(h.graphRequest.mock.calls[0]?.[1]).toMatchObject({
      body: { status: "read", message_id: "wamid.ultimo" },
    });
  });
});
