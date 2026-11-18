import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 070 — Bloque 1: credencial derivada (vector gemelo con Nea), despliegues de
 * cerebro (secreto cifrado, una vez, nunca afuera), salud con salvaguardas,
 * asignación y la puerta única `requireBrain` de `/api/brains/*`.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), BETTER_AUTH_SECRET: "s".repeat(40) }),
}));

import { encryptSecret } from "@/lib/crypto";
import { resetRateLimit } from "@/lib/rate-limit";
import {
  asignarCerebro,
  borrarDespliegue,
  crearDespliegue,
  credencialDerivada,
  DOMINIO_CEREBRO,
  despliegueVista,
  invalidarCacheCerebro,
  listarDespliegues,
  rotarSecreto,
  secretoDeDespliegue,
  urlDeCerebro,
  urlDeSalud,
} from "@/server/brains/deployment";
import { consultarSalud, interpretarSalud, MAX_CUERPO_SALUD } from "@/server/brains/salud";
import { credencialCoincide, requireBrain } from "@/server/brains/auth";
import { ACCIONES_AUDITORIA } from "@/server/platform/auditoria";
import { BlueprintError } from "@/server/platform/blueprint/errores";

const fake = () => h.fake!;
const ACTOR = { userId: "usr_admin", ip: "1.2.3.4", via: "sesion" as const };

beforeEach(() => {
  fake().reiniciar();
  invalidarCacheCerebro();
  resetRateLimit();
  vi.unstubAllEnvs();
});

/* ------------------------------------------------- credencial (gemela) */

describe("credencial derivada — contrato con nea-agent", () => {
  it("es el mismo valor que fija `tests/test_multiorg.py` de Nea", () => {
    expect(DOMINIO_CEREBRO).toBe("vocero:cerebro:v1");
    expect(credencialDerivada("un-secreto-de-despliegue-largo-y-aburrido", "org_abc123")).toBe(
      "_BqRKryMUdexcuLj_3RG1ARbgqr_LhXRSLJYmrw5VJ0"
    );
  });

  it("base64url sin relleno, distinta por organización y por secreto", () => {
    const a = credencialDerivada("x".repeat(40), "org_a");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(credencialDerivada("x".repeat(40), "org_b"));
    expect(a).not.toBe(credencialDerivada("y".repeat(40), "org_a"));
  });

  it("compara en tiempo constante y rechaza longitudes distintas", () => {
    expect(credencialCoincide("abc", "abc")).toBe(true);
    expect(credencialCoincide("abc", "abd")).toBe(false);
    expect(credencialCoincide("abc", "abcd")).toBe(false);
  });
});

/* ------------------------------------------------------- despliegues */

function filaCifrada(secreto: string, extra: Record<string, unknown> = {}) {
  const e = encryptSecret(secreto);
  return {
    id: "brn_1",
    name: "Nea",
    dispatchUrl: "http://nea:8000/vocero/dispatch",
    healthUrl: null,
    secretCipher: e.cipher,
    secretIv: e.iv,
    secretTag: e.tag,
    secretLast4: secreto.slice(-4),
    status: "activo",
    lastHealthAt: null,
    lastHealthOk: null,
    lastHealthDetail: null,
    createdBy: "usr_admin",
    createdAt: new Date("2026-11-17T00:00:00Z"),
    updatedAt: new Date("2026-11-17T00:00:00Z"),
    ...extra,
  };
}

describe("despliegues de cerebro", () => {
  it("URLs: solo http(s) sin credenciales; salud por defecto en el mismo origen", () => {
    expect(urlDeCerebro("http://nea:8000/vocero/dispatch")?.host).toBe("nea:8000");
    expect(urlDeCerebro("ftp://nea/x")).toBeNull();
    expect(urlDeCerebro("https://u:p@nea/x")).toBeNull();
    expect(urlDeCerebro("no es url")).toBeNull();
    expect(urlDeSalud({ dispatchUrl: "http://nea:8000/vocero/dispatch", healthUrl: null })).toBe("http://nea:8000/health");
    expect(urlDeSalud({ dispatchUrl: "http://nea:8000/x", healthUrl: "http://otra/salud" })).toBe("http://otra/salud");
  });

  it("crear: genera el secreto, lo guarda CIFRADO y solo lo devuelve una vez", async () => {
    const r = await crearDespliegue(ACTOR, { name: "Nea Prod", dispatchUrl: "http://nea:8000/vocero/dispatch" });
    expect(r.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [ins] = fake().de(schema.brainDeployment, "insert");
    const v = ins!.valores;
    expect(v.secretLast4).toBe(r.secret.slice(-4));
    expect(JSON.stringify(v)).not.toContain(r.secret);
    expect(JSON.stringify(r.despliegue)).not.toContain(r.secret);
    const [aud] = fake().de(schema.platformAuditLog, "insert");
    expect(aud!.valores.action).toBe("cerebro_creado");
    expect(JSON.stringify(aud!.valores)).not.toContain(r.secret);
  });

  it("crear con secreto pegado: mínimo 32 y sin espacios", async () => {
    await expect(
      crearDespliegue(ACTOR, { name: "N", dispatchUrl: "http://nea/x", secret: "corto" })
    ).rejects.toMatchObject({ code: "secreto_invalido" });
    await expect(
      crearDespliegue(ACTOR, { name: "N", dispatchUrl: "http://nea/x", secret: `${"a".repeat(20)} ${"b".repeat(20)}` })
    ).rejects.toMatchObject({ code: "secreto_invalido" });
    const pegado = "p".repeat(48);
    const r = await crearDespliegue(ACTOR, { name: "N", dispatchUrl: "http://nea/x", secret: pegado });
    expect(r.secret).toBe(pegado);
  });

  it("crear rechaza una URL con credenciales", async () => {
    await expect(
      crearDespliegue(ACTOR, { name: "N", dispatchUrl: "https://u:p@nea/x" })
    ).rejects.toBeInstanceOf(BlueprintError);
  });

  it("la vista pública nunca lleva el cifrado", () => {
    const v = despliegueVista(filaCifrada("z".repeat(43)) as never, 2);
    expect(Object.keys(v)).not.toEqual(expect.arrayContaining(["secretCipher"]));
    expect(JSON.stringify(v)).not.toMatch(/secretCipher|secretIv|secretTag/);
    expect(v.organizations).toBe(2);
    expect(v.host).toBe("nea:8000");
  });

  it("listar: nada del secreto, con el conteo de negocios", async () => {
    const secreto = "q".repeat(43);
    fake().responder(schema.brainDeployment, [filaCifrada(secreto)]);
    fake().responder(schema.organization, [{ id: "brn_1", n: 3 }]);
    const lista = await listarDespliegues();
    expect(lista[0]!.organizations).toBe(3);
    expect(JSON.stringify(lista)).not.toContain(secreto);
  });

  it("descifra con caché y rotar la invalida en el acto", async () => {
    const viejo = "v".repeat(43);
    const f = filaCifrada(viejo);
    fake().responder(schema.brainDeployment, [{ cipher: f.secretCipher, iv: f.secretIv, tag: f.secretTag, status: "activo" }]);
    expect((await secretoDeDespliegue("brn_1"))?.secreto).toBe(viejo);
    // Segunda lectura: de la caché (no hay más respuestas encoladas).
    expect((await secretoDeDespliegue("brn_1"))?.secreto).toBe(viejo);

    fake().responder(schema.brainDeployment, [f]); // filaDe en rotar
    fake().responder(schema.brainDeployment, [f]); // obtenerDespliegue
    const r = await rotarSecreto(ACTOR, "brn_1");
    expect(r.secret).not.toBe(viejo);
    const upd = fake().de(schema.brainDeployment, "update")[0]!.valores;
    expect(upd.secretLast4).toBe(r.secret.slice(-4));
    expect(JSON.stringify(upd)).not.toContain(r.secret);

    const nueva = filaCifrada(r.secret);
    fake().responder(schema.brainDeployment, [{ cipher: nueva.secretCipher, iv: nueva.secretIv, tag: nueva.secretTag, status: "activo" }]);
    expect((await secretoDeDespliegue("brn_1"))?.secreto).toBe(r.secret);
    const aud = fake().de(schema.platformAuditLog, "insert").map((e) => e.valores.action);
    expect(aud).toContain("cerebro_secreto_rotado");
  });

  it("borrar con negocios asignados → 409 cerebro_en_uso", async () => {
    fake().responder(schema.brainDeployment, [filaCifrada("b".repeat(43))]);
    fake().responder(schema.organization, [{ id: "brn_1", n: 1 }]);
    await expect(borrarDespliegue(ACTOR, "brn_1")).rejects.toMatchObject({ code: "cerebro_en_uso", status: 409 });
    expect(fake().de(schema.brainDeployment, "delete")).toHaveLength(0);
  });

  it("asignar: no a uno pausado ni inexistente; auditado con antes/después", async () => {
    // Auditoría 070 (M-2): la organización se lee (y bloquea) primero, dentro
    // de la transacción; después, el despliegue con FOR SHARE.
    fake().responder(schema.organization, [{ antes: null }]);
    fake().responder(schema.brainDeployment, [filaCifrada("c".repeat(43), { status: "pausado" })]);
    await expect(asignarCerebro(ACTOR, "org_A", "brn_1")).rejects.toMatchObject({ code: "cerebro_pausado" });
    fake().responder(schema.organization, [{ antes: null }]);
    fake().responder(schema.brainDeployment, []);
    await expect(asignarCerebro(ACTOR, "org_A", "brn_x")).rejects.toMatchObject({ code: "cerebro_no_encontrado" });

    fake().responder(schema.brainDeployment, [filaCifrada("c".repeat(43))]);
    fake().responder(schema.organization, [{ antes: null }]);
    expect(await asignarCerebro(ACTOR, "org_A", "brn_1")).toEqual({ antes: null, despues: "brn_1" });
    expect(fake().de(schema.organization, "update")[0]!.valores).toEqual({ brainDeploymentId: "brn_1" });
    const aud = fake().de(schema.platformAuditLog, "insert")[0]!.valores;
    expect(aud).toMatchObject({ action: "cerebro_asignado", organizationId: "org_A", detail: { antes: null, despues: "brn_1" } });
  });

  it("quitar el cerebro (null) no exige despliegue", async () => {
    fake().responder(schema.organization, [{ antes: "brn_1" }]);
    expect(await asignarCerebro(ACTOR, "org_A", null)).toEqual({ antes: "brn_1", despues: null });
  });

  it("las acciones nuevas están en el catálogo de auditoría", () => {
    for (const a of ["cerebro_creado", "cerebro_secreto_rotado", "cerebro_asignado", "cerebro_probado", "cerebro_pausado", "cerebro_borrado"]) {
      expect(ACCIONES_AUDITORIA).toContain(a);
    }
  });
});

/* ------------------------------------------------------------- salud */

describe("salud del cerebro (D13)", () => {
  it("interpreta /health de Nea: solo version, mode y llm", () => {
    const r = interpretarSalud(200, JSON.stringify({ version: "2.4.0", mode: "multiorg", llm: "crm", secreto: "x" }));
    expect(r).toMatchObject({ ok: true, version: "2.4.0", mode: "multiorg", llm: "crm", multiorg: true });
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(interpretarSalud(200, "{}").multiorg).toBe(false);
    expect(interpretarSalud(503, "no json").ok).toBe(false);
  });

  it("no sigue redirecciones, no guarda caché y corta el cuerpo a 4 KB", async () => {
    const llamadas: RequestInit[] = [];
    const enorme = JSON.stringify({ mode: "multiorg", relleno: "x".repeat(MAX_CUERPO_SALUD * 4) });
    const fetchFalso = (async (_u: string, init: RequestInit) => {
      llamadas.push(init);
      return new Response(enorme, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await consultarSalud("http://nea:8000/health", fetchFalso);
    expect(llamadas[0]).toMatchObject({ redirect: "manual", cache: "no-store", method: "GET" });
    // Cortado: ya no es JSON válido, así que no se lee el modo; sigue «sano» por el status.
    expect(r.ok).toBe(true);
    expect(r.mode).toBeNull();
  });

  it("una redirección no cuenta como sano", async () => {
    const fetchFalso = (async () => new Response(null, { status: 302, headers: { location: "http://otro" } })) as unknown as typeof fetch;
    expect((await consultarSalud("http://nea/health", fetchFalso)).ok).toBe(false);
  });

  it("sin conexión: no lanza, dice por qué", async () => {
    const fetchFalso = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await consultarSalud("http://nea/health", fetchFalso)).toMatchObject({ ok: false, status: null, error: "No se pudo conectar" });
  });
});

/* -------------------------------------------------------- requireBrain */

const SECRETO_A = "a".repeat(43);
const SECRETO_B = "b".repeat(43);

function peticion(cabeceras: Record<string, string>, ip = "9.9.9.9"): Request {
  return new Request("http://plataforma.test/api/brains/context?conversationId=cv_1", {
    headers: { "x-forwarded-for": ip, ...cabeceras },
  });
}

function orgA(extra: Record<string, unknown> = {}) {
  return { id: "org_A", slug: "clinica", status: "activa", deploymentId: "brn_1", ...extra };
}

function secretoEnBase(secreto: string, status = "activo") {
  const f = filaCifrada(secreto);
  return { cipher: f.secretCipher, iv: f.secretIv, tag: f.secretTag, status };
}

async function cuerpo(r: Response): Promise<unknown> {
  return r.json().catch(() => null);
}

describe("requireBrain — la puerta de /api/brains/*", () => {
  beforeEach(() => vi.stubEnv("TENANCY", "multi"));

  it("en `single` la superficie no existe: 404 vacío", async () => {
    vi.stubEnv("TENANCY", "single");
    const r = await requireBrain(peticion({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(404);
      expect(await r.response.text()).toBe("");
    }
  });

  it("credencial de A con la cabecera de A (slug o id) → ámbito de A", async () => {
    for (const cabecera of ["clinica", "org_A"]) {
      invalidarCacheCerebro();
      fake().responder(schema.organization, [orgA()]);
      fake().responder(schema.brainDeployment, [secretoEnBase(SECRETO_A)]);
      const r = await requireBrain(
        peticion({ authorization: `Bearer ${credencialDerivada(SECRETO_A, "org_A")}`, "x-vocero-organization": cabecera })
      );
      expect(r).toEqual({ ok: true, ambito: { organizationId: "org_A", slug: "clinica", deploymentId: "brn_1" } });
    }
  });

  it("todo fallo es el MISMO 401 (sin oráculo)", async () => {
    const casos: { nombre: string; preparar: () => void; cab: Record<string, string> }[] = [
      { nombre: "sin cabeceras", preparar: () => {}, cab: {} },
      {
        nombre: "organización inexistente",
        preparar: () => fake().responder(schema.organization, []),
        cab: { authorization: `Bearer ${credencialDerivada(SECRETO_A, "org_A")}`, "x-vocero-organization": "nadie" },
      },
      {
        nombre: "credencial de B con cabecera de A",
        preparar: () => {
          fake().responder(schema.organization, [orgA()]);
          fake().responder(schema.brainDeployment, [secretoEnBase(SECRETO_A)]);
        },
        cab: { authorization: `Bearer ${credencialDerivada(SECRETO_A, "org_B")}`, "x-vocero-organization": "clinica" },
      },
      {
        nombre: "derivada con el secreto de OTRO despliegue",
        preparar: () => {
          fake().responder(schema.organization, [orgA()]);
          fake().responder(schema.brainDeployment, [secretoEnBase(SECRETO_A)]);
        },
        cab: { authorization: `Bearer ${credencialDerivada(SECRETO_B, "org_A")}`, "x-vocero-organization": "clinica" },
      },
      {
        nombre: "el secreto maestro en crudo",
        preparar: () => {
          fake().responder(schema.organization, [orgA()]);
          fake().responder(schema.brainDeployment, [secretoEnBase(SECRETO_A)]);
        },
        cab: { authorization: `Bearer ${SECRETO_A}`, "x-vocero-organization": "clinica" },
      },
      {
        nombre: "negocio sin cerebro asignado",
        preparar: () => fake().responder(schema.organization, [orgA({ deploymentId: null })]),
        cab: { authorization: `Bearer ${credencialDerivada(SECRETO_A, "org_A")}`, "x-vocero-organization": "clinica" },
      },
      {
        nombre: "despliegue pausado",
        preparar: () => {
          fake().responder(schema.organization, [orgA()]);
          fake().responder(schema.brainDeployment, [secretoEnBase(SECRETO_A, "pausado")]);
        },
        cab: { authorization: `Bearer ${credencialDerivada(SECRETO_A, "org_A")}`, "x-vocero-organization": "clinica" },
      },
      {
        nombre: "cabecera ambigua (dos coincidencias)",
        preparar: () => fake().responder(schema.organization, [orgA(), orgA({ id: "org_X" })]),
        cab: { authorization: `Bearer ${credencialDerivada(SECRETO_A, "org_A")}`, "x-vocero-organization": "clinica" },
      },
    ];
    const cuerpos = new Set<string>();
    for (const c of casos) {
      invalidarCacheCerebro();
      fake().reiniciar();
      resetRateLimit();
      c.preparar();
      const r = await requireBrain(peticion(c.cab));
      expect(r.ok, c.nombre).toBe(false);
      if (!r.ok) {
        expect(r.response.status, c.nombre).toBe(401);
        cuerpos.add(JSON.stringify(await cuerpo(r.response)));
      }
    }
    expect(cuerpos.size).toBe(1);
  });

  it("reasignado de D1 a D2: la credencial de D1 deja de valer", async () => {
    fake().responder(schema.organization, [orgA({ deploymentId: "brn_2" })]);
    fake().responder(schema.brainDeployment, [secretoEnBase(SECRETO_B)]);
    const r = await requireBrain(
      peticion({ authorization: `Bearer ${credencialDerivada(SECRETO_A, "org_A")}`, "x-vocero-organization": "clinica" })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("suspendida → 403 solo DESPUÉS de autenticar", async () => {
    fake().responder(schema.organization, [orgA({ status: "suspendida" })]);
    fake().responder(schema.brainDeployment, [secretoEnBase(SECRETO_A)]);
    const r = await requireBrain(
      peticion({ authorization: `Bearer ${credencialDerivada(SECRETO_A, "org_A")}`, "x-vocero-organization": "clinica" })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      expect(await cuerpo(r.response)).toMatchObject({ error: { code: "organizacion_suspendida" } });
    }
  });

  it("20 rechazos desde una IP para UNA organización → 429 antes de tocar la base", async () => {
    // Auditoría 070 (A-1, C-1): el límite es por (IP, organización).
    for (let i = 0; i < 20; i++) {
      const r = await requireBrain(peticion({ "x-vocero-organization": "clinica" }, "7.7.7.7"));
      if (!r.ok) expect(r.response.status).toBe(401);
    }
    const selectSpy = vi.spyOn(fake().db, "select");
    const r = await requireBrain(
      peticion({ authorization: "Bearer x", "x-vocero-organization": "clinica" }, "7.7.7.7")
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(429);
    expect(selectSpy).not.toHaveBeenCalled();
    // Otra IP sigue pudiendo.
    const otra = await requireBrain(peticion({ "x-vocero-organization": "clinica" }, "8.8.8.8"));
    if (!otra.ok) expect(otra.response.status).toBe(401);
  });
});

/* ------------------------------------------------- guardia estática */

function rutasBajo(dir: string): string[] {
  let salida: string[] = [];
  let entradas: string[] = [];
  try {
    entradas = readdirSync(dir);
  } catch {
    return [];
  }
  for (const e of entradas) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) salida = salida.concat(rutasBajo(p));
    else if (e === "route.ts") salida.push(p);
  }
  return salida;
}

describe("guardia estática de /api/brains/*", () => {
  it("toda ruta pasa por requireBrain y nunca por la organización de la instancia", () => {
    for (const ruta of rutasBajo(join(process.cwd(), "src/app/api/brains"))) {
      const src = readFileSync(ruta, "utf8");
      // Auditoría 070 (A-7): por `withBrain`/`withBrainAgenda` (que llaman a
      // `requireBrain`/`requireBrainAgenda` y capturan los errores).
      expect(src, ruta).toMatch(/export const (GET|POST|PUT|PATCH|DELETE) = withBrain(Agenda)?[<(]/);
      expect(src, ruta).not.toMatch(/resolveInstanceOrg|requireBotKey/);
    }
  });

  it("requireBrain no usa la organización de la instancia", () => {
    const src = readFileSync(join(process.cwd(), "src/server/brains/auth.ts"), "utf8");
    expect(src).not.toMatch(/resolveInstanceOrg/);
  });

  it("las rutas del panel que crean o rotan exigen sesión (el secreto no pasa por una IA)", () => {
    const crear = readFileSync(join(process.cwd(), "src/app/api/platform/brains/route.ts"), "utf8");
    const post = crear.slice(crear.indexOf("export async function POST"));
    expect(post).toMatch(/soloSesion: true/);
    const rotar = readFileSync(join(process.cwd(), "src/app/api/platform/brains/[id]/rotar/route.ts"), "utf8");
    expect(rotar).toMatch(/soloSesion: true/);
  });
});
