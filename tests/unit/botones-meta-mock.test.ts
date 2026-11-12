import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 077 (T5) — El mock de Graph hace de graph.instagram.com en
 * `/graph/instagram/...` y valida los Quick Replies como Meta: hasta 13,
 * títulos de hasta 20 y, en Instagram, solo de texto.
 */
vi.mock("@/lib/dev-guard", () => ({ mockGuard: () => null }));

import { POST } from "@/app/api/dev/wa-mock/graph/[...path]/route";
import { getWaMockState } from "@/server/dev/wa-mock-state";

const qr = (n: number, extra: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => ({ content_type: "text", title: `B${i}`, payload: `p${i}`, ...extra }));

async function enviar(path: string[], quick_replies: unknown) {
  const res = await POST(
    new Request("http://x/api/dev/wa-mock/graph", {
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: "u" }, message: { text: "¿Aceptas?", quick_replies } }),
    }),
    { params: Promise.resolve({ path }) }
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const IG = ["instagram", "v25.0", "17841400000000001", "messages"];
const FB = ["v25.0", "page-1", "messages"];

beforeEach(() => {
  getWaMockState().outbox.length = 0;
});

describe("077 — el mock de Graph con Quick Replies", () => {
  it("Instagram: queda en el outbox marcado y responde message_id", async () => {
    const r = await enviar(IG, qr(2));
    expect(r.status).toBe(200);
    expect(r.json.message_id).toEqual(expect.any(String));
    const [e] = getWaMockState().outbox;
    expect(e).toMatchObject({ canal: "instagram", phoneNumberId: "17841400000000001" });
  });

  it("Messenger: sin marca de Instagram", async () => {
    expect((await enviar(FB, qr(2))).status).toBe(200);
    expect(getWaMockState().outbox[0]?.canal).toBeUndefined();
  });

  it("más de 13: 400", async () => {
    expect((await enviar(IG, qr(14))).status).toBe(400);
    expect((await enviar(FB, qr(14))).status).toBe(400);
    expect((await enviar(FB, qr(13))).status).toBe(200);
  });

  it("un título de más de 20: 400", async () => {
    expect((await enviar(FB, qr(1, { title: "x".repeat(21) }))).status).toBe(400);
  });

  it("en Instagram solo de texto; en Messenger, user_email sí", async () => {
    expect((await enviar(IG, [{ content_type: "user_email" }])).status).toBe(400);
    expect((await enviar(FB, [{ content_type: "user_email" }])).status).toBe(200);
  });
});
