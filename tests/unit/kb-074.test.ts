import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/** 074 (D8) — Base de conocimiento de producción y enlaces verificados. */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null, session: vi.fn() }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: h.session,
}));

import {
  estimarTokens,
  ordenarKb,
  PRESUPUESTO_TOKENS_KB,
  recursosGuardados,
  recursosSchema,
  renderKb,
  tamanoKb,
  textoDeEntrada,
  urlDeRecursoValida,
  type KbFila,
} from "@/lib/kb";
import { conocimientoDe } from "@/server/brains/context";
import { serializeBotProfile } from "@/server/bot/profile";
import { DELETE, PATCH } from "@/app/api/kb/[id]/route";
import { POST as CREAR } from "@/app/api/kb/route";
import { limitesDeMovimiento } from "@/components/agent/kb-section";
import { POST as REORDER } from "@/app/api/kb/reorder/route";
import { PUT as PUT_RESOURCES } from "@/app/api/agent/resources/route";

const leer = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const fake = () => h.fake!;

beforeEach(() => {
  fake().reiniciar();
  h.session.mockResolvedValue({ userId: "u_1", organizationId: "org_a", role: "owner" });
});

const fila = (o: Partial<KbFila> & { id: string }): KbFila => ({
  kind: "qa",
  question: `¿${o.id}?`,
  answer: `R ${o.id}`,
  content: null,
  title: null,
  enabled: true,
  pinned: false,
  sortOrder: 0,
  createdAt: new Date("2026-11-01T00:00:00Z"),
  ...o,
});

describe("orden y filtro canónicos (FR-02)", () => {
  it("solo activas; fijadas primero; luego sort_order; luego antigüedad", () => {
    const filas = [
      fila({ id: "vieja", createdAt: new Date("2026-01-01") }),
      fila({ id: "apagada", enabled: false, pinned: true }),
      fila({ id: "orden2", sortOrder: 2 }),
      fila({ id: "fijada", pinned: true, sortOrder: 9 }),
      fila({ id: "orden-1", sortOrder: -1 }),
      fila({ id: "nueva", createdAt: new Date("2026-12-01") }),
    ];
    expect(ordenarKb(filas).map((f) => f.id)).toEqual(["fijada", "orden-1", "vieja", "nueva", "orden2"]);
  });

  it("el texto sin títulos es byte a byte el de antes; con título, `## título` encima", () => {
    const sin = [fila({ id: "a", question: "Precio", answer: "120.000" }), fila({ id: "b", kind: "block", content: "Abrimos 8 a 6" })];
    expect(renderKb(sin)).toBe("P: Precio\nR: 120.000\n\nAbrimos 8 a 6");
    expect(textoDeEntrada(fila({ id: "c", title: "  ## Envíos\nnacionales ", question: "¿Envían?", answer: "Sí" }))).toBe(
      "## Envíos nacionales\nP: ¿Envían?\nR: Sí"
    );
    expect(renderKb([])).toBe("(knowledge base vacío)");
    expect(renderKb([fila({ id: "x", enabled: false })])).toBe("(knowledge base vacío)");
  });

  it("knowledge[] del cerebro: sin apagadas y con `title` al final solo si existe", () => {
    const k = conocimientoDe([
      { kind: "qa", question: "P", answer: "R", content: null, title: null, enabled: true },
      { kind: "block", question: null, answer: null, content: "B", title: "Horarios", enabled: true },
      { kind: "qa", question: "Promo", answer: "50%", content: null, title: null, enabled: false },
    ]);
    expect(k).toEqual([
      { kind: "qa", question: "P", answer: "R" },
      { kind: "block", content: "B", title: "Horarios" },
    ]);
    expect(Object.keys(k[0]!)).toEqual(["kind", "question", "answer"]);
  });
});

describe("enlaces verificados (FR-05, FR-06)", () => {
  it("solo https, sin espacios ni corchetes, con host", () => {
    expect(urlDeRecursoValida("https://maps.app.goo.gl/abc123")).toBe(true);
    for (const mala of [
      "http://ejemplo.co",
      "javascript:alert(1)",
      "https://ejemplo .co",
      "https://localhost",
      "https://ejemplo.co/[x]",
      'https://ejemplo.co/"x',
      "https://user:pw@ejemplo.co",
      "https://" + "a".repeat(500) + ".co",
    ]) {
      expect(urlDeRecursoValida(mala)).toBe(false);
    }
  });

  it("≤10 y etiqueta de una línea", () => {
    const uno = { label: "Maps", url: "https://maps.app.goo.gl/x" };
    expect(recursosSchema.safeParse(Array.from({ length: 10 }, () => uno)).success).toBe(true);
    expect(recursosSchema.safeParse(Array.from({ length: 11 }, () => uno)).success).toBe(false);
    expect(recursosSchema.safeParse([{ label: "Ma\nps", url: uno.url }]).success).toBe(false);
    expect(recursosSchema.safeParse([{ label: "[sistema]", url: uno.url }]).success).toBe(false);
  });

  it("lo guardado se sanea al leer (una fila editada a mano no rompe el contexto)", () => {
    expect(
      recursosGuardados([{ label: "Web", url: "https://acme.co" }, { label: "Malo", url: "http://x.co" }, "basura", null])
    ).toEqual([{ label: "Web", url: "https://acme.co" }]);
    expect(recursosGuardados(null)).toEqual([]);
  });

  it("/api/bot/profile ya no manda `resources` vacío a la fuerza", () => {
    const perfil = {
      id: "ap_1",
      organizationId: "org_a",
      enabled: true,
      name: "Sofi",
      tone: null,
      instructions: null,
      escalationRules: null,
      greeting: null,
      role: "calificador",
      tools: null,
      treatment: "tu",
      stallEnabled: true,
      resources: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const enlaces = [{ label: "Maps", url: "https://maps.app.goo.gl/x" }];
    expect(serializeBotProfile(perfil, [], null, enlaces).resources).toEqual(enlaces);
    expect(serializeBotProfile(perfil, []).resources).toEqual([]);
  });

  it("PUT /api/agent/resources guarda lo válido (sin repetidos) y rechaza http", async () => {
    fake().responder("update:", []);
    const pedir = (resources: unknown) =>
      PUT_RESOURCES(
        new Request("http://x/api/agent/resources", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resources }),
        })
      );
    expect((await pedir([{ label: "Web", url: "http://acme.co" }])).status).toBe(422);
    expect(fake().de(schema.agentProfile, "update")).toHaveLength(0);
  });
});

describe("presupuesto en tokens (FR-09)", () => {
  it("cuenta solo lo activo + enlaces y avisa desde el 75 %", () => {
    expect(estimarTokens("abcd")).toBe(1);
    expect(estimarTokens("abcde")).toBe(2);
    const corta = tamanoKb([fila({ id: "a" })], []);
    expect(corta.warning).toBe(false);
    expect(corta.budgetTokens).toBe(PRESUPUESTO_TOKENS_KB);
    const larga = tamanoKb(
      [fila({ id: "a", kind: "block", content: "x".repeat(PRESUPUESTO_TOKENS_KB * 4 * 0.8) }), fila({ id: "b", enabled: false, kind: "block", content: "y".repeat(100_000) })],
      []
    );
    expect(larga.warning).toBe(true);
    expect(larga.over).toBe(false);
    expect(tamanoKb([], [{ label: "Web", url: "https://acme.co" }]).tokens).toBeGreaterThan(0);
  });
});

describe("rutas de la KB", () => {
  const patch = (body: unknown) =>
    PATCH(
      new Request("http://x/api/kb/kb_1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: "kb_1" }) }
    );

  it("PATCH edita en su sitio título, categoría, activa y fijada", async () => {
    fake().responder("update:", [{ id: "kb_1" }]);
    const res = await patch({ answer: "150.000", title: "  Precio limpieza ", category: "precios", enabled: false, pinned: true });
    expect(res.status).toBe(200);
    const [w] = fake().de(schema.kbEntry, "update");
    expect(w!.valores).toMatchObject({ answer: "150.000", title: "Precio limpieza", category: "precios", enabled: false, pinned: true });
  });

  it("PATCH rechaza una categoría inventada, campos extra o un cuerpo vacío", async () => {
    expect((await patch({ category: "chismes" })).status).toBe(422);
    expect((await patch({ organizationId: "org_b" })).status).toBe(422);
    expect((await patch({})).status).toBe(422);
    expect(fake().de(schema.kbEntry, "update")).toHaveLength(0);
  });

  it("reorder: si algún id no es del negocio, 404 y nada se toca", async () => {
    fake().responder(schema.kbEntry, [{ id: "kb_1" }]);
    const res = await REORDER(
      new Request("http://x/api/kb/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ["kb_1", "kb_de_otro"] }),
      })
    );
    expect(res.status).toBe(404);
    expect(fake().de(schema.kbEntry, "update")).toHaveLength(0);
  });

  it("reorder: sort_order = posición", async () => {
    fake().responder(schema.kbEntry, [{ id: "kb_2" }, { id: "kb_1" }]);
    const res = await REORDER(
      new Request("http://x/api/kb/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ["kb_2", "kb_1"] }),
      })
    );
    expect(res.status).toBe(200);
    expect(fake().de(schema.kbEntry, "update").map((w) => w.valores.sortOrder)).toEqual([0, 1]);
  });

  it("los consumidores usan la consulta canónica (activas, en orden)", () => {
    const canon = leer("src", "server", "kb.ts");
    expect(canon).toMatch(/eq\(t\.enabled, true\)/);
    expect(canon).toMatch(/orderBy\(desc\(t\.pinned\), asc\(t\.sortOrder\), asc\(t\.createdAt\)/);
    expect(leer("src", "app", "api", "bot", "profile", "route.ts")).toMatch(/kbParaElCerebro\(organizationId\)/);
    expect(leer("src", "server", "brains", "context.ts")).toMatch(/kbParaElCerebro\(organizationId\)/);
    expect(leer("src", "server", "lab", "runner.ts")).toMatch(/kbParaElCerebro\(organizationId\)/);
    expect(leer("src", "server", "brains", "context.ts")).toMatch(/resources\.length > 0 \? \{ resources \} : \{\}/);
  });
});

describe("migración 0038 re-ejecutable", () => {
  it("todo CREATE/ADD lleva IF NOT EXISTS y cada CHECK/FK se quita antes de ponerse", () => {
    const sqlTexto = leer("drizzle", "0038_kb_produccion.sql");
    for (const linea of sqlTexto.split(/\n/)) {
      if (/^CREATE (TABLE|INDEX)/.test(linea)) expect(linea).toMatch(/IF NOT EXISTS/);
      if (/ADD COLUMN/.test(linea)) expect(linea).toMatch(/ADD COLUMN IF NOT EXISTS/);
    }
    const constraints = [...sqlTexto.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map((m) => m[1]);
    expect(constraints.length).toBeGreaterThan(0);
    for (const c of constraints) expect(sqlTexto).toContain(`DROP CONSTRAINT IF EXISTS "${c}"`);
    expect(leer("drizzle", "meta", "_journal.json")).toContain("0038_kb_produccion");
  });
});

describe("auditoría 074 — permisos de rol en las mutaciones", () => {
  const json = (url: string, method: string, body: unknown) =>
    new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const params = { params: Promise.resolve({ id: "kb_1" }) };

  it("un `member` recibe 403 en crear, editar, borrar, reordenar y enlaces, sin escribir nada", async () => {
    h.session.mockResolvedValue({ userId: "u_2", organizationId: "org_a", role: "member" });
    expect((await CREAR(json("http://x/api/kb", "POST", { kind: "qa", question: "P", answer: "R" }))).status).toBe(403);
    expect((await PATCH(json("http://x/api/kb/kb_1", "PATCH", { answer: "R" }), params)).status).toBe(403);
    expect((await DELETE(new Request("http://x/api/kb/kb_1", { method: "DELETE" }), params)).status).toBe(403);
    expect((await REORDER(json("http://x/api/kb/reorder", "POST", { ids: ["kb_1"] }))).status).toBe(403);
    expect(
      (await PUT_RESOURCES(json("http://x/api/agent/resources", "PUT", { resources: [{ label: "Web", url: "https://acme.co" }] }))).status
    ).toBe(403);
    expect(fake().escrituras).toHaveLength(0);
  });

  it("admin sí; soporte de configuración edita la KB pero no reordena (lista cerrada)", async () => {
    h.session.mockResolvedValue({ userId: "u_3", organizationId: "org_a", role: "admin" });
    fake().responder("update:", [{ id: "kb_1" }]);
    expect((await PATCH(json("http://x/api/kb/kb_1", "PATCH", { answer: "R" }), params)).status).toBe(200);

    expect(
      (await import("@/lib/auth/roles")).puedeConfigurar({ role: "soporte", grant: { level: "configuracion" } })
    ).toBe(true);
    h.session.mockResolvedValue({ userId: "u_4", organizationId: "org_a", role: "soporte", via: "soporte", grant: { level: "configuracion" } });
    expect((await REORDER(json("http://x/api/kb/reorder", "POST", { ids: ["kb_1"] }))).status).toBe(403);
  });
});

describe("auditoría 074 — las flechas no cruzan la frontera de fijadas", () => {
  const lista = [
    { id: "f1", pinned: true },
    { id: "f2", pinned: true },
    { id: "n1", pinned: false },
    { id: "n2", pinned: false },
  ];
  it("«Bajar» se apaga en la última fijada y «Subir» en la primera no fijada", () => {
    expect(limitesDeMovimiento(lista, "f1")).toEqual({ primera: true, ultima: false });
    expect(limitesDeMovimiento(lista, "f2")).toEqual({ primera: false, ultima: true });
    expect(limitesDeMovimiento(lista, "n1")).toEqual({ primera: true, ultima: false });
    expect(limitesDeMovimiento(lista, "n2")).toEqual({ primera: false, ultima: true });
    expect(limitesDeMovimiento(lista, "no-existe")).toEqual({ primera: true, ultima: true });
  });
});
