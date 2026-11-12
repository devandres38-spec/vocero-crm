import { describe, expect, it, vi } from "vitest";
import { firmar, pedirGasto, urlDelGasto } from "@/server/panel/gasto";

/**
 * 076 (D16, respuesta 5 de Andres) — El panel le pide al cerebro el gasto por
 * negocio con una firma derivada de `BOT_API_KEY`. La firma de este vector es
 * la MISMA en `aliantis-brain` (`test/unit/gasto-route.test.ts`, prueba
 * gemela): si una punta cambia la llave o la etiqueta, falla aquí o allá.
 */
const CLAVE = "clave-gemela-0123456789";
const CUERPO = '{"en":"2026-11-11T15:00:00.000Z"}';
const FIRMA = "sha256=e6f5787067adf98752d021d3b77b83004b8da94f5bb1750bdef0bc9a6a65ad2d";

const env = { BRAIN_DISPATCH_URL: "http://cerebro:8080/vocero/dispatch", BOT_API_KEY: CLAVE };
const AHORA = Date.parse("2026-11-11T15:00:00Z");
const NEGOCIO = {
  organizationId: "org_a",
  topeDiarioUsd: 2,
  zonaHoraria: "America/Bogota",
  hoyUsd: 0.5,
  mesUsd: 3,
  llamadasHoy: 10,
  fallidasHoy: 1,
  pruebasHoyUsd: 0.1,
};

describe("076 — el gasto que se le pide al cerebro", () => {
  it("la firma gemela: llave derivada de BOT_API_KEY, no la BOT_API_KEY", () => {
    expect(firmar(CUERPO, CLAVE)).toBe(FIRMA);
  });

  it("la URL sale del origen del despacho; sin cerebro o sin llave, no hay", () => {
    expect(urlDelGasto(env)).toBe("http://cerebro:8080/vocero/gasto");
    expect(urlDelGasto({ BOT_API_KEY: CLAVE })).toBeNull();
    expect(urlDelGasto({ BRAIN_DISPATCH_URL: env.BRAIN_DISPATCH_URL })).toBeNull();
    expect(urlDelGasto({ ...env, BRAIN_DISPATCH_URL: "no es url" })).toBeNull();
  });

  it("pide con la hora y la firma, y valida la respuesta", async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBe(CUERPO);
      expect((init?.headers as Record<string, string>)["X-Vocero-Signature"]).toBe(FIRMA);
      return Response.json({ en: "2026-11-11T15:00:00.000Z", negocios: [NEGOCIO] });
    });
    const r = await pedirGasto({ env, fetch: f as typeof fetch, ahora: () => AHORA });
    expect(r?.negocios).toEqual([NEGOCIO]);
    expect(f).toHaveBeenCalledWith("http://cerebro:8080/vocero/gasto", expect.anything());
  });

  it("si el cerebro falla, contesta otra cosa o no responde: null (el panel sigue)", async () => {
    const mal = async () => Response.json({ algo: 1 });
    const caido = async () => new Response("", { status: 503 });
    const roto = async () => {
      throw new Error("ECONNREFUSED");
    };
    for (const f of [mal, caido, roto]) {
      expect(await pedirGasto({ env, fetch: f as typeof fetch, ahora: () => AHORA })).toBeNull();
    }
  });

  it("una llave de más en la respuesta no pasa (zod la descarta)", async () => {
    const f = async () =>
      Response.json({ en: "x", negocios: [{ ...NEGOCIO, conversationId: "cv_secreta" }] });
    const r = await pedirGasto({ env, fetch: f as typeof fetch, ahora: () => AHORA });
    expect(JSON.stringify(r)).not.toContain("cv_secreta");
  });
});
