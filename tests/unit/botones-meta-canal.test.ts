import { describe, expect, it } from "vitest";
import { admiteBotones } from "@/server/channels/botones";
import { capabilitiesFor } from "@/server/channels/capabilities";

/** 077 (T3) — Qué canales y qué conexiones admiten botones. */
describe("077 — la capacidad de botones", () => {
  it("WhatsApp, Instagram y Messenger sí; TikTok no", () => {
    expect(capabilitiesFor("whatsapp").buttons).toBe(true);
    expect(capabilitiesFor("instagram").buttons).toBe(true);
    expect(capabilitiesFor("messenger").buttons).toBe(true);
    expect(capabilitiesFor("tiktok").buttons).toBe(false);
  });

  it("solo con la conexión directa con Meta", () => {
    expect(admiteBotones("instagram", "meta")).toBe(true);
    expect(admiteBotones("messenger", "meta")).toBe(true);
    expect(admiteBotones("whatsapp", "meta")).toBe(true);
    expect(admiteBotones("instagram", "zernio")).toBe(false);
    expect(admiteBotones("messenger", "zernio")).toBe(false);
    expect(admiteBotones("tiktok", "zernio")).toBe(false);
    expect(admiteBotones("whatsapp", null)).toBe(false);
  });
});
