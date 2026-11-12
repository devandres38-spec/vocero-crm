import { beforeEach, describe, expect, it, vi } from "vitest";

/** 078 (T3) — `POST /api/bot/stage`: `evento` o `stage`, uno de los dos. */
const h = vi.hoisted(() => ({ llamadas: [] as string[] }));

vi.mock("@/server/bot/auth", () => ({ requireBot: async () => ({ organizationId: "org_1" }) }));
vi.mock("@/server/bot/ruta", () => ({ rutaDelCerebro: (fn: unknown) => fn }));
vi.mock("@/server/events/bus", () => ({ publish: () => {} }));
vi.mock("@/server/bot/stage", () => ({
  moverEtapaPorEvento: async (i: { evento: string }) => {
    h.llamadas.push(`evento:${i.evento}`);
    return { ok: true, changed: false, motivo: "sin_etapa", conversationId: "cv_1" };
  },
  moverEtapaPorElCerebro: async (i: { stage: string }) => {
    h.llamadas.push(`stage:${i.stage}`);
    return { ok: true, changed: true, lead: { id: "ld_1", stageName: "Interesado" }, conversationId: "cv_1" };
  },
}));

import { POST } from "@/app/api/bot/stage/route";

const pedir = (body: Record<string, unknown>) =>
  (POST as (r: Request) => Promise<Response>)(
    new Request("http://x/api/bot/stage", {
      method: "POST",
      body: JSON.stringify({ conversationId: "cv_1", ...body }),
    })
  );

beforeEach(() => {
  h.llamadas.length = 0;
});

describe("078 — la ruta de la etapa", () => {
  it("con evento: la etapa por evento, con su motivo", async () => {
    const r = await pedir({ evento: "primera_respuesta" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, changed: false, motivo: "sin_etapa" });
    expect(h.llamadas).toEqual(["evento:primera_respuesta"]);
  });

  it("con stage: como siempre (cerebros externos)", async () => {
    const r = await pedir({ stage: "Interesado" });
    expect(await r.json()).toEqual({ ok: true, changed: true, lead: { id: "ld_1", stageName: "Interesado" } });
    expect(h.llamadas).toEqual(["stage:Interesado"]);
  });

  it("los dos, ninguno o un evento fuera del catálogo: 422", async () => {
    for (const body of [{ evento: "primera_respuesta", stage: "X" }, {}, { evento: "ganar" }]) {
      expect((await pedir(body)).status).toBe(422);
    }
    expect(h.llamadas).toEqual([]);
  });
});
