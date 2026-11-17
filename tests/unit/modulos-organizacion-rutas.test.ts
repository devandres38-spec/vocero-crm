import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import { modulosEfectivos } from "@/server/modulos/efectivos";

/**
 * 069 (US7) — La agenda y los canales responden por organización: con la
 * instancia encendida (techo), una organización que los apagó ve 404, igual
 * que una instancia sin la bandera.
 */

const mocks = vi.hoisted(() => ({ session: vi.fn(), getSettings: vi.fn() }));

vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.session,
}));
// El techo de canales de la instancia: WhatsApp e Instagram.
vi.mock("@/server/channels/enabled", async (original) => ({
  ...(await original<typeof import("@/server/channels/enabled")>()),
  isChannelEnabled: (c: string) => c === "whatsapp" || c === "instagram",
}));
vi.mock("@/server/agenda/settings", async (original) => ({
  ...(await original<typeof import("@/server/agenda/settings")>()),
  getSettings: mocks.getSettings,
}));

import { GET as agendaGET } from "@/app/api/calendar/settings/route";
import { GET as instagramGET } from "@/app/api/settings/instagram/route";
import { agendaActiva, canalActivo, modulosDe } from "@/server/modulos/consulta";

const techo = { agenda: true, atribucion: true, channels: new Set(["whatsapp", "instagram"] as const) };
const sesion = (modules: unknown): SessionContext => ({
  userId: "u1",
  organizationId: "org_A",
  role: "owner",
  modulos: modulosEfectivos({ ...techo, channels: new Set(techo.channels) }, modules),
});

beforeEach(() => {
  vi.stubEnv("AGENDA", "on");
  vi.stubEnv("CHANNELS", "whatsapp,instagram");
  mocks.getSettings.mockResolvedValue({ slotMinutes: 30 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("069 — módulos por organización en las rutas", () => {
  it("agenda heredada del techo → 200", async () => {
    mocks.session.mockResolvedValue(sesion(null));
    expect((await agendaGET()).status).toBe(200);
  });

  it("agenda apagada en la organización → 404 vacío, sin leer nada", async () => {
    mocks.session.mockResolvedValue(sesion({ agenda: false }));
    const res = await agendaGET();
    expect(res.status).toBe(404);
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("Instagram apagado en la organización → 404 aunque la instancia lo tenga", async () => {
    mocks.session.mockResolvedValue(sesion({ channels: ["whatsapp"] }));
    expect((await instagramGET()).status).toBe(404);
  });

  it("sin módulos en el contexto (armado a mano) → el techo, como en 2.8.0", () => {
    const s = { userId: "u", organizationId: "o", role: "owner" };
    expect(agendaActiva(s)).toBe(true);
    expect(canalActivo(s, "instagram")).toBe(true);
    expect(modulosDe(null).channels).toEqual(["whatsapp", "instagram"]);
  });

  it("A↛B: los módulos son del contexto de cada organización", () => {
    const a = sesion({ agenda: false });
    const b = { ...sesion(null), organizationId: "org_B" };
    expect(agendaActiva(a)).toBe(false);
    expect(agendaActiva(b)).toBe(true);
  });
});
