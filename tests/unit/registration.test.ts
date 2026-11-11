import { describe, expect, it } from "vitest";
import { bloqueoDeRuta } from "@/server/auth/registration";
import {
  VARIABLES_RETIRADAS,
  variablesRetiradas,
} from "@/server/doctor/checks";

/** 074 (pilar 1) — Nadie se registra solo: ni con la instalación vacía ni con `ALLOW_SIGNUP`. */
describe("registro público cerrado siempre", () => {
  it("el registro público se rechaza (403), haya o no negocios", () => {
    expect(bloqueoDeRuta("/sign-up/email", false)).toMatchObject({
      status: "FORBIDDEN",
    });
  });

  it("el alta interna (cuenta de equipo, `crearNegocio`) pasa", () => {
    expect(bloqueoDeRuta("/sign-up/email", true)).toBeNull();
  });

  it("`ALLOW_SIGNUP=true` ya no abre nada", () => {
    const antes = process.env.ALLOW_SIGNUP;
    process.env.ALLOW_SIGNUP = "true";
    try {
      expect(bloqueoDeRuta("/sign-up/email", false)).toMatchObject({
        status: "FORBIDDEN",
      });
    } finally {
      if (antes === undefined) delete process.env.ALLOW_SIGNUP;
      else process.env.ALLOW_SIGNUP = antes;
    }
  });

  it("el inicio de sesión y lo demás de Better Auth no se tocan", () => {
    expect(bloqueoDeRuta("/sign-in/email", false)).toBeNull();
    expect(bloqueoDeRuta("/get-session", false)).toBeNull();
    expect(bloqueoDeRuta("/sign-out", false)).toBeNull();
  });

  it("las rutas del plugin `organization`, todas en 404, aun internas", () => {
    for (const p of [
      "/organization/create",
      "/organization/delete",
      "/organization/x-futura",
    ]) {
      expect(bloqueoDeRuta(p, false)).toMatchObject({ status: "NOT_FOUND" });
      expect(bloqueoDeRuta(p, true)).toMatchObject({ status: "NOT_FOUND" });
    }
    // Un prefijo parecido no es del plugin.
    expect(bloqueoDeRuta("/organizations-otra", false)).toBeNull();
  });

  it("el doctor avisa si `ALLOW_SIGNUP` sigue en el entorno", () => {
    expect(Object.keys(VARIABLES_RETIRADAS)).toContain("ALLOW_SIGNUP");
    expect(variablesRetiradas({ ALLOW_SIGNUP: "true" })).toEqual([
      expect.objectContaining({ status: "warn", label: "ALLOW_SIGNUP" }),
    ]);
    expect(variablesRetiradas({})).toEqual([]);
  });
});
