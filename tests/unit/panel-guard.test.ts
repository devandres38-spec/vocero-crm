import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

import { decidirPanel, SESION_MAXIMA_DEL_PANEL_MS, type DatosDelGuard } from "@/server/panel/guard";
import { destinoDeLaPagina, mismoOrigen, respuestaDelGuard } from "@/server/panel/ruta";
import { secretoDe } from "@/server/panel/segundo-factor";

/**
 * 076 (D16) — Quién entra al panel de Andres: sesión, superadmin, segundo
 * factor activado, sesión posterior a activarlo y de menos de 12 h.
 */
const ahora = new Date("2026-11-11T15:00:00Z");
const activado = new Date("2026-11-11T09:00:00Z");
const usuario = { id: "usr_andres", name: "Andres", email: "andres@aliantis.co", twoFactorEnabled: true };

function datos(cambios: Partial<DatosDelGuard> = {}): DatosDelGuard {
  return {
    sesion: { creadaEn: new Date("2026-11-11T10:00:00Z"), usuario },
    superadmin: { totpActivadoEn: activado },
    ahora,
    ...cambios,
  };
}

describe("076 — el guard del panel", () => {
  it("todo en orden: entra", () => {
    expect(decidirPanel(datos())).toEqual({
      tipo: "ok",
      superadmin: { userId: "usr_andres", nombre: "Andres", correo: "andres@aliantis.co" },
    });
  });

  it("sin sesión", () => {
    expect(decidirPanel(datos({ sesion: null })).tipo).toBe("sin_sesion");
  });

  it("una cuenta de un negocio (no está en superadministrador): el panel no existe", () => {
    expect(decidirPanel(datos({ superadmin: null })).tipo).toBe("no_es");
  });

  it("superadmin sin el segundo factor activado: solo la pantalla para activarlo", () => {
    const sinFactor = datos({ sesion: { creadaEn: ahora, usuario: { ...usuario, twoFactorEnabled: false } } });
    expect(decidirPanel(sinFactor).tipo).toBe("sin_segundo_factor");
    const sinMarca = datos({ superadmin: { totpActivadoEn: null } });
    expect(decidirPanel(sinMarca).tipo).toBe("sin_segundo_factor");
  });

  it("una sesión de ANTES de activar el segundo factor no sirve", () => {
    const vieja = datos({ sesion: { creadaEn: new Date("2026-11-11T08:59:59Z"), usuario } });
    expect(decidirPanel(vieja).tipo).toBe("sesion_vieja");
  });

  it("más de 12 h: no sirve (respuesta 6 de Andres)", () => {
    const creada = new Date(ahora.getTime() - SESION_MAXIMA_DEL_PANEL_MS - 1000);
    const larga = datos({ sesion: { creadaEn: creada, usuario }, superadmin: { totpActivadoEn: new Date(0) } });
    expect(decidirPanel(larga).tipo).toBe("sesion_vieja");
    expect(SESION_MAXIMA_DEL_PANEL_MS).toBe(12 * 60 * 60 * 1000);
  });
});

describe("076 — qué responde una ruta o una página del panel", () => {
  it("rutas: 404 a quien no es, 403 sin segundo factor, 401 sin sesión o vieja", () => {
    const s = { userId: "u", nombre: "n", correo: "c" };
    expect(respuestaDelGuard({ tipo: "ok", superadmin: s })).toBeNull();
    expect(respuestaDelGuard({ tipo: "no_es" })?.status).toBe(404);
    expect(respuestaDelGuard({ tipo: "sin_segundo_factor", superadmin: s })?.status).toBe(403);
    expect(respuestaDelGuard({ tipo: "sin_sesion" })?.status).toBe(401);
    expect(respuestaDelGuard({ tipo: "sesion_vieja" })?.status).toBe(401);
  });

  it("páginas: cada estado a su lugar", () => {
    const s = { userId: "u", nombre: "n", correo: "c" };
    expect(destinoDeLaPagina({ tipo: "ok", superadmin: s })).toBe("pasa");
    expect(destinoDeLaPagina({ tipo: "sin_segundo_factor", superadmin: s })).toBe("/admin/segundo-factor");
    expect(destinoDeLaPagina({ tipo: "no_es" })).toBe("404");
    expect(destinoDeLaPagina({ tipo: "sesion_vieja" })).toBe("/api/admin/salir");
    expect(destinoDeLaPagina({ tipo: "sin_sesion" })).toBe("/login");
  });

  it("la pantalla del segundo factor: solo sin él; con él, al panel", () => {
    const s = { userId: "u", nombre: "n", correo: "c" };
    const o = { esSegundoFactor: true };
    expect(destinoDeLaPagina({ tipo: "sin_segundo_factor", superadmin: s }, o)).toBe("pasa");
    expect(destinoDeLaPagina({ tipo: "ok", superadmin: s }, o)).toBe("/admin");
    expect(destinoDeLaPagina({ tipo: "no_es" }, o)).toBe("404");
  });

  it("mutaciones solo desde el mismo origen", () => {
    const de = (method: string, origin?: string) =>
      new Request("https://crm.aliantis.co/api/admin/negocios", {
        method,
        headers: origin ? { origin } : {},
      });
    expect(mismoOrigen(de("GET"))).toBe(true);
    expect(mismoOrigen(de("POST", "https://crm.aliantis.co"))).toBe(true);
    expect(mismoOrigen(de("POST", "https://malo.example"))).toBe(false);
    expect(mismoOrigen(de("POST"))).toBe(false);
    expect(mismoOrigen(de("DELETE", "https://crm.aliantis.co.malo.example"))).toBe(false);
  });

  it("el secreto sale del otpauth://", () => {
    expect(secretoDe("otpauth://totp/Aliantis:andres@aliantis.co?secret=ABC234&issuer=Aliantis")).toBe("ABC234");
    expect(secretoDe("no es una url")).toBe("");
  });
});
