import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";
import { archivosTs, leerSinComentarios, rel } from "./helpers/fuentes";

/**
 * Auditoría final de la 069 (`AUDITORIA-069-FINAL.md`): F-01 portapapeles por
 * HTTP, F-02 secciones guardadas en el formulario, F-04 límite de tokens
 * rechazados, F-05 cursor compuesto, F-06 país al editar, F-07 ids estables
 * y tarjetas incompletas, F-08 insignias de estado. (F-03 y el pase de F-04
 * están en `pase-sesion.test.ts`.)
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/tenant/consultas", () => ({ esSuperAdmin: vi.fn(async () => true) }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));

import { copiarAlPortapapeles } from "@/lib/clipboard";
import { resetRateLimit } from "@/lib/rate-limit";
import { blueprintSchema } from "@/lib/platform/blueprint";
import {
  cambiosAlElegirPais,
  copiarALaborables,
  formularioDesdeBlueprint,
  formularioInicial,
  blueprintParaEnviar,
  seccionesDelFormulario,
  tarjetasIncompletas,
  type DefaultsForm,
  type TechoForm,
} from "@/lib/platform/formulario-blueprint";
import { REGIONES_SUGERIDAS } from "@/lib/region";
import { EJEMPLO_COMPLETO } from "@/server/platform/catalogo";
import { leerCursor, listarAuditoria } from "@/server/platform/auditoria-consulta";
import { POST as mcpPOST } from "@/app/api/platform/mcp/route";
import { GET as auditREST } from "@/app/api/platform/audit/route";
import { estadoToken } from "@/components/plataforma/gestor-tokens";
import { estadoAcceso } from "@/components/plataforma/gestor-soporte";

const fake = () => h.fake!;

beforeEach(() => {
  fake().reiniciar();
  resetRateLimit();
  vi.stubEnv("TENANCY", "multi");
  vi.stubEnv("PLATFORM_BASE_DOMAIN", "aliantis.co");
  vi.stubEnv("PLATFORM_MCP", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("F-01 — copiar al portapapeles también por HTTP", () => {
  /** Un `document` mínimo: lo justo para el respaldo con `<textarea>`. */
  function documentoFalso(copia: boolean | "lanza") {
    const agregados: unknown[] = [];
    const area = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(() => agregados.pop()),
    };
    const doc = {
      body: { appendChild: (x: unknown) => agregados.push(x) },
      activeElement: null,
      createElement: () => area,
      getSelection: () => ({ rangeCount: 0 }),
      execCommand: vi.fn(() => {
        if (copia === "lanza") throw new Error("no");
        return copia;
      }),
    };
    return { doc, area, agregados };
  }

  it("con la API moderna (HTTPS) copia y devuelve true", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copiarAlPortapapeles("alp_x")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("alp_x");
  });

  it("por HTTP (sin navigator.clipboard) usa el textarea y lo retira", async () => {
    vi.stubGlobal("navigator", {});
    const { doc, area, agregados } = documentoFalso(true);
    vi.stubGlobal("document", doc);
    expect(await copiarAlPortapapeles("http://demo.sslip.io")).toBe(true);
    expect(area.value).toBe("http://demo.sslip.io");
    expect(doc.execCommand).toHaveBeenCalledWith("copy");
    expect(agregados).toEqual([]);
  });

  it("si la API moderna falla, intenta el respaldo", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denegado"))) } });
    vi.stubGlobal("document", documentoFalso(true).doc);
    expect(await copiarAlPortapapeles("x")).toBe(true);
  });

  it("si nada copia, devuelve false (la UI NO dice «Copiado») y nunca lanza", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", documentoFalso(false).doc);
    expect(await copiarAlPortapapeles("x")).toBe(false);
    vi.stubGlobal("document", documentoFalso("lanza").doc);
    expect(await copiarAlPortapapeles("x")).toBe(false);
  });

  it("guardarraíl: nadie fuera de lib/clipboard.ts toca navigator.clipboard", () => {
    const usan = archivosTs(join(process.cwd(), "src"))
      .filter((f) => /navigator\.clipboard/.test(leerSinComentarios(f)))
      .map(rel);
    expect(usan).toEqual(["src/lib/clipboard.ts"]);
  });
});

const CO = REGIONES_SUGERIDAS[0];
const MX = REGIONES_SUGERIDAS[1];
const defaults: DefaultsForm = {
  country: CO.country,
  locale: CO.locale,
  timezone: CO.timezone,
  currency: CO.currency,
  accent: "#0d3b9e",
  etapas: ["Nuevo"],
};
const techo: TechoForm = { agenda: true, atribucion: false, channels: ["whatsapp"] };
const bp = blueprintSchema.parse(EJEMPLO_COMPLETO);

describe("F-02 — apariencia y agenda ya guardadas, al editar", () => {
  it("se marcan `guardada` y siguen en el formulario aunque `usar` se apague", () => {
    const f = formularioDesdeBlueprint(bp, defaults, techo);
    expect(f.appearance.guardada).toBe(true);
    expect(f.agenda.guardada).toBe(true);
    const base = seccionesDelFormulario(f, "editar", techo);
    f.appearance.usar = false;
    f.agenda.usar = false;
    // Apagar ya no «hace nada en silencio»: no hay cambio porque la sección sigue igual.
    expect(blueprintParaEnviar(f, "editar", techo, base).modificadas).toEqual([]);
    f.appearance.valor = { ...f.appearance.valor, tamano: "grande" };
    expect(blueprintParaEnviar(f, "editar", techo, base).modificadas).toEqual(["appearance"]);
  });

  it("un negocio sin ellas las ofrece con el interruptor (no guardadas)", () => {
    const f = formularioInicial(defaults, techo);
    expect(f.appearance.guardada).toBe(false);
    expect(f.agenda.guardada).toBe(false);
    expect(seccionesDelFormulario(f, "crear", techo)).not.toHaveProperty("agenda");
  });
});

describe("F-06 — elegir país", () => {
  it("al crear completa moneda y zona de la agenda", () => {
    expect(cambiosAlElegirPais(MX.country, "crear")).toEqual({
      region: { country: MX.country, locale: MX.locale, timezone: MX.timezone },
      brand: { currency: MX.currency },
      agenda: { timezone: MX.timezone },
    });
  });
  it("al editar solo la región: ni moneda ni agenda", () => {
    const c = cambiosAlElegirPais(MX.country, "editar");
    expect(c).toEqual({ region: { country: MX.country, locale: MX.locale, timezone: MX.timezone } });
  });
  it("un país fuera de la lista: solo el código", () => {
    expect(cambiosAlElegirPais("BO", "crear")).toEqual({ region: { country: "BO" } });
  });
});

describe("F-07 — ids estables y tarjetas incompletas", () => {
  it("cada elemento cargado lleva un `uid` único que nunca se envía", () => {
    const f = formularioDesdeBlueprint(bp, defaults, techo);
    const uids = [
      ...f.knowledge.entries.map((e) => e.uid),
      ...f.quickReplies.entries.map((e) => e.uid),
      ...Object.values(f.agenda.weeklyHours).flat().map((x) => x.uid),
    ];
    expect(uids.every(Boolean)).toBe(true);
    expect(new Set(uids).size).toBe(uids.length);
    expect(JSON.stringify(seccionesDelFormulario(f, "editar", techo))).not.toContain("uid");
  });

  it("copiar a lunes–viernes da ids nuevos (no comparte claves entre días)", () => {
    const f = formularioDesdeBlueprint(bp, defaults, techo);
    const semana = copiarALaborables(f.agenda.weeklyHours, "mon");
    expect(semana.tue[0]?.uid).not.toBe(semana.mon[0]?.uid);
    expect(semana.wed[0]?.uid).not.toBe(semana.tue[0]?.uid);
  });

  it("cuenta las tarjetas que se descartarían (pregunta sin respuesta, atajo sin texto o inválido)", () => {
    const f = formularioInicial(defaults, techo);
    f.knowledge.entries = [
      { kind: "qa", question: "¿Precio?", answer: "" },
      { kind: "qa", question: "¿Dónde?", answer: "Calle 10" },
      { kind: "block", content: "   " },
    ];
    f.quickReplies.entries = [
      { shortcut: "pagos", text: "" },
      { shortcut: "///", text: "hola" },
      { shortcut: "ok", text: "Listo" },
    ];
    expect(tarjetasIncompletas(f)).toEqual({ conocimiento: 2, respuestas: 2 });
  });
});

describe("F-04 — tokens rechazados por IP", () => {
  const TOKEN = `alp_${"x".repeat(43)}`;
  const rpc = () =>
    new Request("https://aliantis.co/api/platform/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

  it("MCP: tras 20 rechazos (401), la misma IP recibe 429 sin consultar la base", async () => {
    for (let i = 0; i < 20; i++) expect((await mcpPOST(rpc())).status).toBe(401);
    const consultasAntes = fake().escrituras.length;
    const res = await mcpPOST(rpc());
    expect(res.status).toBe(429);
    expect(fake().escrituras.length).toBe(consultasAntes);
  });

  it("REST: la misma cuenta frena la API de plataforma", async () => {
    const req = () =>
      new Request("https://aliantis.co/api/platform/audit", {
        headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": "8.8.8.8" },
      });
    for (let i = 0; i < 20; i++) expect((await auditREST(req())).status).toBe(401);
    expect((await auditREST(req())).status).toBe(429);
  });
});

describe("F-05 — cursor compuesto de la auditoría", () => {
  it("lee `<fecha>|<id>` y el ISO simple; rechaza lo que no es cursor", () => {
    expect(leerCursor("2026-11-17T01:20:03.773614|aud_9")).toEqual({ fecha: "2026-11-17T01:20:03.773614", id: "aud_9" });
    expect(leerCursor("2026-11-17T01:20:03.773Z")).toEqual({ fecha: "2026-11-17T01:20:03.773Z", id: null });
    expect(leerCursor("ayer")).toBeNull();
    expect(leerCursor("2026-11-17T01:20:03|aud 9; drop")).toBeNull();
    expect(leerCursor(null)).toBeNull();
  });

  it("la página siguiente lleva la fecha EXACTA (microsegundos) y el id de la última fila", async () => {
    const t = new Date(Date.UTC(2026, 10, 17, 1, 20, 3, 773));
    fake().responder(
      schema.platformAuditLog,
      ["aud_c", "aud_b", "aud_a"].map((id) => ({
        id,
        action: "organizacion_creada",
        via: "api",
        organizationId: "org_A",
        tokenId: null,
        detail: {},
        ip: null,
        createdAt: t,
        marca: "2026-11-17T01:20:03.773614",
        actor: null,
      }))
    );
    const r = await listarAuditoria({ limit: 2 });
    expect(r.entries.map((e) => e.id)).toEqual(["aud_c", "aud_b"]);
    expect(r.nextBefore).toBe("2026-11-17T01:20:03.773614|aud_b");
  });

  it("ordena por fecha y desempata por id (fuente)", () => {
    const fuente = readFileSync("src/server/platform/auditoria-consulta.ts", "utf8");
    expect(fuente).toMatch(/orderBy\(desc\(schema\.platformAuditLog\.createdAt\), desc\(schema\.platformAuditLog\.id\)\)/);
  });
});

describe("F-08 — insignias de estado", () => {
  const ahora = Date.UTC(2026, 10, 17);
  it("tokens: vigente, vencido, revocado", () => {
    expect(estadoToken({ expiresAt: null, revokedAt: null }, ahora)).toBe("vigente");
    expect(estadoToken({ expiresAt: new Date(ahora - 1).toISOString(), revokedAt: null }, ahora)).toBe("vencido");
    expect(estadoToken({ expiresAt: null, revokedAt: new Date(ahora).toISOString() }, ahora)).toBe("revocado");
  });
  it("accesos de soporte: vigente, revocado, vencido", () => {
    expect(estadoAcceso({ vigente: true, revokedAt: null }).texto).toBe("Vigente");
    expect(estadoAcceso({ vigente: false, revokedAt: "2026-11-17T00:00:00Z" }).texto).toBe("Revocado");
    expect(estadoAcceso({ vigente: false, revokedAt: null }).texto).toBe("Vencido");
  });
  it("tokens y soporte ya no usan casillas nativas", () => {
    for (const f of ["src/components/plataforma/gestor-tokens.tsx", "src/components/plataforma/gestor-soporte.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/type="checkbox"/);
    }
  });
});
