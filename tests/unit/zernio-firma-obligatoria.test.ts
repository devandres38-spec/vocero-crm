import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 073 (respuesta 5 de Andres) — Zernio, la misma regla que Meta: una cuenta
 * conectada sin ningún secreto de webhook se rechaza en producción.
 */
vi.mock("@/server/zernio", async (orig) => ({
  ...(await orig<typeof import("@/server/zernio")>()),
  parseZernioEvent: () => ({ account: { id: "acc_1" } }),
}));
vi.mock("@/server/tiktok/ingest", async (orig) => ({
  ...(await orig<typeof import("@/server/tiktok/ingest")>()),
  zernioPlatform: () => "instagram",
}));
vi.mock("@/server/zernio/conexiones", () => ({
  findZernioConnection: async () => ({ connection: { organizationId: "org_a", token: "t" } }),
  healZernioAccountRef: async () => undefined,
  storedZernioSecrets: async () => [],
}));
vi.mock("@/server/zernio/webhooks", () => ({
  WEBHOOKS_RECHECK_MS: 0,
  webhookSecretsFromZernio: async () => [],
}));
vi.mock("@/server/whatsapp/webhook-url", () => ({ webhookVerifyToken: () => "seg" }));

import { isAuthenticZernioDelivery } from "@/server/zernio/dispatch";

afterEach(() => vi.unstubAllEnvs());

describe("073 — Zernio sin secreto", () => {
  it("en producción: rechazada", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await isAuthenticZernioDelivery("{}", null)).toBe(false);
    aviso.mockRestore();
  });

  it("fuera de producción: como antes, pasa", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await isAuthenticZernioDelivery("{}", null)).toBe(true);
  });
});
