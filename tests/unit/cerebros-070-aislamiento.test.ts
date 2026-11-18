import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

/**
 * 070 (US7, SC-003) — Matriz de aislamiento A ↛ B de TODA la superficie
 * `/api/brains/*`, con la puerta real (`requireBrain`).
 *
 * El escenario es el de producción: UNA Nea `multiorg` (un despliegue,
 * `brn_1`) atiende a los negocios A y B. Con la credencial de A:
 *
 * 1. Presentarse como B (cabecera de B) → 401 en cada ruta.
 * 2. Pedir recursos de B (conversación, despacho, adjunto, cita, selección)
 *    → no se encuentran (404/422), no se escribe nada y no se toca ningún
 *    efecto (envío, Meta, agenda, proveedor de IA).
 * 3. Y el invariante que lo sostiene: TODA consulta a una tabla de negocio
 *    hecha durante la petición filtra por `org_A` y nunca menciona `org_B`.
 *    La base falsa registra los parámetros SQL de cada WHERE para comprobarlo.
 */

const SECRETO = "s".repeat(43);

type Consulta = { tabla: string; params: unknown[] };

const h = vi.hoisted(() => ({
  consultas: [] as { tabla: string; params: unknown[] }[],
  escrituras: [] as { op: string; tabla: string }[],
  secreto: null as null | { cipher: string; iv: string; tag: string },
  sendText: vi.fn(),
  guardarPrueba: vi.fn(),
  upsertFicha: vi.fn(),
  moverEtapa: vi.fn(),
  graphRequest: vi.fn(),
  descargarMeta: vi.fn(),
  credencialIa: vi.fn(),
  crearCita: vi.fn(),
  moverCita: vi.fn(),
  cancelarCita: vi.fn(),
}));

/* La base: responde según lo que pide el WHERE (solo `organization` y
 * `brain_deployment`, que son las de la puerta); todo lo demás, vacío. */
vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  const dialecto = new PgDialect();
  const nombre = (t: unknown) => {
    try {
      return getTableName(t as never);
    } catch {
      return String(t);
    }
  };
  const responder = (tabla: string, params: unknown[]): unknown[] => {
    if (tabla === "organization") {
      if (params.includes("clinica-a") || params.includes("org_A")) {
        return [{ id: "org_A", slug: "clinica-a", status: "activa", deploymentId: "brn_1" }];
      }
      if (params.includes("clinica-b") || params.includes("org_B")) {
        return [{ id: "org_B", slug: "clinica-b", status: "activa", deploymentId: "brn_1" }];
      }
      return [];
    }
    if (tabla === "brain_deployment" && h.secreto) return [{ ...h.secreto, status: "activo" }];
    return [];
  };
  const select = () => {
    let tabla = "";
    let params: unknown[] = [];
    const b: Record<string, unknown> = {
      from(t: unknown) {
        tabla = nombre(t);
        return b;
      },
      innerJoin: () => b,
      leftJoin: () => b,
      where(cond: SQL | undefined) {
        params = cond ? dialecto.sqlToQuery(cond).params : [];
        h.consultas.push({ tabla, params });
        return b;
      },
      orderBy: () => b,
      groupBy: () => b,
      limit: () => Promise.resolve(responder(tabla, params)),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(responder(tabla, params)).then(ok, ko),
    };
    return b;
  };
  const escribir = (op: string) => (t: unknown) => {
    h.escrituras.push({ op, tabla: nombre(t) });
    const fin = Object.assign(Promise.resolve([]), {
      returning: () => Promise.resolve([]),
      onConflictDoNothing: () => Promise.resolve([]),
    });
    return { values: () => fin, set: () => ({ where: () => fin }), where: () => fin };
  };
  const db = {
    select,
    insert: escribir("insert"),
    update: escribir("update"),
    delete: escribir("delete"),
    execute: () => Promise.resolve(),
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return { ...real, getDb: () => db };
});
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"), BETTER_AUTH_SECRET: "b".repeat(40) }),
}));
vi.mock("@/server/inbox/send", async (original) => ({
  ...(await original<typeof import("@/server/inbox/send")>()),
  sendText: h.sendText,
}));
vi.mock("@/server/lab/sandbox", () => ({ guardarRespuestaDePrueba: h.guardarPrueba }));
vi.mock("@/server/bot/ficha", async (original) => ({
  ...(await original<typeof import("@/server/bot/ficha")>()),
  upsertFicha: h.upsertFicha,
}));
vi.mock("@/server/bot/stage", async (original) => ({
  ...(await original<typeof import("@/server/bot/stage")>()),
  moverEtapaPorElCerebro: h.moverEtapa,
}));
vi.mock("@/lib/meta/client", async (original) => ({
  ...(await original<typeof import("@/lib/meta/client")>()),
  graphRequest: h.graphRequest,
}));
vi.mock("@/server/whatsapp/media", async (original) => ({
  ...(await original<typeof import("@/server/whatsapp/media")>()),
  downloadGraphMedia: h.descargarMeta,
}));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async (org: string) => ({ token: `token-de-${org}`, phoneNumberId: `pn-${org}` }),
}));
vi.mock("@/server/ai/credentials", async (original) => ({
  ...(await original<typeof import("@/server/ai/credentials")>()),
  getAiCredentialSecret: h.credencialIa,
  marcarEstadoPorRespuesta: vi.fn(),
}));
vi.mock("@/server/agenda/service", async (original) => ({
  ...(await original<typeof import("@/server/agenda/service")>()),
  createSessionBooking: h.crearCita,
  rescheduleForConversation: h.moverCita,
  cancelBooking: h.cancelarCita,
}));
vi.mock("@/server/modulos/consulta", async (original) => ({
  ...(await original<typeof import("@/server/modulos/consulta")>()),
  modulosDeOrganizacion: async () => ({ agenda: true, atribucion: false, channels: ["whatsapp"], modules: [] }),
}));

import { encryptSecret } from "@/lib/crypto";
import { resetRateLimit } from "@/lib/rate-limit";
import { credencialDerivada, invalidarCacheCerebro } from "@/server/brains/deployment";
import { firmarSeleccion } from "@/server/brains/seleccion";
import { BookingError } from "@/server/agenda/service";
import { GET as contexto } from "@/app/api/brains/context/route";
import { POST as mensajes } from "@/app/api/brains/messages/route";
import { PUT as ficha } from "@/app/api/brains/ficha/route";
import { POST as etapa } from "@/app/api/brains/stage/route";
import { POST as handoff } from "@/app/api/brains/handoff/route";
import { POST as typing } from "@/app/api/brains/typing/route";
import { GET as media } from "@/app/api/brains/media/[mediaId]/route";
import { POST as llm } from "@/app/api/brains/llm/[...ruta]/route";
import { GET as slots } from "@/app/api/brains/agenda/slots/route";
import { PATCH as moverCitaRuta, POST as reservar } from "@/app/api/brains/agenda/book/route";
import { GET as citas } from "@/app/api/brains/agenda/bookings/route";
import { POST as cancelar } from "@/app/api/brains/agenda/cancel/route";
import { POST as followup } from "@/app/api/brains/agenda/followup/route";

const BASE = "http://plataforma.test/api/brains";
const CRED_A = credencialDerivada(SECRETO, "org_A");

function req(metodo: string, ruta: string, cabeceraOrg: string, body?: unknown): Request {
  return new Request(`${BASE}/${ruta}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${CRED_A}`,
      "x-vocero-organization": cabeceraOrg,
      "x-forwarded-for": "10.0.0.1",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Cada ruta, pidiendo recursos de B. */
type Caso = { nombre: string; llamar: (org: string) => Promise<Response> };
const SELECCION_B = () => firmarSeleccion("org_B", { bookingId: "bk_B", conversationId: "cv_B", revision: 1 }, "b".repeat(40));
const CASOS: Caso[] = [
  { nombre: "GET context", llamar: (o) => contexto(req("GET", "context?conversationId=cv_B&contextVersion=2", o)) },
  { nombre: "POST messages", llamar: (o) => mensajes(req("POST", "messages", o, { dispatchId: "dsp_B", conversationId: "cv_B", text: "hola" })) },
  { nombre: "PUT ficha", llamar: (o) => ficha(req("PUT", "ficha", o, { conversationId: "cv_B", ficha: { nombre: "x" } })) },
  { nombre: "POST stage", llamar: (o) => etapa(req("POST", "stage", o, { conversationId: "cv_B", stage: "Calificado" })) },
  { nombre: "POST handoff", llamar: (o) => handoff(req("POST", "handoff", o, { conversationId: "cv_B", reason: "cliente" })) },
  { nombre: "POST typing", llamar: (o) => typing(req("POST", "typing", o, { conversationId: "cv_B" })) },
  { nombre: "GET media", llamar: (o) => media(req("GET", "media/wamid_B", o), { params: Promise.resolve({ mediaId: "wamid_B" }) }) },
  {
    nombre: "POST llm",
    llamar: (o) =>
      llm(req("POST", "llm/chat/completions", o, { model: "m", messages: [] }), {
        params: Promise.resolve({ ruta: ["chat", "completions"] }),
      }),
  },
  { nombre: "GET agenda/slots", llamar: (o) => slots(req("GET", "agenda/slots?conversationId=cv_B", o)) },
  { nombre: "POST agenda/book", llamar: (o) => reservar(req("POST", "agenda/book", o, { conversationId: "cv_B", startUtc: "2026-12-01T15:00:00Z" })) },
  { nombre: "PATCH agenda/book", llamar: (o) => moverCitaRuta(req("PATCH", "agenda/book", o, { conversationId: "cv_B", startUtc: "2026-12-01T15:00:00Z" })) },
  { nombre: "GET agenda/bookings", llamar: (o) => citas(req("GET", "agenda/bookings?conversationId=cv_B", o)) },
  {
    nombre: "POST agenda/cancel",
    llamar: (o) =>
      cancelar(req("POST", "agenda/cancel", o, { conversationId: "cv_B", selectionToken: SELECCION_B(), confirmation: true, idempotencyKey: "k".repeat(64) })),
  },
  { nombre: "POST agenda/followup", llamar: (o) => followup(req("POST", "agenda/followup", o, { conversationId: "cv_B", consent: true })) },
];

/**
 * Efectos que una petición con recursos de B nunca debe alcanzar. Reservar y
 * mover una cita NO están aquí: son servicios que filtran por su cuenta, y lo
 * que se comprueba es que se les pide A (`servicios que filtran`).
 */
const EFECTOS = () => [h.sendText, h.guardarPrueba, h.upsertFicha, h.graphRequest, h.descargarMeta, h.cancelarCita];

/** Las tablas de la puerta (se buscan por cabecera); el resto son del negocio. */
const TABLAS_DE_LA_PUERTA = new Set(["organization", "brain_deployment"]);

beforeEach(() => {
  h.consultas.length = 0;
  h.escrituras.length = 0;
  const e = encryptSecret(SECRETO);
  h.secreto = { cipher: e.cipher, iv: e.iv, tag: e.tag };
  invalidarCacheCerebro();
  resetRateLimit();
  vi.unstubAllEnvs();
  vi.stubEnv("TENANCY", "multi");
  for (const f of [...EFECTOS(), h.moverEtapa, h.credencialIa]) f.mockReset();
  h.credencialIa.mockResolvedValue(null);
  h.moverEtapa.mockResolvedValue({ ok: false, status: 404, code: "not_found", message: "Conversación no encontrada" });
  h.crearCita.mockRejectedValue(new BookingError("not_found", "Conversación no encontrada"));
  h.moverCita.mockRejectedValue(new BookingError("not_found", "No hay cita"));
});

describe("A ↛ B: la credencial de A presentándose como B", () => {
  it.each(CASOS.map((c) => [c.nombre, c] as const))("%s → 401 sin tocar nada del negocio", async (_n, caso) => {
    const r = await caso.llamar("clinica-b");
    expect(r.status).toBe(401);
    expect(h.consultas.filter((c) => !TABLAS_DE_LA_PUERTA.has(c.tabla))).toEqual([]);
    expect(h.escrituras).toEqual([]);
    for (const f of [...EFECTOS(), h.crearCita, h.moverCita, h.moverEtapa]) expect(f).not.toHaveBeenCalled();
    expect(h.credencialIa).not.toHaveBeenCalled();
  });
});

describe("A ↛ B: la credencial de A pidiendo recursos de B", () => {
  it.each(CASOS.map((c) => [c.nombre, c] as const))("%s → no los encuentra, no escribe, no hace efectos", async (nombre, caso) => {
    const r = await caso.llamar("clinica-a");
    // followup está dormido (409) para todos; el resto, «no existe» para A.
    const esperado = nombre === "POST agenda/followup" ? [409] : nombre === "POST llm" ? [402] : [404, 422];
    expect(esperado, `${nombre}: ${r.status}`).toContain(r.status);
    expect(h.escrituras).toEqual([]);
    for (const f of EFECTOS()) expect(f).not.toHaveBeenCalled();

    // El invariante: cada consulta a una tabla del negocio filtra por org_A y nunca por org_B.
    const delNegocio: Consulta[] = h.consultas.filter((c) => !TABLAS_DE_LA_PUERTA.has(c.tabla));
    for (const c of delNegocio) {
      expect(c.params, `${nombre} → ${c.tabla}`).toContain("org_A");
      expect(c.params, `${nombre} → ${c.tabla}`).not.toContain("org_B");
    }
    // Servicios que filtran por su cuenta: reciben A, nunca B.
    for (const llamada of h.moverEtapa.mock.calls) expect(llamada[0]).toMatchObject({ organizationId: "org_A" });
    for (const llamada of h.credencialIa.mock.calls) expect(llamada[0]).toBe("org_A");
    for (const llamada of [...h.crearCita.mock.calls, ...h.moverCita.mock.calls]) {
      expect(llamada[0]).toMatchObject({ organizationId: "org_A" });
    }
  });

  it("la llave de IA que se busca es SIEMPRE la de A", async () => {
    await CASOS.find((c) => c.nombre === "POST llm")!.llamar("clinica-a");
    expect(h.credencialIa.mock.calls).toEqual([["org_A"]]);
  });

  it("la reserva y el movimiento de cita se piden para A", async () => {
    await CASOS.find((c) => c.nombre === "POST agenda/book")!.llamar("clinica-a");
    await CASOS.find((c) => c.nombre === "PATCH agenda/book")!.llamar("clinica-a");
    // Los servicios mockeados no escriben; lo que importa es con qué organización se llaman.
    expect(h.crearCita.mock.calls[0]![0]).toMatchObject({ organizationId: "org_A", conversationId: "cv_B", requireOffer: true });
    expect(h.moverCita.mock.calls[0]![0]).toMatchObject({ organizationId: "org_A" });
  });
});

describe("cobertura: la matriz incluye cada ruta de /api/brains", () => {
  function rutas(dir: string): string[] {
    let out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) out = out.concat(rutas(p));
      else if (e === "route.ts") out.push(relative(join(process.cwd(), "src/app/api/brains"), p).split(sep).slice(0, -1).join("/"));
    }
    return out;
  }
  it("no hay una ruta nueva sin su caso A↛B", () => {
    const enDisco = rutas(join(process.cwd(), "src/app/api/brains")).sort();
    expect(enDisco).toEqual(
      [
        "agenda/book",
        "agenda/bookings",
        "agenda/cancel",
        "agenda/followup",
        "agenda/slots",
        "context",
        "ficha",
        "handoff",
        "llm/[...ruta]",
        "media/[mediaId]",
        "messages",
        "stage",
        "typing",
      ].sort()
    );
  });
});
