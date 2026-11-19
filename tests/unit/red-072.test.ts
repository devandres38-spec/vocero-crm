import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 072 (A0) — Red de seguridad ANTES de tocar nada: lo que ve hoy un negocio
 * sin Vertical Pack ni campos de ficha, congelado. El Motor Multi-Nicho es
 * aditivo; si una de estas se pone roja, la 072 cambió algo que no debía.
 *
 * No se relajan: un negocio de 2.11.0 sigue viendo exactamente esto.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});

import { appNavGroups, settingsSections } from "@/lib/nav";
import { escribirFicha } from "@/server/bot/nucleo/acciones";

const plano = (grupos: ReturnType<typeof appNavGroups>) =>
  grupos.map((g) => ({
    title: g.title ?? null,
    items: g.items.map((i) => [i.href, i.label, i.badge === true]),
  }));

const MENU_2_11 = (agenda: boolean, configura: boolean) => [
  {
    title: "Trabajo",
    items: [
      ["/inbox", "Bandeja", true],
      ["/pipeline", "Pipeline", false],
      ["/contacts", "Contactos", false],
      ...(agenda ? [["/bookings", "Citas", false]] : []),
    ],
  },
  {
    title: "Agente",
    items: [
      ...(configura ? [["/onboarding", "Guía de inicio", false]] : []),
      ["/agent", "Agente", false],
      ["/lab", "Laboratorio", false],
    ],
  },
  { title: null, items: [["/results", "Resultados", false]] },
];

describe("072 A0 — el menú de un negocio sin pack es el de 2.11.0", () => {
  for (const agenda of [false, true]) {
    for (const role of ["owner", "admin", "member", null]) {
      it(`agenda=${agenda}, rol=${role}`, () => {
        const configura = role === "owner" || role === "admin";
        expect(plano(appNavGroups({ agenda, role }))).toEqual(MENU_2_11(agenda, configura));
      });
    }
  }

  it("Ajustes con todo encendido", () => {
    expect(
      settingsSections({ agenda: true, atribucion: true, instagram: true, messenger: true, tiktok: true }).map((s) => [
        s.title,
        s.links.map((l) => l.href),
      ])
    ).toEqual([
      ["Canales", ["/settings/channels", "/settings/whatsapp", "/settings/instagram", "/settings/messenger", "/settings/tiktok"]],
      // 072 A3 (T027): «Ficha» es la única entrada nueva de Ajustes, a propósito.
      ["Agente", ["/settings/ai", "/settings/calendar", "/settings/ficha"]],
      [
        "Negocio",
        [
          "/settings/branding",
          "/settings/appearance",
          "/settings/templates",
          "/settings/quick-replies",
          "/settings/team",
          "/settings/ads",
        ],
      ],
    ]);
  });
});

describe("072 A0 — la ficha sin esquema responde byte a byte como en 2.11.0", () => {
  beforeEach(() => h.fake!.reiniciar());

  const put = (body: unknown) =>
    new Request("http://x/api/brains/ficha", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("merge, `null` borra y la respuesta es solo `{ficha}`", async () => {
    h.fake!.responder(schema.conversation, [{ contactId: "ct_1", aiEnabled: true, handoffAt: null }]);
    h.fake!.responder(schema.contact, [{ ficha: { rubro: "salud", viejo: "x" } }]);
    const res = await escribirFicha(
      put({ conversationId: "cv_1", ficha: { presupuesto: 50000, viejo: null, vacio: "", raro: { a: 1 } } }),
      "org_1",
      { exigirIa: true }
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ficha":{"rubro":"salud","presupuesto":50000}}');
    const [escrito] = h.fake!.de(schema.contact, "update");
    expect(escrito!.valores.ficha).toEqual({ rubro: "salud", presupuesto: 50000 });
  });

  it("IA en pausa sigue siendo 409 `ai_paused`", async () => {
    h.fake!.responder(schema.conversation, [{ contactId: "ct_1", aiEnabled: false, handoffAt: null }]);
    const res = await escribirFicha(put({ conversationId: "cv_1", ficha: { a: 1 } }), "org_1", { exigirIa: true });
    expect(res.status).toBe(409);
  });
});
