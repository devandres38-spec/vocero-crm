import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 073-A (D3) — El despacho:
 * - `despacharAlCerebro` no encola con la llave de IA del negocio pausada o
 *   sin configurar (en plataforma), y deja un incidente agrupado por hora.
 * - El worker entrega en paralelo: hasta `CARRILES`, como mucho
 *   `MAX_POR_ORG` de un mismo negocio, y un despacho que revienta no tumba
 *   a los demás.
 */

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  estadoIa: vi.fn(),
  registrar: vi.fn(async () => true),
  encolar: vi.fn(async () => ({ id: "dsp_1", notBefore: new Date() })),
  suspendida: vi.fn(async () => false),
  // worker
  cola: [] as { id: string; organizationId: string; conversationId: string }[],
  excluidas: [] as string[][],
  /** Auditoría 073-A: el reclamo número N (1-based) revienta. */
  reclamoFalla: 0,
  reclamos: 0,
  entregar: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/ai/provider", () => ({ estadoIaDe: h.estadoIa }));
vi.mock("@/server/incidentes", () => ({
  registrarIncidente: h.registrar,
  cuboHora: () => "2026-11-19T22",
  avisarCaidaDelCerebro: vi.fn(),
}));
vi.mock("@/server/platform/estado", () => ({ organizacionSuspendida: h.suspendida }));
vi.mock("@/server/brains/destino", () => ({
  destinoDe: vi.fn(async () => ({ url: "https://nea.test/vocero/dispatch", secret: "s" })),
}));
vi.mock("@/server/brains/red", () => ({ verificarDestino: vi.fn(async () => null) }));
vi.mock("@/server/brains/deliver", () => ({
  construirEvento: vi.fn(async (fila: { id: string }) => ({ dispatchId: fila.id, messages: [{ id: "m" }] })),
  entregar: h.entregar,
  rafagaDe: vi.fn(async () => []),
  sinDespachar: vi.fn(() => []),
}));
vi.mock("@/server/dispatch/outbox", () => ({
  encolarDespacho: h.encolar,
  tomarPendientes: vi.fn(async (_limite: number, _ahora: Date, excluir: readonly string[] = []) => {
    h.excluidas.push([...excluir]);
    h.reclamos++;
    if (h.reclamos === h.reclamoFalla) throw new Error("base caída");
    const i = h.cola.findIndex((f) => !excluir.includes(f.organizationId));
    if (i < 0) return [];
    return h.cola.splice(i, 1);
  }),
  renovarLease: vi.fn(async () => true),
  marcarEntregado: vi.fn(async () => true),
  mensajesAnotados: vi.fn(async () => []),
  descartarDespacho: vi.fn(),
  anotarDespliegue: vi.fn(async () => true),
  reintentarOCaducar: vi.fn(async () => false),
  caducarAHumano: vi.fn(async () => false),
}));

import { schema } from "@/lib/db";
import { despacharAlCerebro } from "@/server/dispatch/encolar";
import { CARRILES, MAX_POR_ORG, detenerWorker, tanda } from "@/server/dispatch/worker";

const CONV_ACTIVA = { aiEnabled: true, handoffAt: null, isTest: false };

beforeEach(() => {
  vi.unstubAllEnvs();
  h.fake!.reiniciar();
  for (const f of [h.estadoIa, h.registrar, h.encolar, h.entregar]) f.mockClear();
  h.cola.length = 0;
  h.excluidas.length = 0;
  h.reclamos = 0;
  h.reclamoFalla = 0;
  detenerWorker();
});

function conversacionYPerfil() {
  h.fake!.responder(schema.conversation, [CONV_ACTIVA]);
  h.fake!.responder(schema.agentProfile, [{ enabled: true }]);
}

describe("despacharAlCerebro: sin llave de IA no hay cascada (punto ciego n.º 1)", () => {
  it("plataforma + llave pausada por saldo → no encola y deja incidente sin_saldo por hora", async () => {
    vi.stubEnv("TENANCY", "multi");
    conversacionYPerfil();
    h.estadoIa.mockResolvedValue({ activa: false, motivo: "sin_saldo", last4: "1234", desde: null });

    await despacharAlCerebro("cv_1", "org_1", "msg_1");

    expect(h.encolar).not.toHaveBeenCalled();
    expect(h.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", kind: "sin_saldo", dedupeKey: "sin_saldo:2026-11-19T22" })
    );
  });

  it("plataforma + sin llave configurada → incidente sin_credencial", async () => {
    vi.stubEnv("TENANCY", "multi");
    conversacionYPerfil();
    h.estadoIa.mockResolvedValue({ activa: false, motivo: "sin_configurar" });

    await despacharAlCerebro("cv_1", "org_1", "msg_1");

    expect(h.encolar).not.toHaveBeenCalled();
    expect(h.registrar).toHaveBeenCalledWith(expect.objectContaining({ kind: "sin_credencial" }));
  });

  it("plataforma + llave activa → encola como siempre", async () => {
    vi.stubEnv("TENANCY", "multi");
    conversacionYPerfil();
    h.estadoIa.mockResolvedValue({ activa: true, origen: "org", last4: "1234" });

    await despacharAlCerebro("cv_1", "org_1", "msg_1");

    expect(h.encolar).toHaveBeenCalledTimes(1);
    expect(h.registrar).not.toHaveBeenCalled();
  });

  it("single: no mira la llave (Nea puede tener la suya)", async () => {
    conversacionYPerfil();

    await despacharAlCerebro("cv_1", "org_1", "msg_1");

    expect(h.estadoIa).not.toHaveBeenCalled();
    expect(h.encolar).toHaveBeenCalledTimes(1);
  });
});

describe("worker: entregas en paralelo sin head-of-line blocking", () => {
  function encolar(n: number, org: string) {
    for (let i = 0; i < n; i++) {
      h.cola.push({ id: `dsp_${org}_${i}`, organizationId: org, conversationId: `cv_${org}_${i}` });
      h.fake!.responder(schema.conversation, [CONV_ACTIVA]);
    }
  }

  it(`hasta ${CARRILES} a la vez y como mucho ${MAX_POR_ORG} por negocio`, async () => {
    encolar(4, "org_A");
    encolar(4, "org_B");
    let enVuelo = 0;
    let maxTotal = 0;
    const porOrg = new Map<string, number>();
    let maxPorOrg = 0;
    h.entregar.mockImplementation(async (evento: { dispatchId: string }) => {
      const org = evento.dispatchId.split("_")[1]! + "_" + evento.dispatchId.split("_")[2]!;
      enVuelo++;
      porOrg.set(org, (porOrg.get(org) ?? 0) + 1);
      maxTotal = Math.max(maxTotal, enVuelo);
      maxPorOrg = Math.max(maxPorOrg, porOrg.get(org)!);
      await new Promise((r) => setTimeout(r, 10));
      enVuelo--;
      porOrg.set(org, porOrg.get(org)! - 1);
      return { ok: true };
    });

    const tomados = await tanda();

    expect(tomados).toBe(8);
    expect(h.entregar).toHaveBeenCalledTimes(8);
    expect(maxTotal).toBe(CARRILES);
    expect(maxPorOrg).toBe(MAX_POR_ORG);
    // El reclamo excluye a los negocios que llegaron a su tope.
    expect(h.excluidas.some((e) => e.length > 0)).toBe(true);
  });

  it("un cerebro colgado de un negocio no frena al otro", async () => {
    encolar(2, "org_A");
    encolar(2, "org_B");
    const orden: string[] = [];
    let soltarA: () => void = () => {};
    const colgado = new Promise<void>((r) => (soltarA = r));
    h.entregar.mockImplementation(async (evento: { dispatchId: string }) => {
      if (evento.dispatchId.includes("org_A")) await colgado;
      orden.push(evento.dispatchId);
      return { ok: true };
    });

    const corriendo = tanda();
    await new Promise((r) => setTimeout(r, 20));
    // Los de org_B ya salieron aunque los de org_A siguen colgados.
    expect(orden.filter((d) => d.includes("org_B"))).toHaveLength(2);
    soltarA();
    expect(await corriendo).toBe(4);
  });

  it("un despacho que revienta no tumba a los demás carriles", async () => {
    encolar(3, "org_A");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    h.entregar
      .mockRejectedValueOnce(new Error("bug"))
      .mockResolvedValue({ ok: true });

    expect(await tanda()).toBe(3);
    expect(h.entregar).toHaveBeenCalledTimes(3);
    espia.mockRestore();
  });

  it("auditoría 073-A: si la base falla al reclamar, la tanda espera a los carriles en vuelo", async () => {
    encolar(1, "org_A");
    let soltar: () => void = () => {};
    const colgado = new Promise<void>((r) => (soltar = r));
    let terminado = false;
    h.entregar.mockImplementation(async () => {
      await colgado;
      terminado = true;
      return { ok: true };
    });
    // El 1.º reclamo toma el despacho; el 2.º (otro carril) revienta.
    h.reclamoFalla = 2;
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});

    let resuelta = false;
    const corriendo = tanda().then((n) => {
      resuelta = true;
      return n;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(resuelta).toBe(false);
    // `corriendo` sigue puesto: otra tanda no arranca encima.
    expect(await tanda()).toBe(0);

    soltar();
    expect(await corriendo).toBe(1);
    expect(terminado).toBe(true);
    expect(espia).toHaveBeenCalledWith("[despacho] no se pudo reclamar:", expect.any(Error));
    espia.mockRestore();
  });
});
