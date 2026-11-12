import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 073 (D13 de Aliantis; contrato 067, `bot-api-v2.md` §1) — `/api/bot/*` por
 * negocio: las seis reglas del contrato, la credencial derivada con el vector
 * gemelo del cerebro, el presupuesto y «quién responde» por negocio.
 */
const h = vi.hoisted(() => ({ organizaciones: ["org_a", "org_b"] as string[] }));
vi.mock("@/server/bot/organizaciones", () => ({
  hastaDosOrganizaciones: async () => h.organizaciones.slice(0, 2),
  organizacionExiste: async (id: string) => h.organizaciones.includes(id),
}));

import { resetRateLimit } from "@/lib/rate-limit";
import { BOT_API_BUDGET, requireBot, resetAvisoLlaveCruda } from "@/server/bot/auth";
import { botLastSeenAt, resetBrainStatusState } from "@/server/bot/status";
import { credencialDerivada } from "@/server/brains/credencial";

const KEY = "clave-de-servicio-larga-0123456789abcdef";
const cred = (org: string) => credencialDerivada(KEY, org);

function peticion(cabeceras: Record<string, string>): Request {
  return new Request("http://localhost/api/bot/context", { headers: cabeceras });
}
async function resultado(cabeceras: Record<string, string>) {
  const r = await requireBot(peticion(cabeceras));
  return r instanceof Response
    ? { status: r.status, code: ((await r.json()) as { error?: { code?: string } }).error?.code }
    : { status: 200, org: r.organizationId };
}

beforeEach(() => {
  vi.stubEnv("BOT_API_KEY", KEY);
  h.organizaciones = ["org_a", "org_b"];
  resetRateLimit();
  resetBrainStatusState();
  resetAvisoLlaveCruda();
});
afterEach(() => vi.unstubAllEnvs());

describe("073 — credencial derivada", () => {
  it("coincide con el vector gemelo del cerebro y de Nea", () => {
    expect(
      credencialDerivada("un-secreto-de-despliegue-largo-y-aburrido", "org_abc123")
    ).toBe("_BqRKryMUdexcuLj_3RG1ARbgqr_LhXRSLJYmrw5VJ0");
  });

  it("es HMAC-SHA256 de «vocero:cerebro:v1:<org>» en base64url sin relleno", () => {
    const replica = createHmac("sha256", KEY)
      .update("vocero:cerebro:v1:org_a")
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(cred("org_a")).toBe(replica);
    expect(cred("org_a")).not.toBe(cred("org_b"));
  });
});

describe("073 — las seis reglas del contrato", () => {
  it("1. cabecera + su credencial → ese negocio", async () => {
    expect(
      await resultado({ "x-vocero-organization": "org_b", "x-api-key": cred("org_b") })
    ).toEqual({ status: 200, org: "org_b" });
    // También como Bearer (lo que manda un SDK compatible con OpenAI).
    expect(
      await resultado({
        "x-vocero-organization": "org_a",
        authorization: `Bearer ${cred("org_a")}`,
      })
    ).toEqual({ status: 200, org: "org_a" });
  });

  it("2. cabecera + la credencial de otro negocio, o la llave cruda → 401", async () => {
    expect(
      await resultado({ "x-vocero-organization": "org_b", "x-api-key": cred("org_a") })
    ).toMatchObject({ status: 401 });
    expect(
      await resultado({ "x-vocero-organization": "org_b", "x-api-key": KEY })
    ).toMatchObject({ status: 401 });
  });

  it("3. cabecera de un negocio que no existe → 401, sin revelar si existe", async () => {
    const r = await resultado({
      "x-vocero-organization": "org_borrado",
      "x-api-key": cred("org_borrado"),
    });
    expect(r).toEqual({ status: 401, code: "unauthorized" });
    // El slug en vez del id tampoco entra.
    expect(
      await resultado({ "x-vocero-organization": "mi-clinica", "x-api-key": cred("mi-clinica") })
    ).toMatchObject({ status: 401 });
  });

  it("4. sin cabecera, llave cruda y UN negocio → ese, con aviso en el registro", async () => {
    h.organizaciones = ["org_a"];
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resultado({ "x-api-key": KEY })).toEqual({ status: 200, org: "org_a" });
    expect(await resultado({ "x-api-key": KEY })).toEqual({ status: 200, org: "org_a" });
    // Un aviso, no uno por petición; y nunca la llave.
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(aviso.mock.calls)).not.toContain(KEY);
    aviso.mockRestore();
  });

  it("5. sin cabecera, llave cruda y DOS o más negocios → 409 organizacion_requerida", async () => {
    expect(await resultado({ "x-api-key": KEY })).toEqual({
      status: 409,
      code: "organizacion_requerida",
    });
  });

  it("6. sin cabecera y sin llave válida → 401", async () => {
    expect(await resultado({})).toMatchObject({ status: 401 });
    expect(await resultado({ "x-api-key": "otra-clave-igual-de-larga-pero-mala!!" })).toMatchObject({
      status: 401,
    });
  });

  it("un segundo negocio apaga la llave cruda al instante (sin caché)", async () => {
    h.organizaciones = ["org_a"];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resultado({ "x-api-key": KEY })).toMatchObject({ status: 200 });
    h.organizaciones = ["org_a", "org_b"];
    expect(await resultado({ "x-api-key": KEY })).toMatchObject({ status: 409 });
  });
});

describe("073 — presupuesto y «quién responde» por negocio", () => {
  it("un negocio que agota su presupuesto no frena al otro", async () => {
    const deA = { "x-vocero-organization": "org_a", "x-api-key": cred("org_a") };
    for (let i = 0; i < BOT_API_BUDGET.max; i++) {
      expect((await resultado(deA)).status).toBe(200);
    }
    expect((await resultado(deA)).status).toBe(429);
    expect(
      (await resultado({ "x-vocero-organization": "org_b", "x-api-key": cred("org_b") })).status
    ).toBe(200);
  });

  it("la huella del cerebro se anota en SU negocio", async () => {
    await resultado({ "x-vocero-organization": "org_a", "x-api-key": cred("org_a") });
    expect(botLastSeenAt("org_a")).not.toBeNull();
    expect(botLastSeenAt("org_b")).toBeNull();
  });
});

describe("073 — guardarraíl: toda ruta de /api/bot/* entra por requireBot", () => {
  const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
  const BOT = path.join(SRC, "app", "api", "bot");
  function rutas(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) out.push(...rutas(full));
      else if (e === "route.ts") out.push(full);
    }
    return out;
  }
  function todos(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) out.push(...todos(full));
      else if (/\.(ts|tsx)$/.test(e)) out.push(full);
    }
    return out;
  }

  it("cada ruta (salvo la del contrato público) llama requireBot", () => {
    // 080 (P7) — El proxy apagado no autentica: responde 404 a todos. La
    // excepción vale solo mientras siga apagado (sin `fetch` ni la llave).
    const apagado = (f: string) => {
      const t = readFileSync(f, "utf8");
      return f.includes(`${path.sep}llm${path.sep}`) && t.includes("proxy_apagado") && !/fetch\(|OPENROUTER|resolveAiProvider/.test(t);
    };
    const sin = rutas(BOT)
      .filter((f) => !f.includes(`${path.sep}openapi.json${path.sep}`))
      .filter((f) => !apagado(f))
      .filter((f) => !readFileSync(f, "utf8").includes("requireBot("))
      .map((f) => path.relative(SRC, f));
    expect(sin).toEqual([]);
    expect(rutas(BOT).length).toBeGreaterThanOrEqual(16);
  });

  it("nadie vuelve a usar «la primera organización»", () => {
    const culpables = todos(SRC)
      .filter((f) => /resolveInstanceOrg|requireBotKey/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(culpables).toEqual([]);
  });
});
