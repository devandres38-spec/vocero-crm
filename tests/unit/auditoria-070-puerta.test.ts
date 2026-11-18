import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * Auditoría 070 (AUDITORIA-070.md) — Regresión de la puerta y la
 * infraestructura: C-1, A-1, A-2, A-3, A-5, A-11, A-12, M-1, M-2, M-3, B-1,
 * B-7. Cada `describe` nombra el hallazgo que fija.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null, credencial: vi.fn() }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), BETTER_AUTH_SECRET: "b".repeat(40) }),
}));
vi.mock("@/server/ai/credentials", async (original) => ({
  ...(await original<typeof import("@/server/ai/credentials")>()),
  getAiCredentialPublic: h.credencial,
}));

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  checkRateLimit,
  clientIp,
  llaveFalloCerebro,
  llaveFalloPlataforma,
  MAX_KEYS,
  rateLimitExcedido,
  rateLimitKeys,
  resetRateLimit,
  saltosDeProxy,
  TOKEN_FALLIDO_RATE_LIMIT,
} from "@/lib/rate-limit";
import { requireBrain } from "@/server/brains/auth";
import {
  borrarDespliegue,
  credencialDerivada,
  esViolacionFk,
  invalidarCacheCerebro,
  revisarUrlDespacho,
  revisarUrlSalud,
  secretoDeDespliegue,
  urlDeCerebro,
} from "@/server/brains/deployment";
import { hostBloqueado, ipBloqueada, verificarDestino } from "@/server/brains/red";
import { estadoIaDe } from "@/lib/ai/provider";
import { armarVista } from "@/server/ai/settings";
import { getBrainHealth, resetBrainStatusState } from "@/server/bot/status";
import { destinoVisible, etiquetaVersion, secretoPegadoValido } from "@/components/plataforma/gestor-cerebros";

const fake = () => h.fake!;
const SECRETO = "s".repeat(43);

beforeEach(() => {
  fake().reiniciar();
  resetRateLimit();
  invalidarCacheCerebro();
  vi.unstubAllEnvs();
  h.credencial.mockReset();
});

function secretoEnBase(secreto = SECRETO, extra: Record<string, unknown> = {}) {
  const e = encryptSecret(secreto);
  return { cipher: e.cipher, iv: e.iv, tag: e.tag, status: "activo", updatedAt: new Date("2026-11-18T00:00:00Z"), ...extra };
}

function peticion(org: string, credencial: string | null, ip = "10.1.1.1"): Request {
  return new Request("http://plataforma.test/api/brains/context?conversationId=cv_1", {
    headers: {
      "x-forwarded-for": ip,
      "x-vocero-organization": org,
      ...(credencial ? { authorization: `Bearer ${credencial}` } : {}),
    },
  });
}

/* ------------------------------------------------------------------ C-1 */

describe("C-1 — un negocio rechazado no tumba a los demás de la misma Nea", () => {
  it("20 rechazos de la org A desde la IP de Nea → 429 para A, pero B (misma IP) sigue entrando", async () => {
    vi.stubEnv("TENANCY", "multi");
    for (let i = 0; i < 20; i++) {
      fake().responder(schema.organization, [{ id: "org_A", slug: "a", status: "activa", deploymentId: "brn_1" }]);
      fake().responder(schema.brainDeployment, [secretoEnBase("x".repeat(43))]);
      const r = await requireBrain(peticion("a", "credencial-vieja-de-a"));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(401);
    }
    const a = await requireBrain(peticion("a", "credencial-vieja-de-a"));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.response.status).toBe(429);

    invalidarCacheCerebro();
    fake().reiniciar();
    fake().responder(schema.organization, [{ id: "org_B", slug: "b", status: "activa", deploymentId: "brn_1" }]);
    fake().responder(schema.brainDeployment, [secretoEnBase()]);
    const b = await requireBrain(peticion("b", credencialDerivada(SECRETO, "org_B")));
    expect(b).toMatchObject({ ok: true, ambito: { organizationId: "org_B" } });
  });

  it("los fallos de cerebro y de tokens alp_ van en llaves distintas (A-1)", () => {
    expect(llaveFalloCerebro("1.2.3.4", "a")).not.toBe(llaveFalloPlataforma("1.2.3.4"));
    for (let i = 0; i < 20; i++) checkRateLimit(llaveFalloCerebro("1.2.3.4", "a"), TOKEN_FALLIDO_RATE_LIMIT);
    expect(rateLimitExcedido(llaveFalloPlataforma("1.2.3.4"), TOKEN_FALLIDO_RATE_LIMIT)).toBe(false);
  });
});

/* ------------------------------------------------------------------ A-1 */

describe("A-1 — la IP real y un mapa acotado", () => {
  const cab = (xff: string) => new Headers({ "x-forwarded-for": xff });

  it("se lee desde la DERECHA: lo de la izquierda lo escribe el cliente", () => {
    expect(clientIp(cab("6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientIp(cab("1.1.1.1, 6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientIp(cab("203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
    // Más saltos que entradas: la primera (la más lejana).
    expect(clientIp(cab("203.0.113.9"), 3)).toBe("203.0.113.9");
  });

  it("TRUSTED_PROXY_HOPS por defecto 1; 0 ignora x-forwarded-for", () => {
    expect(saltosDeProxy({})).toBe(1);
    expect(saltosDeProxy({ TRUSTED_PROXY_HOPS: "2" })).toBe(2);
    expect(saltosDeProxy({ TRUSTED_PROXY_HOPS: "basura" })).toBe(1);
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "9.9.9.9" }), 0)).toBe("9.9.9.9");
  });

  it("falsear x-forwarded-for ya no evade el límite", () => {
    let ultimo = true;
    for (let i = 0; i < 25; i++) {
      const ip = clientIp(cab(`10.0.${i}.1, 203.0.113.9`), 1);
      ultimo = checkRateLimit(`prueba:${ip}`, { windowMs: 60_000, max: 20 }).allowed;
    }
    expect(ultimo).toBe(false);
  });

  it("tope duro de llaves: rotar IPs no hace crecer el mapa sin límite", () => {
    for (let i = 0; i < MAX_KEYS + 50; i++) checkRateLimit(`flood:${i}`, { windowMs: 600_000, max: 5 });
    expect(rateLimitKeys()).toBeLessThanOrEqual(MAX_KEYS);
  });
});

/* ------------------------------------------------------------- A-2 / A-3 */

describe("A-2 — SSRF: hosts y rangos prohibidos", () => {
  it.each([
    "127.0.0.1",
    "127.9.9.9",
    "0.0.0.0",
    "169.254.169.254",
    "224.0.0.1",
    "100.100.100.200",
    "::1",
    "::",
    "fe80::1",
    "fd00:ec2::254",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:127.0.0.1",
  ])("%s está bloqueada", (ip) => {
    expect(ipBloqueada(ip)).toBe(true);
  });

  it.each(["10.0.0.5", "172.18.0.3", "192.168.1.20", "8.8.8.8", "fd12:3456::1", "2001:db8::1"])(
    "%s (privada o pública) se permite",
    (ip) => {
      expect(ipBloqueada(ip)).toBe(false);
    }
  );

  it("nombres reservados y literales en la URL", () => {
    for (const h of ["localhost", "api.localhost", "metadata.google.internal", "[::1]", "[::ffff:169.254.169.254]", "169.254.169.254"]) {
      expect(hostBloqueado(h), h).not.toBeNull();
    }
    expect(hostBloqueado("nea")).toBeNull();
    expect(urlDeCerebro("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(urlDeCerebro("http://[::ffff:169.254.169.254]/x")).toBeNull();
    // La forma decimal la normaliza el parser de URL a 169.254.169.254.
    expect(urlDeCerebro("http://2852039166/x")).toBeNull();
    expect(urlDeCerebro("http://localhost:8000/vocero/dispatch")).toBeNull();
    expect(urlDeCerebro("http://nea:8000/vocero/dispatch")).not.toBeNull();
  });

  it("DNS rebinding: se rechaza si CUALQUIER IP resuelta está prohibida", async () => {
    expect(await verificarDestino("http://nea:8000/x", async () => [{ address: "172.18.0.3" }])).toBeNull();
    expect(
      await verificarDestino("http://nea.ejemplo.com/x", async () => [{ address: "203.0.113.5" }, { address: "169.254.169.254" }])
    ).toBe("ip_reservada");
    expect(await verificarDestino("http://nada/x", async () => [])).toBe("no_resuelve");
    expect(
      await verificarDestino("http://falla/x", async () => {
        throw new Error("ENOTFOUND");
      })
    ).toBe("no_resuelve");
  });

  it("la URL de salud debe estar en el MISMO origen que la de despacho", () => {
    expect(revisarUrlSalud("http://nea:8000/health", "http://nea:8000/vocero/dispatch").ok).toBe(true);
    const r = revisarUrlSalud("http://otro:8000/health", "http://nea:8000/vocero/dispatch");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fallo.code).toBe("url_otro_origen");
  });
});

describe("A-3 — la URL de despacho exige ruta, sin query ni fragmento", () => {
  it("sin ruta → url_sin_ruta (antes pasaba y cada despacho iba a POST / → 404)", () => {
    for (const u of ["http://nea.ejemplo.com", "http://nea.ejemplo.com/"]) {
      const r = revisarUrlDespacho(u);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fallo.code).toBe("url_sin_ruta");
    }
    const q = revisarUrlDespacho("http://nea/vocero/dispatch?x=1");
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.fallo.code).toBe("url_con_query");
    expect(revisarUrlDespacho("http://nea:8000/vocero/dispatch").ok).toBe(true);
  });

  it("la lista muestra host + ruta (y una sola «v» en la versión, B-5)", () => {
    expect(destinoVisible({ dispatchUrl: "http://nea:8000/vocero/dispatch", host: "nea:8000" })).toBe("nea:8000/vocero/dispatch");
    expect(destinoVisible({ dispatchUrl: "http://nea:8000/", host: "nea:8000" })).toBe("nea:8000");
    expect(etiquetaVersion("v2.4.0")).toBe("v2.4.0");
    expect(etiquetaVersion("2.4.0")).toBe("v2.4.0");
  });

  it("M-9: pegar un secreto exige 32+ caracteres sin espacios", () => {
    expect(secretoPegadoValido("")).toBe(false);
    expect(secretoPegadoValido("a".repeat(31))).toBe(false);
    expect(secretoPegadoValido(`${"a".repeat(20)} ${"b".repeat(20)}`)).toBe(false);
    expect(secretoPegadoValido("a".repeat(32))).toBe(true);
  });

  it("el panel tiene «Editar» conectado a PATCH", () => {
    const src = readFileSync(join(process.cwd(), "src/components/plataforma/gestor-cerebros.tsx"), "utf8");
    expect(src).toMatch(/function EditarCerebro/);
    expect(src).toMatch(/method: "PATCH",\s*headers: \{ "content-type": "application\/json" \},\s*body: JSON\.stringify\(cambios\)/);
  });
});

/* ------------------------------------------------------------------ A-5 */

describe("A-5 — en modo plataforma la llave del entorno no se ve ni cuenta", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-or-plataforma-1234");
    vi.stubEnv("OPENROUTER_MODEL", "modelo/plataforma");
  });

  it("estadoIaDe: `multi` sin llave propia → sin_configurar (no «origen env»)", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.credencial.mockResolvedValue(null);
    expect(await estadoIaDe("org_A")).toEqual({ activa: false, motivo: "sin_configurar" });
  });

  it("`single` conserva el respaldo del entorno", async () => {
    vi.stubEnv("TENANCY", "");
    h.credencial.mockResolvedValue(null);
    expect(await estadoIaDe("org_A")).toMatchObject({ activa: true, origen: "env" });
  });

  it("armarVista en `multi`: ni URL, ni modelo, ni últimos 4 de la plataforma", () => {
    vi.stubEnv("TENANCY", "multi");
    const v = armarVista(null, { activa: false, motivo: "sin_configurar" });
    expect(v.respaldoEntorno).toBeNull();
    expect(JSON.stringify(v)).not.toContain("1234");
  });
});

/* ------------------------------------------------------------------ A-11 */

describe("A-11 — caché de /health por URL", () => {
  it("dos cerebros no se pisan la caché: un fetch por URL dentro del TTL", async () => {
    resetBrainStatusState();
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const reloj = () => 1_000_000;
    for (let i = 0; i < 3; i++) {
      await getBrainHealth("http://nea-1:8000/health", { fetchImpl, clock: reloj });
      await getBrainHealth("http://nea-2:8000/health", { fetchImpl, clock: reloj });
    }
    expect(urls.sort()).toEqual(["http://nea-1:8000/health", "http://nea-2:8000/health"]);
  });
});

/* ------------------------------------------------------------------ M-1 */

describe("M-1 — caché del secreto: versión y época", () => {
  it("una versión distinta (rotado en otro proceso) obliga a releer", async () => {
    vi.stubEnv("TENANCY", "multi");
    fake().responder(schema.brainDeployment, [secretoEnBase("v".repeat(43), { updatedAt: new Date(1000) })]);
    expect((await secretoDeDespliegue("brn_1", { version: new Date(1000) }))?.secreto).toBe("v".repeat(43));
    // Misma versión: de la caché (no hay más respuestas encoladas).
    expect((await secretoDeDespliegue("brn_1", { version: new Date(1000) }))?.secreto).toBe("v".repeat(43));
    fake().responder(schema.brainDeployment, [secretoEnBase("n".repeat(43), { updatedAt: new Date(2000) })]);
    expect((await secretoDeDespliegue("brn_1", { version: new Date(2000) }))?.secreto).toBe("n".repeat(43));
  });

  it("una invalidación durante una lectura en vuelo no deja cacheado el secreto viejo", async () => {
    let soltar: (v: unknown[]) => void = () => {};
    const enVuelo = new Promise<unknown[]>((r) => (soltar = r));
    const sel = vi.spyOn(fake().db, "select").mockImplementationOnce(
      () =>
        ({
          from: () => ({ where: () => ({ limit: () => enVuelo }) }),
        }) as never
    );
    const lectura = secretoDeDespliegue("brn_9");
    invalidarCacheCerebro("brn_9"); // p. ej. rotar mientras tanto
    soltar([secretoEnBase("viejo".padEnd(43, "x"))]);
    expect((await lectura)?.secreto).toBe("viejo".padEnd(43, "x"));
    sel.mockRestore();
    // La siguiente lectura va a la base (no quedó en caché).
    fake().responder(schema.brainDeployment, [secretoEnBase("nuevo".padEnd(43, "x"))]);
    expect((await secretoDeDespliegue("brn_9"))?.secreto).toBe("nuevo".padEnd(43, "x"));
  });
});

/* ------------------------------------------------------------------ M-2 */

describe("M-2 — borrar y asignar con bloqueos; 23503 no es un 500", () => {
  it("esViolacionFk reconoce el código, también anidado en `cause`", () => {
    expect(esViolacionFk({ code: "23503" })).toBe(true);
    expect(esViolacionFk({ message: "x", cause: { code: "23503" } })).toBe(true);
    expect(esViolacionFk({ code: "23505" })).toBe(false);
    expect(esViolacionFk(null)).toBe(false);
  });

  it("borrar: conteo dentro de la transacción → 409; FK que se cuela → 409", async () => {
    const ACTOR = { userId: "usr_1" };
    fake().responder(schema.brainDeployment, [{ name: "Nea" }]);
    fake().responder(schema.organization, [{ n: 2 }]);
    await expect(borrarDespliegue(ACTOR, "brn_1")).rejects.toMatchObject({ code: "cerebro_en_uso", status: 409 });

    fake().responder(schema.brainDeployment, [{ name: "Nea" }]);
    fake().responder(schema.organization, [{ n: 0 }]);
    const del = vi.spyOn(fake().db, "delete").mockImplementationOnce(() => {
      throw Object.assign(new Error("fk"), { code: "23503" });
    });
    await expect(borrarDespliegue(ACTOR, "brn_1")).rejects.toMatchObject({ code: "cerebro_en_uso", status: 409 });
    del.mockRestore();
  });

  it("asignar y el Blueprint bloquean la fila del despliegue (FOR SHARE)", () => {
    const src = readFileSync(join(process.cwd(), "src/server/brains/deployment.ts"), "utf8");
    expect(src).toMatch(/\.for\("share"\)/);
    expect(src).toMatch(/\.for\("update"\)/);
  });
});

/* ------------------------------------------------------------ M-3 / B-3 */

describe("M-3 / B-3 — migración 0030", () => {
  const sql = readFileSync(join(process.cwd(), "drizzle/0030_cerebros_indices.sql"), "utf8");
  it("índices en las 3 FKs nuevas", () => {
    expect(sql).toMatch(/ON "dispatch" USING btree \("brain_deployment_id"\)/);
    expect(sql).toMatch(/ON "brain_reply" USING btree \("message_id"\)/);
    expect(sql).toMatch(/ON "organization" USING btree \("brain_deployment_id"\)/);
  });
  it("CHECK del estado del despliegue", () => {
    expect(sql).toMatch(/CHECK \("brain_deployment"\."status" in \('activo', 'pausado'\)\)/);
  });
  it("registrada en el journal de Drizzle", () => {
    const journal = readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8");
    expect(journal).toMatch(/"tag": "0030_cerebros_indices"/);
    expect(readdirSync(join(process.cwd(), "drizzle/meta"))).toContain("0030_snapshot.json");
  });
});

/* ------------------------------------------------------------------ A-12 */

describe("A-12 — anotar el despliegue solo con el lease propio", () => {
  it("anotarDespliegue filtra por propietario(fila) (id + en_vuelo + attempts)", () => {
    const src = readFileSync(join(process.cwd(), "src/server/dispatch/outbox.ts"), "utf8");
    const cuerpo = src.slice(src.indexOf("export async function anotarDespliegue"));
    expect(cuerpo.slice(0, 600)).toMatch(/\.where\(and\(propietario\(fila\), eq\(schema\.dispatch\.organizationId/);
    const worker = readFileSync(join(process.cwd(), "src/server/dispatch/worker.ts"), "utf8");
    expect(worker).not.toMatch(/\.update\(schema\.dispatch\)/);
  });
});

/* ------------------------------------------------------------------ B-1 */

describe("B-1 — AES-GCM con tamaños comprobados", () => {
  it("cifra y descifra; un tag truncado o un IV de otro tamaño se rechazan", () => {
    const e = encryptSecret("hola");
    expect(decryptSecret(e)).toBe("hola");
    const tagCorto = Buffer.from(e.tag, "base64").subarray(0, 8).toString("base64");
    expect(() => decryptSecret({ ...e, tag: tagCorto })).toThrow(/Tag/);
    const ivLargo = Buffer.alloc(16).toString("base64");
    expect(() => decryptSecret({ ...e, iv: ivLargo })).toThrow(/IV/);
  });
});

/* ------------------------------------------------------------------ B-7 */

describe("B-7 — el comentario obsoleto del worker", () => {
  it("ya no habla de un «agente incluido»", () => {
    const worker = readFileSync(join(process.cwd(), "src/server/dispatch/worker.ts"), "utf8");
    expect(worker).not.toMatch(/el agente incluido vuelve a ser quien manda/);
  });
});
