import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 076 — Las acciones del panel: la contraseña del alta o del restablecimiento
 * se devuelve UNA vez y no va a ningún otro lado (ni al registro, ni a la
 * base en claro, ni a un log). Y los errores de las funciones se traducen.
 */
const h = vi.hoisted(() => ({
  anotado: [] as unknown[],
  restablecido: [] as unknown[],
  fallarAnotar: false,
}));
vi.mock("@/server/auth/alta", async (orig) => ({
  ...(await orig<typeof import("@/server/auth/alta")>()),
  crearNegocio: async () => ({
    organizationId: "org_nuevo",
    userId: "usr_dueno",
    slug: "clinica",
    nombre: "Clínica",
    correo: "dueno@clinica.co",
    contrasena: "CONTRASENA-SECRETA-DEL-ALTA",
  }),
}));
vi.mock("@/server/panel/datos", () => ({
  anotarEnElPanel: async (...a: unknown[]) => {
    if (h.fallarAnotar) throw new Error("sin base");
    h.anotado.push(a);
  },
  restablecerDesdeElPanel: async (...a: unknown[]) => {
    h.restablecido.push(a);
  },
}));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => ({}) }));

import { errorDelPanel, restablecerContrasena } from "@/server/panel/acciones";
import { altaDesdeElPanel } from "@/server/panel/alta";

let registrado: string[];
beforeEach(() => {
  h.anotado = [];
  h.restablecido = [];
  h.fallarAnotar = false;
  registrado = [];
  for (const nivel of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => {
      registrado.push(a.map(String).join(" "));
    });
  }
});

describe("076 — el alta desde el panel", () => {
  it("devuelve la contraseña y la anota en el registro SIN ella", async () => {
    const n = await altaDesdeElPanel("usr_andres", { nombre: "Clínica", correo: "dueno@clinica.co", duenoNombre: "D" });
    expect(n.contrasena).toBe("CONTRASENA-SECRETA-DEL-ALTA");
    expect(h.anotado).toEqual([["alta_negocio", "org_nuevo", { correo: "dueno@clinica.co", nombre: "Clínica" }]]);
    expect(JSON.stringify(h.anotado)).not.toContain("SECRETA");
    expect(registrado.join("\n")).not.toContain("SECRETA");
  });

  it("si no se puede anotar, el negocio ya existe: se devuelve igual y el log no lleva la contraseña", async () => {
    h.fallarAnotar = true;
    const n = await altaDesdeElPanel("usr_andres", { nombre: "Clínica", correo: "dueno@clinica.co", duenoNombre: "D" });
    expect(n.organizationId).toBe("org_nuevo");
    expect(registrado.join("\n")).toContain("org_nuevo");
    expect(registrado.join("\n")).not.toContain("SECRETA");
  });
});

describe("076 — restablecer una contraseña", () => {
  it("la base recibe el hash, nunca la contraseña", async () => {
    const c = await restablecerContrasena("org_1", "usr_1", {
      contrasena: () => "OTRA-SECRETA",
      hash: async (p) => `hash:${p.length}`,
    });
    expect(c).toBe("OTRA-SECRETA");
    expect(h.restablecido).toEqual([["org_1", "usr_1", "hash:12"]]);
    expect(registrado.join("\n")).not.toContain("OTRA-SECRETA");
  });

  it("por defecto, 24 caracteres", async () => {
    const c = await restablecerContrasena("org_1", "usr_1", { hash: async () => "h" });
    expect(c).toHaveLength(24);
  });
});

describe("076 — errores de las funciones del panel", () => {
  it("se leen del error o de su causa (Drizzle lo envuelve)", () => {
    expect(errorDelPanel({ code: "P0002" })).toBe("no_encontrado");
    expect(errorDelPanel({ cause: { code: "23514" } })).toBe("ultimo_dueno");
    expect(errorDelPanel(new Error("otro"))).toBeNull();
  });
});
