import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 077 (T2) — El toque de un botón (Quick Reply de Meta) en Instagram y
 * Messenger entra con su id en `button_id`, y su título se conserva aunque el
 * negocio no tenga perfil de privacidad legible (como en WhatsApp).
 */

const h = vi.hoisted(() => ({
  ingest: vi.fn(async (_input: Record<string, unknown>) => {}),
}));

vi.mock("@/server/inbox/ingest", () => ({ ingestInboundMessage: h.ingest }));
vi.mock("@/server/instagram/credentials", () => ({
  getInstagramCredentialsByIgUserId: async (id: string) => ({
    organizationId: "org_1",
    source: "meta",
    igUserId: id,
    token: "t",
  }),
  getInstagramCredentialsByAccountRef: async () => null,
}));

import { botonDeQuickReply } from "@/server/channels/botones";
import { processMetaInstagramPayload } from "@/server/instagram/ingest";
import { normalizeMetaPagePayload } from "@/server/messenger/ingest";
import { UNREVIEWED_TEXT } from "@/server/privacy/privacy-filter";
import { filtrarPayload } from "@/server/privacy/webhook";

const IG = "17841400000000001";
const PAGE = "1092837465";

function webhook(object: "instagram" | "page", id: string, message: Record<string, unknown>) {
  return {
    object,
    entry: [
      {
        id,
        time: 1_770_000_000_000,
        messaging: [
          {
            sender: { id: "u_1" },
            recipient: { id },
            timestamp: 1_770_000_000_000,
            message: { mid: "m_1", ...message },
          },
        ],
      },
    ],
  };
}

const TOQUE = { text: "No acepto", quick_reply: { payload: "consentimiento:no_acepto" } };

beforeEach(() => h.ingest.mockClear());

describe("077 — botonDeQuickReply", () => {
  it("devuelve el payload", () => {
    expect(botonDeQuickReply(TOQUE)).toBe("consentimiento:no_acepto");
  });
  it("sin quick_reply, vacío, de otro tipo o de más de 256: null", () => {
    expect(botonDeQuickReply({ text: "hola" })).toBeNull();
    expect(botonDeQuickReply({ quick_reply: { payload: "" } })).toBeNull();
    expect(botonDeQuickReply({ quick_reply: { payload: 7 } })).toBeNull();
    expect(botonDeQuickReply({ quick_reply: "x" })).toBeNull();
    expect(botonDeQuickReply({ quick_reply: { payload: "x".repeat(257) } })).toBeNull();
    expect(botonDeQuickReply({ quick_reply: { payload: "x".repeat(256) } })).toBe("x".repeat(256));
    expect(botonDeQuickReply(null)).toBeNull();
  });
});

describe("077 — Messenger guarda el botón tocado", () => {
  it("el toque entra con botonId y el título como texto", () => {
    const [evt] = normalizeMetaPagePayload(webhook("page", PAGE, TOQUE));
    expect(evt).toMatchObject({ text: "No acepto", botonId: "consentimiento:no_acepto" });
  });
  it("un texto escrito no trae botón", () => {
    const [evt] = normalizeMetaPagePayload(webhook("page", PAGE, { text: "no acepto" }));
    expect(evt?.botonId).toBeNull();
  });
  it("un eco con quick_reply se sigue ignorando", () => {
    expect(normalizeMetaPagePayload(webhook("page", PAGE, { ...TOQUE, is_echo: true }))).toEqual([]);
  });
  it("sin perfil legible, el título del botón se conserva tras el filtro", () => {
    const filtrado = filtrarPayload(webhook("page", PAGE, TOQUE), null);
    const [evt] = normalizeMetaPagePayload(filtrado);
    expect(evt).toMatchObject({ text: "No acepto", botonId: "consentimiento:no_acepto", marcas: [] });
  });
  it("sin perfil legible, lo escrito no se guarda", () => {
    const filtrado = filtrarPayload(webhook("page", PAGE, { text: "no acepto" }), null);
    const [evt] = normalizeMetaPagePayload(filtrado);
    expect(evt).toMatchObject({ text: UNREVIEWED_TEXT, botonId: null, marcas: ["sin_revisar"] });
  });
});

describe("077 — Instagram guarda el botón tocado", () => {
  it("el toque llega a la ingesta con botonId", async () => {
    await processMetaInstagramPayload(filtrarPayload(webhook("instagram", IG, TOQUE), null));
    expect(h.ingest).toHaveBeenCalledTimes(1);
    expect(h.ingest.mock.calls[0]![0]).toMatchObject({
      organizationId: "org_1",
      waMessageId: "ig_m_1",
      text: "No acepto",
      botonId: "consentimiento:no_acepto",
      marcas: [],
    });
  });
  it("lo escrito llega sin botón (y sin perfil, omitido)", async () => {
    await processMetaInstagramPayload(filtrarPayload(webhook("instagram", IG, { text: "no acepto" }), null));
    expect(h.ingest.mock.calls[0]![0]).toMatchObject({
      text: UNREVIEWED_TEXT,
      botonId: null,
      marcas: ["sin_revisar"],
    });
  });
  it("un payload de más de 256 entra como texto normal", async () => {
    await processMetaInstagramPayload(
      webhook("instagram", IG, { text: "Otro", quick_reply: { payload: "x".repeat(300) } })
    );
    expect(h.ingest.mock.calls[0]![0]).toMatchObject({ text: "Otro", botonId: null });
  });
});
