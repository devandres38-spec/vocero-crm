import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 080 (T4, D20) — El tope diario del Laboratorio: el día se cuenta en la zona
 * del negocio, el tope alcanzado no crea corrida, y la ruta responde en el
 * orden de la spec (403, sin_cerebro, laboratorio_sin_llave, 429, 409).
 */

const h = vi.hoisted(() => ({
  rol: "owner" as string,
  cerebro: true,
  llave: true,
  hechas: 0,
  tope: 3,
  inserts: [] as unknown[],
  startRun: null as null | ((org: string, t: { maximo: number; desde: Date }) => Promise<string>),
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({ userId: "usr_1", organizationId: "org_1", role: h.rol }),
  getSessionOrNull: async () => ({ userId: "usr_1", organizationId: "org_1", role: h.rol }),
}));
vi.mock("@/lib/ai/provider", () => ({ isAiConfiguredFor: async () => h.llave }));
vi.mock("@/server/brains/config", () => ({ leerConfigDespacho: () => ({ active: h.cerebro }) }));
vi.mock("@/server/analytics/period", () => ({ businessTimezone: async () => "America/Bogota" }));
// Lo de fondo de la corrida no se prueba aquí.
vi.mock("@/lib/db/contexto", () => ({
  conNegocio: (_o: string, fn: () => unknown) => fn(),
  trabajoDeFondo: () => new Promise(() => {}),
}));

/** Una base falsa: el conteo devuelve `h.hechas`; los inserts se anotan. */
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  const consulta = (campos: Record<string, unknown> | undefined) => (tabla: unknown) => {
    const filas =
      tabla === real.schema.organization
        ? [{ tope: h.tope }]
        : tabla === real.schema.agentTestRun && campos && "n" in campos
          ? [{ n: h.hechas }]
          : [];
    const q = {
      where: () => q,
      limit: () => q,
      orderBy: () => q,
      then: (ok: (v: unknown[]) => unknown) => Promise.resolve(filas).then(ok),
    };
    return q;
  };
  const db = {
    select: (campos?: Record<string, unknown>) => ({ from: consulta(campos) }),
    insert: () => ({
      values: (v: unknown) => {
        h.inserts.push(v);
        const r = {
          returning: async () => [{ id: "run_1" }],
          then: (ok: (x: unknown) => unknown) => Promise.resolve(undefined).then(ok),
        };
        return r;
      },
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { ...real, getDb: () => db };
});

vi.mock("@/server/lab/runner", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/lab/runner")>();
  return {
    ...real,
    startRun: (org: string, t: { maximo: number; desde: Date }) =>
      (h.startRun ?? real.startRun)(org, t),
  };
});

import { GET, POST } from "@/app/api/lab/runs/route";
import { startRun, TopeAlcanzadoError } from "@/server/lab/runner";
import { diaDelNegocio, estadoDelTope, mensajeTope } from "@/server/lab/tope";
import { textoCupo } from "@/components/lab/lab-client";

const correr = () => POST();
const codigo = async (r: Response) =>
  ((await r.json()) as { error?: { code?: string } }).error?.code;

beforeEach(() => {
  h.rol = "owner";
  h.cerebro = true;
  h.llave = true;
  h.hechas = 0;
  h.tope = 3;
  h.inserts = [];
  h.startRun = null;
});

describe("el día del negocio (P2: en su zona, no en UTC)", () => {
  it("a las 22:00 de Bogotá (03:00 UTC del día siguiente) el día empezó a las 05:00 UTC del anterior", () => {
    const d = diaDelNegocio(new Date("2026-11-12T03:00:00Z"), "America/Bogota");
    expect(d.desde.toISOString()).toBe("2026-11-11T05:00:00.000Z");
    expect(d.seLibera.toISOString()).toBe("2026-11-12T05:00:00.000Z");
  });

  it("una corrida de ayer en hora local (23:30 del 10) no cuenta, aunque sea el mismo día UTC", () => {
    const d = diaDelNegocio(new Date("2026-11-11T20:00:00Z"), "America/Bogota");
    const ayerLocal = new Date("2026-11-11T04:30:00Z"); // 10-nov 23:30 en Bogotá
    expect(ayerLocal >= d.desde).toBe(false);
    // Contado en UTC, sí habría entrado: eso es lo que no se hace.
    expect(ayerLocal >= new Date("2026-11-11T00:00:00Z")).toBe(true);
  });

  it("disponible solo por debajo del tope; con tope 0 nunca", () => {
    const d = diaDelNegocio(new Date("2026-11-12T15:00:00Z"), "America/Bogota");
    expect(estadoDelTope(2, 3, d).disponible).toBe(true);
    expect(estadoDelTope(3, 3, d).disponible).toBe(false);
    expect(estadoDelTope(0, 0, d).disponible).toBe(false);
  });

  it("los textos: el tope, cuándo se libera y el Laboratorio apagado", () => {
    const m = mensajeTope(3, new Date("2026-11-13T05:00:00Z"), "America/Bogota");
    expect(m).toContain("3 corridas");
    expect(m).toContain("00:00");
    expect(mensajeTope(0, new Date(), "America/Bogota")).toMatch(/apagado/);
    expect(textoCupo({ corridasHoy: 1, topeDiario: 3, disponible: true })).toBe(
      "Te quedan 2 corridas hoy"
    );
    expect(textoCupo({ corridasHoy: 2, topeDiario: 3, disponible: true })).toBe(
      "Te quedan 1 corrida hoy"
    );
    expect(textoCupo({ corridasHoy: 3, topeDiario: 3, disponible: false })).toBe(
      "Vuelve a estar disponible mañana"
    );
  });
});

describe("startRun cuenta antes de insertar", () => {
  const desde = new Date("2026-11-12T05:00:00Z");

  it("con N corridas hoy y tope N → TopeAlcanzadoError y no inserta nada", async () => {
    h.hechas = 3;
    await expect(startRun("org_1", { maximo: 3, desde })).rejects.toBeInstanceOf(
      TopeAlcanzadoError
    );
    expect(h.inserts).toEqual([]);
  });

  it("con tope 0 → TopeAlcanzadoError sin ninguna corrida", async () => {
    await expect(startRun("org_1", { maximo: 0, desde })).rejects.toBeInstanceOf(
      TopeAlcanzadoError
    );
    expect(h.inserts).toEqual([]);
  });

  it("por debajo del tope, inserta la corrida", async () => {
    h.hechas = 2;
    expect(await startRun("org_1", { maximo: 3, desde })).toBe("run_1");
    expect(h.inserts[0]).toMatchObject({ organizationId: "org_1", status: "running" });
  });
});

describe("POST /api/lab/runs, en el orden de la spec", () => {
  it("member → 403 antes que todo (P3), aunque falte el cerebro", async () => {
    h.rol = "member";
    h.cerebro = false;
    const r = await correr();
    expect(r.status).toBe(403);
    expect(await codigo(r)).toBe("forbidden");
  });

  it("sin cerebro → 409 sin_cerebro, antes que la llave", async () => {
    h.cerebro = false;
    h.llave = false;
    const r = await correr();
    expect(r.status).toBe(409);
    expect(await codigo(r)).toBe("sin_cerebro");
  });

  it("sin la llave de Aliantis → 409 laboratorio_sin_llave, antes que el tope", async () => {
    h.llave = false;
    h.tope = 0;
    const r = await correr();
    expect(r.status).toBe(409);
    expect(await codigo(r)).toBe("laboratorio_sin_llave");
  });

  it("tope alcanzado → 429 tope_laboratorio sin crear corrida, aunque haya una en curso", async () => {
    h.hechas = 3;
    const r = await correr();
    expect(r.status).toBe(429);
    const body = (await r.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("tope_laboratorio");
    expect(body.error.message).toContain("3 corridas");
    expect(h.inserts).toEqual([]);
  });

  it("tope en 0 → 429 que dice que está apagado", async () => {
    h.tope = 0;
    const r = await correr();
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/apagado/);
  });

  it("la ruta pasa a startRun el tope del negocio y la medianoche de su zona", async () => {
    const vistos: { maximo: number; desde: Date }[] = [];
    h.startRun = async (_o, t) => {
      vistos.push(t);
      return "run_9";
    };
    h.tope = 5;
    const r = await correr();
    expect(r.status).toBe(202);
    expect(vistos[0]!.maximo).toBe(5);
    // Medianoche en Bogotá = 05:00 UTC.
    expect(vistos[0]!.desde.getUTCHours()).toBe(5);
    expect(vistos[0]!.desde.getUTCMinutes()).toBe(0);
  });

  it("una corrida en curso (y bajo el tope) → 409 run_in_progress", async () => {
    const { RunConflictError } = await import("@/server/lab/runner");
    h.startRun = async () => {
      throw new RunConflictError("ya");
    };
    const r = await correr();
    expect(r.status).toBe(409);
    expect(await codigo(r)).toBe("run_in_progress");
  });
});

describe("GET /api/lab/runs", () => {
  it("devuelve el tope del día y si quien mira puede correr", async () => {
    h.hechas = 1;
    h.rol = "member";
    const body = (await (await GET()).json()) as {
      laboratorio: { corridasHoy: number; topeDiario: number; disponible: boolean };
      puedeCorrer: boolean;
    };
    expect(body.laboratorio).toMatchObject({ corridasHoy: 1, topeDiario: 3, disponible: true });
    expect(body.puedeCorrer).toBe(false);
  });
});
