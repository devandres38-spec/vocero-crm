import { describe, expect, it } from "vitest";
import { buildInstagramSendBody, sendInstagramText } from "@/server/instagram/send";
import { buildMessengerSendBody, sendMessengerText } from "@/server/messenger/send";

/**
 * 077 (T4) — Los botones salen como Quick Replies de Meta: `content_type:
 * "text"`, el título y nuestro id en `payload`. Sin botones, el cuerpo es el
 * de siempre.
 */
const BOTONES = [
  { id: "consentimiento:acepto", title: "Acepto" },
  { id: "consentimiento:no_acepto", title: "No acepto" },
];
const QUICK = [
  { content_type: "text", title: "Acepto", payload: "consentimiento:acepto" },
  { content_type: "text", title: "No acepto", payload: "consentimiento:no_acepto" },
];

describe("077 — Instagram (graph.instagram.com)", () => {
  it("con botones: message.quick_replies, sin messaging_type", () => {
    expect(buildInstagramSendBody({ recipient: "igsid", text: "¿Aceptas?", botones: BOTONES })).toEqual({
      recipient: { id: "igsid" },
      message: { text: "¿Aceptas?", quick_replies: QUICK },
    });
  });

  it("sin botones, el cuerpo de siempre (y la etiqueta si toca)", () => {
    expect(buildInstagramSendBody({ recipient: "igsid", text: "Hola" })).toEqual({
      recipient: { id: "igsid" },
      message: { text: "Hola" },
    });
    expect(buildInstagramSendBody({ recipient: "igsid", text: "Hola", humanAgentTag: true, botones: [] })).toEqual({
      recipient: { id: "igsid" },
      message: { text: "Hola" },
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
    });
  });

  it("por Zernio, con botones, no sale nada", async () => {
    await expect(
      sendInstagramText({
        credentials: { source: "zernio", token: "t", accountRef: "a" } as never,
        recipient: "igsid",
        threadRef: "th",
        text: "x",
        botones: BOTONES,
      })
    ).rejects.toThrow("Zernio no envía botones");
  });
});

describe("077 — Messenger (graph.facebook.com)", () => {
  it("con botones: message.quick_replies y messaging_type RESPONSE", () => {
    expect(
      buildMessengerSendBody({ recipient: "psid", text: "¿Aceptas?", humanAgentTag: false, botones: BOTONES })
    ).toEqual({
      recipient: { id: "psid" },
      message: { text: "¿Aceptas?", quick_replies: QUICK },
      messaging_type: "RESPONSE",
    });
  });

  it("sin botones, el cuerpo de siempre", () => {
    expect(buildMessengerSendBody({ recipient: "psid", text: "Hola", humanAgentTag: false })).toEqual({
      recipient: { id: "psid" },
      message: { text: "Hola" },
      messaging_type: "RESPONSE",
    });
  });

  it("por Zernio, con botones, no sale nada", async () => {
    await expect(
      sendMessengerText({
        credentials: { source: "zernio", token: "t", accountRef: "a" } as never,
        recipient: "psid",
        threadRef: "th",
        text: "x",
        botones: BOTONES,
      })
    ).rejects.toThrow("Zernio no envía botones");
  });
});
