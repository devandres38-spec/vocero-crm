import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 070 — Bloque 3, F6: la agenda de un cerebro. El 404 VACÍO de la agenda
 * apagada (la sonda `cv_sonda` de Nea), la cita anidada, y `bookings` /
 * `cancel` con la forma v2 (selección firmada, confirmación, idempotencia),
 * más `followup` dormido.
 */

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  agenda: true,
  requireBrain: vi.fn(),
  crearCita: vi.fn(),
  cancelarCita: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ BETTER_AUTH_SECRET: "b".repeat(40) }),
}));
vi.mock("@/server/brains/auth", () => ({ requireBrain: h.requireBrain }));
vi.mock("@/server/modulos/consulta", async (original) => ({
  ...(await original<typeof import("@/server/modulos/consulta")>()),
  modulosDeOrganizacion: async () => ({ agenda: h.agenda, atribucion: false, channels: ["whatsapp"], modules: [] }),
}));
vi.mock("@/server/agenda/service", async (original) => ({
  ...(await original<typeof import("@/server/agenda/service")>()),
  createSessionBooking: h.crearCita,
  cancelBooking: h.cancelarCita,
}));
vi.mock("@/server/agenda/settings", async (original) => ({
  ...(await original<typeof import("@/server/agenda/settings")>()),
  getSettings: async () => ({ timezone: "America/Bogota", maxDaysAhead: 7 }),
}));
vi.mock("@/server/region", async (original) => ({
  ...(await original<typeof import("@/server/region")>()),
  localeDeOrganizacion: async () => "es-CO",
}));

import { firmarSeleccion, leerSeleccion } from "@/server/brains/seleccion";
import { GET as slots } from "@/app/api/brains/agenda/slots/route";
import { POST as reservar } from "@/app/api/brains/agenda/book/route";
import { GET as citas } from "@/app/api/brains/agenda/bookings/route";
import { POST as cancelar } from "@/app/api/brains/agenda/cancel/route";
import { POST as followup } from "@/app/api/brains/agenda/followup/route";

const fake = () => h.fake!;
const BASE = "http://plataforma.test/api/brains/agenda";
const SECRETO = "b".repeat(40);
const REVISION = Date.UTC(2026, 10, 18, 9, 0, 0);

function post(ruta: string, body: unknown): Request {
  return new Request(`${BASE}/${ruta}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  fake().reiniciar();
  h.agenda = true;
  for (const f of [h.requireBrain, h.crearCita, h.cancelarCita]) f.mockReset();
  h.requireBrain.mockResolvedValue({ ok: true, ambito: { organizationId: "org_A", slug: "clinica", deploymentId: "brn_1" } });
});

describe("la sonda de Nea: 404 vacío = no agenda; 404 con sobre = sí agenda", () => {
  it("módulo agenda apagado EN ESTE negocio → 404 vacío en todas las rutas", async () => {
    h.agenda = false;
    const rs = await Promise.all([
      slots(new Request(`${BASE}/slots?conversationId=cv_sonda`)),
      reservar(post("book", { conversationId: "cv_1", startUtc: "2026-12-01T15:00:00Z" })),
      citas(new Request(`${BASE}/bookings?conversationId=cv_1`)),
      cancelar(post("cancel", {})),
      followup(post("followup", {})),
    ]);
    for (const r of rs) {
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("");
    }
  });

  it("encendido, la conversación inventada `cv_sonda` → 404 CON sobre", async () => {
    fake().responder(schema.conversation, []);
    const r = await slots(new Request(`${BASE}/slots?conversationId=cv_sonda`));
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("sin credencial válida, la puerta responde antes (no se mira el módulo)", async () => {
    h.requireBrain.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await slots(new Request(`${BASE}/slots?conversationId=cv_sonda`))).status).toBe(401);
  });
});

describe("reservar", () => {
  it("201 con la cita ANIDADA ({ok, booking}), solo lo ofrecido", async () => {
    h.crearCita.mockResolvedValue({ booking: { id: "bk_1" }, meetingLink: null, linkPending: false, label: "mar 1 dic, 10:00" });
    const r = await reservar(post("book", { conversationId: "cv_1", startUtc: "2026-12-01T15:00:00Z", idempotencyKey: "x".repeat(64) }));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({
      ok: true,
      booking: { id: "bk_1", bookingId: "bk_1", meetingLink: null, linkPending: false, label: "mar 1 dic, 10:00" },
    });
    expect(h.crearCita.mock.calls[0]![0]).toMatchObject({ organizationId: "org_A", requireOffer: true, source: "ai" });
  });
});

describe("selección firmada (agenda v2)", () => {
  it("atada a la organización: la de B no se lee con A, y alterada tampoco", () => {
    const t = firmarSeleccion("org_A", { bookingId: "bk_1", conversationId: "cv_1", revision: 5 }, SECRETO);
    expect(leerSeleccion("org_A", t, SECRETO)).toEqual({ bookingId: "bk_1", conversationId: "cv_1", revision: 5 });
    expect(leerSeleccion("org_B", t, SECRETO)).toBeNull();
    expect(leerSeleccion("org_A", t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), SECRETO)).toBeNull();
    expect(leerSeleccion("org_A", "basura", SECRETO)).toBeNull();
  });

  it("GET bookings: las citas vigentes del contacto, con token, etiqueta y revisión", async () => {
    fake().responder(schema.conversation, [{ id: "cv_1", contactId: "ct_1" }]);
    fake().responder(schema.booking, [
      { id: "bk_1", scheduledAt: new Date("2026-12-01T15:00:00Z"), updatedAt: new Date(REVISION) },
    ]);
    const r = await citas(new Request(`${BASE}/bookings?conversationId=cv_1`));
    const d = (await r.json()) as { bookings: { selectionToken: string; label: string; startUtc: string; revision: number }[] };
    expect(r.status).toBe(200);
    expect(d.bookings).toHaveLength(1);
    expect(d.bookings[0]).toMatchObject({ startUtc: "2026-12-01T15:00:00.000Z", revision: REVISION });
    expect(d.bookings[0]!.label).toMatch(/10:00/);
    expect(leerSeleccion("org_A", d.bookings[0]!.selectionToken, SECRETO)).toEqual({
      bookingId: "bk_1",
      conversationId: "cv_1",
      revision: REVISION,
    });
  });
});

const CONV_ACTIVA = { aiEnabled: true, handoffAt: null };

describe("cancelar", () => {
  const token = () => firmarSeleccion("org_A", { bookingId: "bk_1", conversationId: "cv_1", revision: REVISION }, SECRETO);
  const cuerpo = (extra: Record<string, unknown> = {}) => ({
    conversationId: "cv_1",
    selectionToken: token(),
    confirmation: true,
    idempotencyKey: "i".repeat(64),
    ...extra,
  });

  it("sin confirmación explícita → 409 confirmation_required", async () => {
    const r = await cancelar(post("cancel", cuerpo({ confirmation: false })));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: { code: "confirmation_required" } });
    expect(h.cancelarCita).not.toHaveBeenCalled();
  });

  it("la cita cambió desde que se listó → 409 stale_selection", async () => {
    fake().responder(schema.conversation, [CONV_ACTIVA]);
    fake().responder(schema.brainOperation, []);
    fake().responder(schema.booking, [{ id: "bk_1", status: "agendada", updatedAt: new Date(REVISION + 1000) }]);
    const r = await cancelar(post("cancel", cuerpo()));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: { code: "stale_selection" } });
    expect(h.cancelarCita).not.toHaveBeenCalled();
  });

  it("token de otra conversación → 404", async () => {
    fake().responder(schema.brainOperation, []);
    const r = await cancelar(post("cancel", cuerpo({ conversationId: "cv_otra" })));
    expect(r.status).toBe(404);
  });

  it("cancela, y guarda el resultado por idempotencyKey", async () => {
    fake().responder(schema.conversation, [CONV_ACTIVA]);
    fake().responder(schema.brainOperation, []);
    fake().responder(schema.booking, [{ id: "bk_1", status: "agendada", updatedAt: new Date(REVISION) }]);
    const r = await cancelar(post("cancel", cuerpo()));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, bookingId: "bk_1" });
    expect(h.cancelarCita).toHaveBeenCalledWith({ organizationId: "org_A", bookingId: "bk_1" });
    expect(fake().de(schema.brainOperation, "insert")[0]!.valores).toMatchObject({
      organizationId: "org_A",
      idempotencyKey: "i".repeat(64),
      action: "cancel",
    });
  });

  it("repetir la misma idempotencyKey devuelve lo mismo sin volver a cancelar", async () => {
    fake().responder(schema.conversation, [CONV_ACTIVA]);
    fake().responder(schema.brainOperation, [{ response: { ok: true, bookingId: "bk_1" }, action: "cancel" }]);
    const r = await cancelar(post("cancel", cuerpo()));
    expect(await r.json()).toEqual({ ok: true, bookingId: "bk_1" });
    expect(h.cancelarCita).not.toHaveBeenCalled();
  });
});

describe("followup dormido (D8)", () => {
  it("409 followup_not_allowed", async () => {
    const r = await followup(post("followup", { conversationId: "cv_1", consent: true }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: { code: "followup_not_allowed" } });
  });
});
