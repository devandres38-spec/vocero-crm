import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { armarEvento, construirEventoOlvido, firmarCuerpo } from "@/server/brains/contract";
import { credencialDerivada } from "@/server/brains/deployment";

/**
 * 070 (US7, SC-004) — Vectores gemelos con `nea-agent`.
 *
 * Los MISMOS valores están fijados en `nea-agent/tests/test_brains_gemelo.py`.
 * Si cualquiera de los dos lados cambia el dominio, la codificación, el orden
 * de las llaves o una ruta, una de las dos suites se pone roja en vez de
 * fallar en producción con un 401 o un 422 mudos.
 */

const SECRETO = "un-secreto-de-despliegue-largo-y-aburrido";

export const CUERPO_MULTI =
  '{"dispatchId":"dsp_gemelo_multi_0001","organization":{"id":"org_abc123","slug":"clinica-norte"},"conversation":{"id":"cv_gemelo","channel":"whatsapp","aiEnabled":true,"windowOpen":true,"windowExpiresAt":"2026-11-19T15:00:05.000Z"},"contact":{"id":"ct_gemelo","displayName":"Ana Pérez","identity":"573001112233"},"messages":[{"id":"msg_g1","at":"2026-11-18T15:00:05.000Z","type":"text","text":"hola, ¿tienen cita mañana?","mediaId":null}],"firstMessageAt":"2026-11-18T15:00:05.000Z","lastMessageAt":"2026-11-18T15:00:05.000Z","expiresAt":"2026-11-18T15:10:00.000Z"}';
const FIRMA_MULTI = "sha256=5795926178909e5f3f532f5faa2de50c470326cea8c5d23952c6f976cbaed67e";

const CUERPO_OLVIDO =
  '{"type":"conversation.deleted","eventId":"olv_gemelo","organization":{"id":"org_abc123","slug":"clinica-norte"},"conversation":{"id":"cv_gemelo","channel":"whatsapp"},"contact":{"id":"ct_gemelo","identity":"573001112233"},"deletedAt":"2026-11-18T16:00:00.000Z"}';
const FIRMA_OLVIDO = "sha256=4c7f3c9fad2a3efb8d18d293f7525c01bf193a15e119fa2fb3a5753d59b2843e";

/** Las rutas que llama `BrainsCrmClient` (`RUTAS` + prefijos + métodos propios). */
export const RUTAS_DE_NEA = [
  "/api/brains/context",
  "/api/brains/messages",
  "/api/brains/ficha",
  "/api/brains/stage",
  "/api/brains/handoff",
  "/api/brains/typing",
  "/api/brains/agenda/slots",
  "/api/brains/agenda/book",
  "/api/brains/agenda/bookings",
  "/api/brains/agenda/cancel",
  "/api/brains/agenda/followup",
  "/api/brains/media/",
  "/api/brains/llm/chat/completions",
];

describe("vectores gemelos con nea-agent", () => {
  it("credencial derivada", () => {
    expect(credencialDerivada(SECRETO, "org_abc123")).toBe("_BqRKryMUdexcuLj_3RG1ARbgqr_LhXRSLJYmrw5VJ0");
  });

  it("el cuerpo del despacho en `multi` (con expiresAt al final) y su firma", () => {
    const e = armarEvento({
      dispatchId: "dsp_gemelo_multi_0001",
      organization: { id: "org_abc123", slug: "clinica-norte" },
      conversation: {
        id: "cv_gemelo",
        channel: "whatsapp",
        aiEnabled: true,
        windowOpen: true,
        windowExpiresAt: new Date("2026-11-19T15:00:05Z"),
      },
      contact: { id: "ct_gemelo", displayName: "Ana Pérez", identity: "573001112233" },
      messages: [
        { id: "msg_g1", createdAt: new Date("2026-11-18T15:00:05Z"), type: "text", text: "hola, ¿tienen cita mañana?", media: null },
      ],
      firstMessageAt: new Date("2026-11-18T15:00:05Z"),
      lastMessageAt: new Date("2026-11-18T15:00:05Z"),
      expiresAt: new Date("2026-11-18T15:10:00Z"),
    });
    expect(JSON.stringify(e)).toBe(CUERPO_MULTI);
    expect(firmarCuerpo(CUERPO_MULTI, SECRETO)).toBe(FIRMA_MULTI);
  });

  it("el evento conversation.deleted y su firma", () => {
    const e = construirEventoOlvido({
      eventId: "olv_gemelo",
      organization: { id: "org_abc123", slug: "clinica-norte" },
      conversation: { id: "cv_gemelo", channel: "whatsapp" },
      contact: { id: "ct_gemelo", identity: "573001112233" },
      deletedAt: new Date("2026-11-18T16:00:00Z"),
    });
    expect(JSON.stringify(e)).toBe(CUERPO_OLVIDO);
    expect(firmarCuerpo(CUERPO_OLVIDO, SECRETO)).toBe(FIRMA_OLVIDO);
  });

  it("cada ruta que llama Nea existe en el CRM", () => {
    const raiz = join(process.cwd(), "src/app");
    const existe = (ruta: string): boolean => {
      // `/api/brains/media/` y `/api/brains/llm/...` caen en rutas dinámicas.
      const partes = ruta.replace(/\/$/, "").split("/").filter(Boolean);
      let dir = raiz;
      for (const p of partes) {
        const hijos = readdirSync(dir);
        const directo = hijos.find((x) => x === p);
        const dinamico = hijos.find((x) => /^\[/.test(x) && statSync(join(dir, x)).isDirectory());
        if (directo) dir = join(dir, directo);
        else if (dinamico) return readdirSync(join(dir, dinamico)).includes("route.ts");
        else return false;
      }
      const hijos = readdirSync(dir);
      if (hijos.includes("route.ts")) return true;
      const dinamico = hijos.find((x) => /^\[/.test(x));
      return dinamico ? readdirSync(join(dir, dinamico)).includes("route.ts") : false;
    };
    for (const r of RUTAS_DE_NEA) expect(existe(r), r).toBe(true);
  });
});
