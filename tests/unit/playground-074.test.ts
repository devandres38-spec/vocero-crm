import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 074 (D9, decisión #9) — «Probar mi agente»: la ficha de ensayo, la puerta
 * de solo lectura de `/api/brains/*`, el aislamiento entre organizaciones, el
 * tope diario contado en la base y que nada llegue a la Bandeja.
 */

const SECRETO_AUTH = "b".repeat(40);
const SECRETO_DESPLIEGUE = "s".repeat(43);

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  filasCupo: [] as unknown[],
  cupoConfig: null as null | { setWhere?: unknown },
  session: vi.fn(),
  destino: vi.fn(),
  llm: vi.fn(),
  plataforma: true,
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  const base = h.fake.db;
  const db = {
    ...base,
    // El cupo usa insert … on conflict do update … returning: se simula aquí.
    insert: (tabla: unknown) => ({
      values: (valores: Record<string, unknown>) => {
        h.fake!.escrituras.push({ op: "insert", tabla, valores });
        return {
          onConflictDoUpdate: (cfg: { setWhere?: unknown }) => {
            h.cupoConfig = cfg;
            return { returning: () => Promise.resolve(h.filasCupo) };
          },
        };
      },
    }),
  };
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => db };
});
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), BETTER_AUTH_SECRET: SECRETO_AUTH }),
}));
vi.mock("@/lib/tenancy", async (original) => ({
  ...(await original<typeof import("@/lib/tenancy")>()),
  esPlataforma: () => h.plataforma,
}));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: h.session,
}));
vi.mock("@/server/brains/destino", async (original) => ({
  ...(await original<typeof import("@/server/brains/destino")>()),
  destinoDe: h.destino,
}));
vi.mock("@/server/brains/red", async (original) => ({
  ...(await original<typeof import("@/server/brains/red")>()),
  verificarDestino: async () => null,
}));
vi.mock("@/server/brains/context", async (original) => ({
  ...(await original<typeof import("@/server/brains/context")>()),
  llmDelCerebro: h.llm,
}));
vi.mock("@/server/ajustes-bot", async (original) => ({
  ...(await original<typeof import("@/server/ajustes-bot")>()),
  ajustesDelNegocio: async () => ({
    bot: { limits: {}, temperature: 0.4, fallbackModel: null, playgroundPerDay: 40 },
    horario: null,
    timezone: "America/Bogota",
  }),
}));
vi.mock("@/server/kb", () => ({
  kbParaElCerebro: async () => [
    { kind: "qa", question: "Precio", answer: "120.000", content: null, title: "Limpieza", enabled: true },
  ],
  recursosDe: async () => [{ label: "Maps", url: "https://maps.app.goo.gl/x" }],
}));
vi.mock("@/server/modulos/consulta", async (original) => ({
  ...(await original<typeof import("@/server/modulos/consulta")>()),
  modulosDeOrganizacion: async () => ({ agenda: false, atribucion: false, channels: ["whatsapp"], modules: [] }),
}));
vi.mock("@/server/ficha/esquema", async (original) => ({
  ...(await original<typeof import("@/server/ficha/esquema")>()),
  fichaSchemaDe: async () => null,
}));

import { encryptSecret } from "@/lib/crypto";
import { requireBrain } from "@/server/brains/auth";
import { firmaValida } from "@/server/brains/contract";
import { credencialDerivada, invalidarCacheCerebro } from "@/server/brains/deployment";
import {
  conversacionDeEnsayo,
  firmarFichaEnsayo,
  leerFichaEnsayo,
  rutaPermitidaEnEnsayo,
  VIDA_FICHA_ENSAYO_MS,
} from "@/server/brains/ensayo-ficha";
import { withBrain } from "@/server/brains/http";
import { huecosParaElCerebro } from "@/server/bot/nucleo/agenda";
import { resetRateLimit } from "@/lib/rate-limit";
import { consumirCupoEnsayo, ensayar, urlDeEnsayo } from "@/server/playground";
import { GET, POST } from "@/app/api/agent/playground/route";

const fake = () => h.fake!;
const leer = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

beforeEach(() => {
  fake().reiniciar();
  resetRateLimit();
  invalidarCacheCerebro();
  h.filasCupo = [{ count: 1 }];
  h.cupoConfig = null;
  h.plataforma = true;
  h.session.mockResolvedValue({ userId: "u_1", organizationId: "org_a", role: "owner" });
  h.destino.mockResolvedValue({ url: "https://nea.test/vocero/dispatch", secret: SECRETO_DESPLIEGUE, host: "nea", deploymentId: "brn_1", healthUrl: null });
  h.llm.mockResolvedValue({ path: "/api/brains/llm", model: "z-ai/glm-5.3-flash", transcribeModel: "" });
});

describe("ficha de ensayo (contrato brains-074 §3)", () => {
  it("vale para SU organización y su conversación, y caduca", () => {
    const conv = conversacionDeEnsayo();
    const ficha = firmarFichaEnsayo("org_a", conv, SECRETO_AUTH, 1_000);
    expect(leerFichaEnsayo("org_a", ficha, SECRETO_AUTH, 2_000)).toEqual({ conversationId: conv });
    // Aislamiento multi-org: la ficha de A no abre nada en B.
    expect(leerFichaEnsayo("org_b", ficha, SECRETO_AUTH, 2_000)).toBeNull();
    expect(leerFichaEnsayo("org_a", ficha, SECRETO_AUTH, 1_000 + VIDA_FICHA_ENSAYO_MS + 1)).toBeNull();
    expect(leerFichaEnsayo("org_a", ficha.replace(/.$/, "x"), SECRETO_AUTH, 2_000)).toBeNull();
    expect(leerFichaEnsayo("org_a", "basura", SECRETO_AUTH, 2_000)).toBeNull();
  });

  it("solo pensar y leer huecos", () => {
    expect(rutaPermitidaEnEnsayo("/api/brains/llm/chat/completions", "POST")).toBe(true);
    expect(rutaPermitidaEnEnsayo("/api/brains/agenda/slots", "GET")).toBe(true);
    for (const [ruta, metodo] of [
      ["/api/brains/messages", "POST"],
      ["/api/brains/handoff", "POST"],
      ["/api/brains/ficha", "PUT"],
      ["/api/brains/stage", "POST"],
      ["/api/brains/agenda/book", "POST"],
      ["/api/brains/agenda/cancel", "POST"],
      ["/api/brains/tools/diagnostico_x", "POST"],
      ["/api/brains/context", "GET"],
      ["/api/brains/media/m1", "GET"],
      ["/api/brains/agenda/slots", "POST"],
    ] as const) {
      expect(rutaPermitidaEnEnsayo(ruta, metodo)).toBe(false);
    }
  });
});

function peticionCerebro(url: string, org: string, metodo: string, ficha?: string): Request {
  return new Request(url, {
    method: metodo,
    headers: {
      "x-forwarded-for": "10.9.9.9",
      "x-vocero-organization": org,
      authorization: `Bearer ${credencialDerivada(SECRETO_DESPLIEGUE, org === "a" ? "org_a" : "org_b")}`,
      ...(ficha ? { "x-vocero-ensayo": ficha } : {}),
    },
  });
}

function prepararPuerta(orgId: string, slug: string) {
  const e = encryptSecret(SECRETO_DESPLIEGUE);
  fake().responder(schema.organization, [{ id: orgId, slug, status: "activa", deploymentId: "brn_1" }]);
  fake().responder(schema.brainDeployment, [{ cipher: e.cipher, iv: e.iv, tag: e.tag, status: "activo", updatedAt: new Date("2026-11-18T00:00:00Z") }]);
}

describe("puerta de /api/brains/* con ficha de ensayo", () => {
  it("ficha buena → ámbito con ensayo; ficha de OTRA organización → 401", async () => {
    vi.stubEnv("TENANCY", "multi");
    const conv = conversacionDeEnsayo();
    prepararPuerta("org_a", "a");
    const ok = await requireBrain(peticionCerebro("http://p.test/api/brains/llm/chat/completions", "a", "POST", firmarFichaEnsayo("org_a", conv)));
    expect(ok).toMatchObject({ ok: true, ambito: { organizationId: "org_a", ensayo: { conversationId: conv } } });

    invalidarCacheCerebro();
    prepararPuerta("org_b", "b");
    const cruzada = await requireBrain(peticionCerebro("http://p.test/api/brains/llm/chat/completions", "b", "POST", firmarFichaEnsayo("org_a", conv)));
    expect(cruzada.ok).toBe(false);
    if (!cruzada.ok) expect(cruzada.response.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("con ficha, una ruta de escritura es 403 y el manejador no corre", async () => {
    vi.stubEnv("TENANCY", "multi");
    const manejador = vi.fn(async () => new Response("escribí"));
    const ruta = withBrain(manejador);
    prepararPuerta("org_a", "a");
    const res = await ruta(peticionCerebro("http://p.test/api/brains/messages", "a", "POST", firmarFichaEnsayo("org_a", conversacionDeEnsayo())));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ensayo_solo_lectura");
    expect(manejador).not.toHaveBeenCalled();

    invalidarCacheCerebro();
    prepararPuerta("org_a", "a");
    const pensar = await ruta(peticionCerebro("http://p.test/api/brains/llm/chat/completions", "a", "POST", firmarFichaEnsayo("org_a", conversacionDeEnsayo())));
    expect(pensar.status).toBe(200);
    expect(manejador).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("huecos con ficha: solo su conversación, y sin registrar oferta", async () => {
    const r = await huecosParaElCerebro(
      new Request("http://p.test/api/brains/agenda/slots?conversationId=cv_real_de_otro"),
      "org_a",
      { ensayo: { conversationId: "cv_ensayo_x" } }
    );
    expect(r.status).toBe(403);
    const fuente = leer("src", "server", "bot", "nucleo", "agenda.ts");
    expect(fuente).toMatch(/if \(!ensayo && \(!date \|\| slots\.length > 0\)\)/);
    expect(leer("src", "app", "api", "brains", "llm", "[...ruta]", "route.ts")).toMatch(/ambito\.ensayo \? \{ fuente: "ensayo" as const \}/);
  });
});

describe("cupo diario en la base (FR-12)", () => {
  it("incremento condicionado: `count < tope` en el on conflict", async () => {
    h.filasCupo = [{ count: 7 }];
    expect(await consumirCupoEnsayo("org_a", "2026-11-20", 40)).toBe(7);
    const q = new PgDialect().sqlToQuery(h.cupoConfig!.setWhere as SQL);
    expect(q.sql).toMatch(/"count" < \$1/);
    expect(q.params).toEqual([40]);
  });

  it("en el tope la base no devuelve fila → null (sin Map en memoria)", async () => {
    h.filasCupo = [];
    expect(await consumirCupoEnsayo("org_a", "2026-11-20", 40)).toBeNull();
    expect(leer("src", "server", "playground.ts")).not.toMatch(/new Map/);
  });
});

describe("ensayar()", () => {
  it("manda el ensayo firmado a /vocero/ensayo con la config real y nada toca la Bandeja", async () => {
    let capturado: { url: string; init: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturado = { url: String(url), init: init! };
      return new Response(
        JSON.stringify({ ok: true, simulated: true, turns: [{ customer: "hola", replies: ["¡Hola! ¿En qué te ayudo?"], actions: [] }] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    fake().responder(schema.agentProfile, [
      { id: "ap", organizationId: "org_a", enabled: true, name: "Sofi", tone: null, instructions: null, escalationRules: null, greeting: null, role: "calificador", tools: null, treatment: "tu", stallEnabled: true, resources: [] },
    ]);
    const r = await ensayar({ organizationId: "org_a", slug: "a", message: "hola", history: [{ role: "customer", text: "antes" }], fetchImpl, ahora: new Date("2026-11-20T15:00:00Z") });
    expect(r).toMatchObject({ ok: true, usados: 1, tope: 40, turn: { replies: ["¡Hola! ¿En qué te ayudo?"] } });
    expect(capturado!.url).toBe("https://nea.test/vocero/ensayo");
    const cuerpo = String(capturado!.init.body);
    const cab = capturado!.init.headers as Record<string, string>;
    expect(firmaValida(cuerpo, SECRETO_DESPLIEGUE, cab["x-vocero-signature"]!)).toBe(true);
    const evento = JSON.parse(cuerpo) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(evento.type).toBe("rehearsal");
    expect(evento.organization).toEqual({ id: "org_a", slug: "a" });
    expect(evento.turns).toEqual(["hola"]);
    expect(evento.history).toEqual([{ role: "customer", text: "antes" }]);
    expect(evento.context.conversation.id).toMatch(/^cv_ensayo_/);
    expect(evento.context.contact.identity).toMatch(/^ensayo:/);
    expect(leerFichaEnsayo("org_a", evento.rehearsal.token, SECRETO_AUTH, new Date("2026-11-20T15:01:00Z").getTime())).toEqual({
      conversationId: evento.context.conversation.id,
    });
    expect(evento.context.knowledge).toEqual([{ kind: "qa", question: "Precio", answer: "120.000", title: "Limpieza" }]);
    expect(evento.context.resources).toEqual([{ label: "Maps", url: "https://maps.app.goo.gl/x" }]);
    expect(evento.context.llm).toMatchObject({ model: "z-ai/glm-5.3-flash", temperature: 0.4 });
    // Lo único que se escribe es el cupo: ni conversación, ni contacto, ni mensaje.
    const tablas = new Set(fake().escrituras.map((w) => w.tabla));
    expect([...tablas]).toEqual([schema.agentPlaygroundDay]);
    expect(fake().escrituras[0]!.valores).toMatchObject({ organizationId: "org_a", day: "2026-11-20" });
  });

  it("en el tope: 429 tope_ensayos y el cerebro no se llama", async () => {
    h.filasCupo = [];
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await ensayar({ organizationId: "org_a", slug: "a", message: "hola", history: [], fetchImpl });
    expect(r).toMatchObject({ ok: false, status: 429, code: "tope_ensayos", tope: 40 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("si el cerebro falla, el cupo se devuelve", async () => {
    const fetchImpl = vi.fn(async () => new Response("caído", { status: 500 })) as unknown as typeof fetch;
    fake().responder(schema.agentProfile, []);
    const r = await ensayar({ organizationId: "org_a", slug: "a", message: "hola", history: [], fetchImpl });
    expect(r).toMatchObject({ ok: false, code: "cerebro_no_disponible" });
    const devoluciones = fake().de(schema.agentPlaygroundDay, "update");
    expect(devoluciones).toHaveLength(1);
  });

  it("sin llave del negocio no se gasta cupo; fuera de plataforma no existe", async () => {
    h.llm.mockResolvedValue(null);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await ensayar({ organizationId: "org_a", slug: "a", message: "hola", history: [], fetchImpl })).toMatchObject({
      ok: false,
      status: 402,
      code: "sin_credencial",
    });
    h.plataforma = false;
    expect(await ensayar({ organizationId: "org_a", slug: "a", message: "hola", history: [], fetchImpl })).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(fake().escrituras).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("la URL del ensayo sale de la de despacho", () => {
    expect(urlDeEnsayo("https://nea.test/vocero/dispatch")).toBe("https://nea.test/vocero/ensayo");
    expect(urlDeEnsayo("https://nea.test/base/vocero/dispatch/?x=1")).toBe("https://nea.test/base/vocero/ensayo");
    expect(urlDeEnsayo("https://nea.test/otra-cosa")).toBeNull();
    expect(urlDeEnsayo("ftp://nea.test/vocero/dispatch")).toBeNull();
  });
});

describe("POST /api/agent/playground", () => {
  const pedir = (body: unknown) =>
    POST(new Request("http://x/api/agent/playground", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("un miembro del equipo o un acceso de soporte reciben 403 sin gastar cupo", async () => {
    for (const role of ["member", "soporte"]) {
      h.session.mockResolvedValue({ userId: "u_2", organizationId: "org_a", role, via: role === "soporte" ? "soporte" : "miembro", grant: { level: "configuracion" } });
      expect((await pedir({ message: "hola" })).status).toBe(403);
    }
    // (El acceso de soporte deja su rastro de auditoría; el cupo no se toca.)
    expect(fake().de(schema.agentPlaygroundDay)).toHaveLength(0);
  });

  it("el negocio sale de la sesión: un `organizationId` en el cuerpo es 422", async () => {
    expect((await pedir({ message: "hola", organizationId: "org_b" })).status).toBe(422);
    expect((await pedir({ message: "" })).status).toBe(422);
    expect((await pedir({ message: "x", history: Array.from({ length: 41 }, () => ({ role: "customer", text: "a" })) })).status).toBe(422);
  });

  it("GET dice cuántas pruebas quedan hoy", async () => {
    fake().responder(schema.agentPlaygroundDay, [{ count: 12 }]);
    const res = await GET();
    expect(await res.json()).toMatchObject({ available: true, used: 12, limit: 40, remaining: 28 });
  });
});
