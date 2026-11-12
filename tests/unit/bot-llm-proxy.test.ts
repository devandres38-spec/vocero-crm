import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 080 (P7) — `POST /api/bot/llm/{ruta}` está apagado: responde 404
 * `proxy_apagado` a cualquiera (con o sin `BOT_API_KEY`) y nunca llama al
 * proveedor. Con la llave de Aliantis sería gasto sin tope y sin proveedores
 * fijos, y nuestro cerebro piensa con su propia llave.
 */
import { POST } from "@/app/api/bot/llm/[...ruta]/route";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("BOT_API_KEY", "b".repeat(32));
  vi.stubEnv("OPENROUTER_API_TOKEN", "sk-or-de-aliantis");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("080 — el proxy /api/bot/llm apagado", () => {
  it("404 proxy_apagado, sin llamar al proveedor ni devolver la llave", async () => {
    const res = await POST();
    expect(res.status).toBe(404);
    const texto = await res.text();
    expect(JSON.parse(texto).error.code).toBe("proxy_apagado");
    expect(texto).not.toContain("sk-or-de-aliantis");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
