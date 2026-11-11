import { describe, expect, it, vi } from "vitest";

/**
 * 076 (D16) — Contra la instancia REAL de Better Auth: del plugin `twoFactor`
 * solo quedan abiertas por HTTP las dos verificaciones del código. Activar,
 * desactivar, ver el secreto, regenerar códigos y el OTP por correo, en 404:
 * el segundo factor del superadmin solo lo reinicia el comando, con la llave
 * del dueño de la base. Y nunca «confiar en este dispositivo».
 */
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => ({}),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "s".repeat(48),
  }),
}));

import { getAuth } from "@/lib/auth";
import { bloqueoDeRuta, DOS_FACTORES_ABIERTAS, pideConfiarDispositivo } from "@/server/auth/registration";

type Endpoint = { path?: string };

function rutasDelSegundoFactor(): string[] {
  return Object.values(getAuth().api as unknown as Record<string, Endpoint>)
    .map((e) => e?.path)
    .filter((p): p is string => typeof p === "string" && p.startsWith("/two-factor/"));
}

let ip = 0;
async function pedir(path: string, cuerpo: Record<string, unknown> = { code: "123456", password: "x" }) {
  ip += 1;
  return getAuth().handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.2.${ip}` },
      body: JSON.stringify(cuerpo),
    })
  );
}

describe("076 — las rutas del segundo factor", () => {
  it("el plugin registra sus rutas (si no, esta prueba no probaría nada)", () => {
    const rutas = rutasDelSegundoFactor();
    expect(rutas).toEqual(expect.arrayContaining(["/two-factor/enable", "/two-factor/disable", "/two-factor/verify-totp"]));
  });

  it("todas, menos verificar el código, responden 404 por HTTP (enable también)", async () => {
    const abiertas: string[] = [];
    for (const path of rutasDelSegundoFactor()) {
      // Lista fija aquí, no la del código: si alguien abre otra, esta prueba lo ve.
      if (path === "/two-factor/verify-totp" || path === "/two-factor/verify-backup-code") continue;
      const r = await pedir(path);
      if (r.status !== 404) abiertas.push(`${path} → ${r.status}`);
    }
    expect(abiertas).toEqual([]);
  });

  it("verificar el código sigue abierto (sin cookie del primer paso: 401, no 404)", async () => {
    expect([...DOS_FACTORES_ABIERTAS].sort()).toEqual(["/two-factor/verify-backup-code", "/two-factor/verify-totp"]);
    for (const path of DOS_FACTORES_ABIERTAS) {
      const r = await pedir(path, { code: "123456" });
      expect(r.status, path).not.toBe(404);
    }
  });

  it("pedir «confiar en este dispositivo» se rechaza (400)", async () => {
    const r = await pedir("/two-factor/verify-totp", { code: "123456", trustDevice: true });
    expect(r.status).toBe(400);
  });

  it("la regla: enable solo por dentro; una ruta nueva nace cerrada", () => {
    expect(bloqueoDeRuta("/two-factor/enable", false)?.status).toBe("NOT_FOUND");
    expect(bloqueoDeRuta("/two-factor/enable", true)).toBeNull();
    expect(bloqueoDeRuta("/two-factor/disable", true)?.status).toBe("NOT_FOUND");
    expect(bloqueoDeRuta("/two-factor/una-ruta-del-futuro", true)?.status).toBe("NOT_FOUND");
    expect(bloqueoDeRuta("/two-factor/verify-totp", false)).toBeNull();
    expect(bloqueoDeRuta("/two-factor/verify-backup-code", false)).toBeNull();
  });

  it("confiar en el dispositivo: cualquier valor que no sea false cuenta", () => {
    expect(pideConfiarDispositivo("/two-factor/verify-totp", { trustDevice: true })).toBe(true);
    expect(pideConfiarDispositivo("/two-factor/verify-backup-code", { trustDevice: "si" })).toBe(true);
    expect(pideConfiarDispositivo("/two-factor/verify-totp", { trustDevice: false })).toBe(false);
    expect(pideConfiarDispositivo("/two-factor/verify-totp", { code: "1" })).toBe(false);
    expect(pideConfiarDispositivo("/sign-in/email", { trustDevice: true })).toBe(false);
  });
});
