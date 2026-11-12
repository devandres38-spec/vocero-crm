import { describe, expect, it, vi } from "vitest";

/**
 * 076 (pendiente del bloque G, respuesta 3 de Andres) — «Mi cuenta»: cambiar
 * la propia contraseña (mínimo 12), cerrar las demás sesiones y limpiar
 * «debe cambiarla». La ruta HTTP `/change-password` de Better Auth queda
 * cerrada: el único camino es este, que limpia la marca.
 */
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => ({}),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ APP_BASE_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "s".repeat(48) }),
}));

import { getAuth } from "@/lib/auth";
import { bloqueoDeRuta } from "@/server/auth/registration";
import { cambiarContrasena, validarNueva } from "@/server/auth/cuenta";

const h = new Headers();
const conSesion = async () => ({ userId: "usr_1" });

describe("076 — cambiar la contraseña", () => {
  it("la nueva: al menos 12, no más de 128 y distinta de la actual", () => {
    expect(validarNueva("vieja-123456", "corta")).toMatchObject({ status: 422, codigo: "corta" });
    expect(validarNueva("misma-misma-1", "misma-misma-1")).toMatchObject({ codigo: "igual" });
    expect(validarNueva("vieja", "x".repeat(129))).toMatchObject({ codigo: "larga" });
    expect(validarNueva("vieja", "una-frase-larga-y-propia")).toBeNull();
  });

  it("bien: cierra las demás sesiones, limpia la marca y devuelve la cookie nueva", async () => {
    const marcar = vi.fn(async () => {});
    const cambiar = vi.fn(async () => new Response("{}", { status: 200, headers: { "Set-Cookie": "sesion=nueva" } }));
    const r = await cambiarContrasena(h, "vieja-contrasena", "una-frase-larga-y-propia", {
      sesion: conSesion,
      cambiar,
      marcar,
    });
    expect(r).toEqual({ ok: true, cookies: ["sesion=nueva"] });
    expect(cambiar).toHaveBeenCalledWith(h, "vieja-contrasena", "una-frase-larga-y-propia");
    expect(marcar).toHaveBeenCalledWith("usr_1");
  });

  it("la actual equivocada: error y la marca sigue", async () => {
    const marcar = vi.fn(async () => {});
    const r = await cambiarContrasena(h, "equivocada-123", "una-frase-larga-y-propia", {
      sesion: conSesion,
      cambiar: async () => new Response("{}", { status: 400 }),
      marcar,
    });
    expect(r).toMatchObject({ ok: false, status: 400, codigo: "actual" });
    expect(marcar).not.toHaveBeenCalled();
  });

  it("sin sesión: 401 sin tocar nada", async () => {
    const cambiar = vi.fn();
    const r = await cambiarContrasena(h, "vieja-contrasena", "una-frase-larga-y-propia", {
      sesion: async () => null,
      cambiar,
    });
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(cambiar).not.toHaveBeenCalled();
  });

  it("una nueva corta ni siquiera llega a Better Auth", async () => {
    const cambiar = vi.fn();
    const r = await cambiarContrasena(h, "vieja", "corta", { sesion: conSesion, cambiar });
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(cambiar).not.toHaveBeenCalled();
  });
});

describe("076 — /change-password por HTTP, cerrada", () => {
  it("la regla: solo por dentro", () => {
    expect(bloqueoDeRuta("/change-password", false)?.status).toBe("NOT_FOUND");
    expect(bloqueoDeRuta("/change-password", true)).toBeNull();
  });

  it("contra la instancia real de Better Auth: 404", async () => {
    const r = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.3.1" },
        body: JSON.stringify({ currentPassword: "a", newPassword: "una-frase-larga-y-propia" }),
      })
    );
    expect(r.status).toBe(404);
  });
});
