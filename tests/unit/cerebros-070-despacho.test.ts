import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 070 — Bloque 2, F5: el despacho por organización. A qué cerebro va cada
 * negocio, el `expiresAt` del evento en `multi`, la anotación del despliegue
 * que lo recibió, el aviso de borrado al cerebro correcto y por qué no se
 * puede encender el agente.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") }),
}));

import { encryptSecret } from "@/lib/crypto";
import { armarEvento, construirEventoOlvido, firmarCuerpo } from "@/server/brains/contract";
import { avisarOlvido } from "@/server/brains/deliver";
import { invalidarCacheCerebro } from "@/server/brains/deployment";
import {
  configDespachoPara,
  despachoActivoPara,
  destinoDe,
  mensajeProblemaPlataforma,
  problemaDeCerebroEnPlataforma,
} from "@/server/brains/destino";

const fake = () => h.fake!;
const SECRETO = "d".repeat(43);

function secretoEnBase(status = "activo") {
  const e = encryptSecret(SECRETO);
  return { cipher: e.cipher, iv: e.iv, tag: e.tag, status };
}

function asignacion(extra: Record<string, unknown> = {}) {
  return {
    orgStatus: "activa",
    deploymentId: "brn_1",
    name: "Nea Producción",
    status: "activo",
    dispatchUrl: "http://nea:8000/vocero/dispatch",
    healthUrl: null,
    ...extra,
  };
}

beforeEach(() => {
  fake().reiniciar();
  invalidarCacheCerebro();
  vi.unstubAllEnvs();
});

describe("destinoDe — a qué cerebro va cada negocio", () => {
  it("`single`: el del entorno, como siempre (sin tocar la base)", async () => {
    vi.stubEnv("TENANCY", "");
    vi.stubEnv("BRAIN_DISPATCH_URL", "http://nea:8000/vocero/dispatch");
    vi.stubEnv("BOT_API_KEY", "k".repeat(32));
    const d = await destinoDe("org_cualquiera");
    expect(d).toMatchObject({ url: "http://nea:8000/vocero/dispatch", secret: "k".repeat(32), deploymentId: null });
    vi.stubEnv("BRAIN_DISPATCH_URL", "");
    expect(await destinoDe("org_cualquiera")).toBeNull();
  });

  it("`multi`: el despliegue asignado y activo, con SU secreto y su nombre (no su URL)", async () => {
    vi.stubEnv("TENANCY", "multi");
    fake().responder(schema.organization, [asignacion()]);
    fake().responder(schema.brainDeployment, [secretoEnBase()]);
    const d = await destinoDe("org_A");
    expect(d).toEqual({
      url: "http://nea:8000/vocero/dispatch",
      secret: SECRETO,
      host: "Nea Producción",
      deploymentId: "brn_1",
      healthUrl: "http://nea:8000/health",
    });
  });

  it("`multi`: sin cerebro, pausado o negocio suspendido → no se despacha", async () => {
    vi.stubEnv("TENANCY", "multi");
    for (const fila of [
      asignacion({ deploymentId: null, name: null, status: null, dispatchUrl: null }),
      asignacion({ status: "pausado" }),
      asignacion({ orgStatus: "suspendida" }),
    ]) {
      fake().reiniciar();
      fake().responder(schema.organization, [fila]);
      expect(await despachoActivoPara("org_A")).toBe(false);
    }
  });

  it("la tarjeta ve el NOMBRE del despliegue, también si está pausado", async () => {
    vi.stubEnv("TENANCY", "multi");
    fake().responder(schema.organization, [asignacion({ status: "pausado" })]);
    fake().responder(schema.organization, [asignacion({ status: "pausado" })]);
    expect(await configDespachoPara("org_A")).toEqual({ active: false, host: "Nea Producción", problem: null });
  });
});

describe("el evento en `multi` lleva expiresAt al final (el de `single` no cambia)", () => {
  const datos = {
    dispatchId: "dsp_1",
    organization: { id: "org_A", slug: "clinica" },
    conversation: { id: "cv_1", channel: "whatsapp" as const, aiEnabled: true, windowOpen: true, windowExpiresAt: null },
    contact: { id: "ct_1", displayName: "Ana", identity: "573001112233" },
    messages: [],
    firstMessageAt: new Date("2026-11-18T10:00:00Z"),
    lastMessageAt: new Date("2026-11-18T10:00:05Z"),
  };
  it("sin expiresAt: idéntico al de siempre", () => {
    expect(Object.keys(armarEvento(datos))).not.toContain("expiresAt");
  });
  it("con expiresAt: la ÚLTIMA llave, en ISO", () => {
    const e = armarEvento({ ...datos, expiresAt: new Date("2026-11-18T10:10:00Z") });
    const llaves = Object.keys(e);
    expect(llaves[llaves.length - 1]).toBe("expiresAt");
    expect(e.expiresAt).toBe("2026-11-18T10:10:00.000Z");
  });
});

describe("conversation.deleted va al cerebro de ESA organización", () => {
  it("en `multi`, firmado con el secreto del despliegue asignado", async () => {
    vi.stubEnv("TENANCY", "multi");
    fake().responder(schema.organization, [asignacion()]);
    fake().responder(schema.brainDeployment, [secretoEnBase()]);
    const llamadas: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const evento = construirEventoOlvido({
      eventId: "olv_1",
      organization: { id: "org_A", slug: "clinica" },
      conversation: { id: "cv_1", channel: "whatsapp" },
      contact: { id: "ct_1", identity: "573001112233" },
      deletedAt: new Date("2026-11-18T10:00:00Z"),
    });
    expect(await avisarOlvido(evento, { fetchImpl })).toBe("avisado");
    expect(llamadas[0]!.url).toBe("http://nea:8000/vocero/dispatch");
    const cab = llamadas[0]!.init.headers as Record<string, string>;
    expect(cab["x-vocero-signature"]).toBe(firmarCuerpo(JSON.stringify(evento), SECRETO));
    expect(cab["x-vocero-organization"]).toBe("clinica");
  });

  it("en `multi` sin cerebro asignado: no hay a quién avisar", async () => {
    vi.stubEnv("TENANCY", "multi");
    fake().responder(schema.organization, [asignacion({ deploymentId: null, status: null, dispatchUrl: null })]);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const evento = construirEventoOlvido({
      eventId: "olv_2",
      organization: { id: "org_A", slug: "clinica" },
      conversation: { id: "cv_1", channel: "whatsapp" },
      contact: { id: "ct_1", identity: "x" },
      deletedAt: new Date(),
    });
    expect(await avisarOlvido(evento, { fetchImpl })).toBe("no_aplica");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("encender el agente en `multi` (D11)", () => {
  const sano = async () => ({ reachable: true });
  const caido = async () => ({ reachable: false });

  it("exige cerebro asignado, activo, negocio activo y /health que conteste", async () => {
    const casos: [Record<string, unknown> | null, (u: string) => Promise<{ reachable: boolean }>, string | null][] = [
      [asignacion({ deploymentId: null }), sano, "sin_asignar"],
      [asignacion({ status: "pausado" }), sano, "pausado"],
      [asignacion({ orgStatus: "suspendida" }), sano, "suspendida"],
      [asignacion(), caido, "caido"],
      [asignacion(), sano, null],
    ];
    for (const [fila, salud, esperado] of casos) {
      fake().reiniciar();
      fake().responder(schema.organization, fila ? [fila] : []);
      const p = await problemaDeCerebroEnPlataforma("org_A", salud);
      expect(p?.problema ?? null).toBe(esperado);
    }
  });

  it("pregunta al /health del despliegue, y el mensaje al dueño no lleva URLs", async () => {
    fake().responder(schema.organization, [asignacion()]);
    const urls: string[] = [];
    const p = await problemaDeCerebroEnPlataforma("org_A", async (u) => {
      urls.push(u);
      return { reachable: false };
    });
    expect(urls).toEqual(["http://nea:8000/health"]);
    const texto = mensajeProblemaPlataforma(p!);
    expect(texto).toContain("Nea Producción");
    expect(texto).not.toMatch(/https?:|nea:8000/);
  });
});

/* -------------------------------------------- cableado (guardia estática) */

function fuente(ruta: string): string {
  return readFileSync(join(process.cwd(), ruta), "utf8");
}

describe("el cableado de F5", () => {
  it("la ingesta pregunta por el cerebro del NEGOCIO en `multi`", () => {
    expect(fuente("src/server/inbox/ingest.ts")).toMatch(/esPlataforma\(\) \? await despachoActivoPara\(organizationId\)/);
  });
  it("el worker resuelve el destino por fila, anota el despliegue y pone expiresAt en `multi`", () => {
    const w = fuente("src/server/dispatch/worker.ts");
    expect(w).toMatch(/await destinoDe\(fila\.organizationId\)/);
    expect(w).toMatch(/brainDeploymentId: config\.deploymentId/);
    expect(w).toMatch(/esPlataforma\(\) \? \{ expiresAt/);
    expect(w).not.toMatch(/leerConfigDespacho/);
  });
  it("el interruptor, el Laboratorio y el arranque conocen el modo plataforma", () => {
    expect(fuente("src/app/api/agent/profile/route.ts")).toMatch(/problemaDeCerebroEnPlataforma\(organizationId/);
    expect(fuente("src/app/api/lab/runs/route.ts")).toMatch(/despachoActivoPara\(organizationId\)/);
    expect(fuente("src/instrumentation-node.ts")).toMatch(/if \(esPlataforma\(\)\) \{\s*iniciarWorker\(\)/);
  });
});
