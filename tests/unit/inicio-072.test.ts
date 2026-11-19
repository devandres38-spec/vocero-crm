import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 072 (A2) — Menú, vocabulario e Inicio por nicho. Lo de un negocio `default`
 * está congelado en `red-072.test.ts`; aquí, lo que cambia con un pack.
 */

const h = vi.hoisted(() => ({
  getSessionOrNull: vi.fn(),
  guideFirst: vi.fn(),
  experienciaDe: vi.fn(),
  sinResponder: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (p: string) => {
    throw new Error(`redirect:${p}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSessionOrNull: h.getSessionOrNull }));
vi.mock("@/server/onboarding/guide", () => ({ guideFirst: h.guideFirst }));
vi.mock("@/server/verticals/experiencia", () => ({ experienciaDe: h.experienciaDe }));
vi.mock("@/server/inicio/widgets", async (original) => ({
  ...(await original<typeof import("@/server/inicio/widgets")>()),
  sinResponder: h.sinResponder,
}));

import Home from "@/app/page";
import InicioPage from "@/app/(app)/inicio/page";
import { Widget, widgetsVisibles, type ContextoWidget } from "@/components/inicio/widgets";
import { appNavGroups, ICONOS_NAV } from "@/lib/nav";
import { proximosPorFecha, rangoDeHoy, siguienteDia } from "@/server/inicio/widgets";
import { EXPERIENCIA_DEFAULT, resolverExperiencia } from "@/verticals/resolver";
import { VOCABULARIO_BASE } from "@/verticals/vocabulario";

const labels = (g: ReturnType<typeof appNavGroups>) => g.map((x) => x.items.map((i) => i.label));

describe("menú por pack", () => {
  it("`default` resuelto da el mismo menú que sin experiencia", () => {
    for (const agenda of [false, true]) {
      const sin = appNavGroups({ agenda, role: "owner" });
      const con = appNavGroups({ agenda, role: "owner", experiencia: EXPERIENCIA_DEFAULT });
      expect(con.map((g) => g.items.map((i) => [i.href, i.label, i.icon]))).toEqual(
        sin.map((g) => g.items.map((i) => [i.href, i.label, i.icon]))
      );
    }
  });

  it("clínica: Inicio primero, vocabulario de clínica y Valoraciones antes del pipeline", () => {
    const g = appNavGroups({ agenda: true, role: "member", experiencia: resolverExperiencia("clinica-salud", null) });
    expect(labels(g)).toEqual([
      ["Inicio", "Bandeja", "Valoraciones", "Pacientes en proceso", "Pacientes"],
      ["Agente", "Laboratorio"],
      ["Resultados"],
    ]);
    expect(g[0]!.items.find((i) => i.href === "/contacts")!.icon).toBe(ICONOS_NAV.salud);
  });

  it("eventos sin agenda: sin Visitas, con Solicitudes y Clientes", () => {
    const g = appNavGroups({ agenda: false, role: "member", experiencia: resolverExperiencia("eventos-mobiliario", null) });
    expect(labels(g)[0]).toEqual(["Inicio", "Bandeja", "Solicitudes", "Clientes"]);
  });

  it("un negocio oculta Resultados (su grupo desaparece) pero nunca la Bandeja", () => {
    const exp = resolverExperiencia("clinica-salud", { nav: { ocultas: ["/results", "/inbox", "/no-existe"] } });
    const g = appNavGroups({ agenda: false, role: "member", experiencia: exp });
    expect(g.flatMap((x) => x.items.map((i) => i.href))).not.toContain("/results");
    expect(g.flatMap((x) => x.items.map((i) => i.href))).toContain("/inbox");
    expect(g).toHaveLength(2);
  });
});

describe("la raíz con pack", () => {
  const owner = { userId: "u", organizationId: "org_1", role: "owner" };
  beforeEach(() => {
    h.getSessionOrNull.mockReset();
    h.guideFirst.mockReset();
    h.experienciaDe.mockReset();
  });

  it("con Inicio en el pack y la guía completa, a /inicio", async () => {
    h.getSessionOrNull.mockResolvedValue(owner);
    h.guideFirst.mockResolvedValue(false);
    h.experienciaDe.mockResolvedValue(resolverExperiencia("clinica-salud", null));
    await expect(Home()).rejects.toThrow("redirect:/inicio");
    expect(h.experienciaDe).toHaveBeenCalledWith("org_1");
  });

  it("la guía pendiente gana sobre el Inicio", async () => {
    h.getSessionOrNull.mockResolvedValue(owner);
    h.guideFirst.mockResolvedValue(true);
    h.experienciaDe.mockResolvedValue(resolverExperiencia("clinica-salud", null));
    await expect(Home()).rejects.toThrow("redirect:/onboarding");
  });

  it("`default`: a la Bandeja como en 2.11.0", async () => {
    h.getSessionOrNull.mockResolvedValue(owner);
    h.guideFirst.mockResolvedValue(false);
    h.experienciaDe.mockResolvedValue(EXPERIENCIA_DEFAULT);
    await expect(Home()).rejects.toThrow("redirect:/inbox");
  });

  it("/inicio no existe para un negocio sin Inicio", async () => {
    h.getSessionOrNull.mockResolvedValue(owner);
    h.experienciaDe.mockResolvedValue(EXPERIENCIA_DEFAULT);
    await expect(InicioPage()).rejects.toThrow("notFound");
  });
});

describe("widgets", () => {
  const ctx: ContextoWidget = {
    organizationId: "org_1",
    vocabulario: VOCABULARIO_BASE,
    locale: "es-CO",
    timezone: "America/Bogota",
    agenda: false,
  };

  it("sin agenda no hay `citas_de_hoy`; los de módulo esperan a la 072-B", () => {
    expect(
      widgetsVisibles([{ tipo: "citas_de_hoy" }, { tipo: "sin_responder" }, { tipo: "mobiliario.cotizaciones" }], false)
    ).toEqual([{ tipo: "sin_responder" }]);
    expect(widgetsVisibles([{ tipo: "citas_de_hoy" }], true)).toEqual([{ tipo: "citas_de_hoy" }]);
  });

  it("un widget que falla se pinta como aviso y no tumba la página", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.sinResponder.mockRejectedValue(new Error("base caída"));
    const el = (await Widget({ w: { tipo: "sin_responder" }, ctx })) as { props: { titulo: string } };
    expect(el.props.titulo).toBe("No se pudo cargar");
    err.mockRestore();
  });

  it("el día del negocio en Bogotá, no el del servidor", () => {
    const r = rangoDeHoy(new Date("2026-11-19T03:00:00Z"), "America/Bogota")!;
    expect(r.hoy).toBe("2026-11-18");
    expect(r.desde.toISOString()).toBe("2026-11-18T05:00:00.000Z");
    expect(r.hasta.toISOString()).toBe("2026-11-19T05:00:00.000Z");
    expect(siguienteDia("2026-12-31")).toBe("2027-01-01");
    expect(siguienteDia("2026-11-19", 30)).toBe("2026-12-19");
  });

  it("`proximos_por_fecha` con una clave inválida ni consulta", async () => {
    expect(await proximosPorFecha("org_1", "x'); drop table contact;--", "America/Bogota")).toEqual([]);
  });
});

describe("guardarraíl: las consultas del Inicio son de UNA organización", () => {
  const code = readFileSync(path.resolve(import.meta.dirname, "..", "..", "src", "server", "inicio", "widgets.ts"), "utf8");

  it("cada `.where(` recibe `scoped(…)` (o el `alcance` que ya lo es)", () => {
    const froms = code.match(/\.from\(/g)?.length ?? 0;
    const wheres = [...code.matchAll(/\.where\(\s*([a-z]+)/g)].map((m) => m[1]);
    expect(froms).toBeGreaterThan(0);
    expect(wheres).toHaveLength(froms);
    for (const w of wheres) expect(["scoped", "alcance"]).toContain(w);
    expect(code).toMatch(/const alcance = scoped\(/);
  });

  it("el campo de la ficha viaja como parámetro, nunca interpolado como texto", () => {
    expect(code).not.toMatch(/sql\.raw/);
    expect(code).toContain("->> ${campo}");
  });
});
