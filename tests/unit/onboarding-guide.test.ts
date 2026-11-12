import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #86 — La guía de inicio: de los pasos verificados (`onboardingStatus`) a
 * lo que ve el dueño, y cuándo es la primera pantalla. Puerto de la prueba de
 * Vocero Cloud con los pasos de la raíz: aquí no hay modelo de plataforma,
 * dueño invitado, cerebro compartido ni cobertura.
 */

const onboardingStatus = vi.hoisted(() => vi.fn());
vi.mock("@/server/onboarding/status", () => ({ onboardingStatus }));

import { GUIA_DEL_PAR, guideFirst, guideFrom } from "@/server/onboarding/guide";
import type { ReadinessStep } from "@/server/onboarding/status";

const step = (
  key: ReadinessStep["key"],
  status: ReadinessStep["status"],
  extra: Partial<ReadinessStep> = {}
): ReadinessStep => ({
  key,
  label: key,
  status,
  nextAction: "",
  href: null,
  problem: null,
  ...extra,
});

const all = (overrides: Partial<Record<ReadinessStep["key"], ReadinessStep["status"]>> = {}) =>
  (["profile", "whatsapp", "brain", "calendar"] as const).map((k) =>
    step(k, overrides[k] ?? "ready", {
      nextAction:
        k === "profile"
          ? "Dale un nombre y escribe sus instrucciones o carga conocimiento del negocio"
          : "",
    })
  );

describe("guía de inicio", () => {
  it("son cuatro pasos en el orden pedido: agente, número, tu agente, agenda (080: sin IA)", () => {
    const guide = guideFrom({ steps: all(), enabled: false });
    expect(guide.steps.map((s) => s.key)).toEqual(["agent", "whatsapp", "brain", "calendar"]);
    expect(guide.steps.map((s) => s.href)).toEqual([
      "/agent",
      "/settings/whatsapp",
      GUIA_DEL_PAR,
      "/settings/calendar",
    ]);
    expect(guide).toMatchObject({ complete: true, enabled: false, brainConnected: true });
  });

  it("036 — «Conecta tu agente» es opcional: sin él la guía se completa (bandeja manual)", () => {
    const steps = all({ brain: "pending" });
    steps[2] = step("brain", "pending", { nextAction: "Levanta tu agente", problem: null });
    const guide = guideFrom({ steps, enabled: false });
    const brain = guide.steps.find((s) => s.key === "brain");
    expect(brain).toMatchObject({ done: false, optional: true, hint: "Levanta tu agente" });
    expect(guide).toMatchObject({ complete: true, brainConnected: false });
  });

  it("sin agenda en la instancia el paso desaparece (no se pinta «no aplica»)", () => {
    const guide = guideFrom({ steps: all({ calendar: "not_applicable" }), enabled: false });
    expect(guide.steps.map((s) => s.key)).toEqual(["agent", "whatsapp", "brain"]);
    expect(guide.complete).toBe(true);
  });

  it("el agente necesita perfil, y dice qué falta", () => {
    const sinPerfil = guideFrom({ steps: all({ profile: "pending" }), enabled: false });
    expect(sinPerfil.steps[0]?.done).toBe(false);
    expect(sinPerfil.steps[0]?.hint).toMatch(/nombre/);
    expect(sinPerfil.complete).toBe(false);
  });

  it("una conexión pendiente deja la guía incompleta", () => {
    for (const key of ["whatsapp", "calendar"] as const) {
      expect(guideFrom({ steps: all({ [key]: "pending" }), enabled: false }).complete, key).toBe(
        false
      );
    }
  });

  it("lo que está mal (token vencido, conector sin credencial) sale como pista", () => {
    const steps = all();
    steps[1] = step("whatsapp", "pending", { problem: "Meta dejó de aceptar el token." });
    steps[2] = step("brain", "pending", { problem: "Falta BOT_API_KEY." });
    steps[3] = step("calendar", "pending", { problem: "Elegiste Zoom pero no está conectado." });
    const guide = guideFrom({ steps, enabled: false });
    expect(guide.steps.map((s) => s.hint)).toEqual([
      null,
      "Meta dejó de aceptar el token.",
      "Falta BOT_API_KEY.",
      "Elegiste Zoom pero no está conectado.",
    ]);
    // Un conector desconocido también bloquea: no es «listo» ni «no aplica».
    steps[3] = step("calendar", "unsupported", { problem: "El conector no existe." });
    expect(guideFrom({ steps, enabled: false }).complete).toBe(false);
  });

  it("un paso listo no enseña pista aunque la tenga guardada", () => {
    const steps = all();
    steps[0] = step("profile", "ready", { nextAction: "Revisado" });
    expect(guideFrom({ steps, enabled: false }).steps[0]?.hint).toBeNull();
  });
});

describe("guideFirst: ¿la guía es la primera pantalla?", () => {
  beforeEach(() => onboardingStatus.mockReset());

  it("un miembro del equipo nunca la ve: no puede hacer ninguno de los pasos", async () => {
    expect(await guideFirst({ organizationId: "org_1", role: "member" })).toBe(false);
    expect(onboardingStatus).not.toHaveBeenCalled();
  });

  it("al dueño lo manda a la guía mientras falte un paso", async () => {
    onboardingStatus.mockResolvedValue({ steps: all({ whatsapp: "pending" }), enabled: false });
    expect(await guideFirst({ organizationId: "org_1", role: "owner" })).toBe(true);
  });

  it("…y también con todo listo pero el agente apagado: falta encenderlo", async () => {
    onboardingStatus.mockResolvedValue({ steps: all(), enabled: false });
    expect(await guideFirst({ organizationId: "org_1", role: "owner" })).toBe(true);
  });

  it("036 — una bandeja manual (sin cerebro) no se queda atrapada en la guía", async () => {
    onboardingStatus.mockResolvedValue({ steps: all({ brain: "pending" }), enabled: false });
    expect(await guideFirst({ organizationId: "org_1", role: "owner" })).toBe(false);
  });

  it("con todo listo y el agente encendido se entra a la Bandeja como siempre", async () => {
    onboardingStatus.mockResolvedValue({ steps: all(), enabled: true });
    expect(await guideFirst({ organizationId: "org_1", role: "owner" })).toBe(false);
    expect(await guideFirst({ organizationId: "org_1", role: "admin" })).toBe(false);
  });
});
