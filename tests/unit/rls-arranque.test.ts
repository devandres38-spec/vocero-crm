import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { decisionDeArranque, motivosParaNoArrancar } from "@/lib/db/rls-arranque";
// @ts-expect-error — módulo .mjs de los scripts, sin tipos
import { literal, planUsuarioApp, sentenciasUsuarioApp } from "../../scripts/lib/usuario-app.mjs";

/** 075 (D2, D6) — El usuario de la base: sin privilegios, o la app no arranca en producción. */
function sqlCon(fila: unknown) {
  return (async () => (fila ? [fila] : [])) as unknown as Sql;
}
const seguro = { rolsuper: false, rolbypassrls: false, dueno: false, sin_rls: [] };

describe("075 — motivos para no arrancar", () => {
  it("un usuario sin privilegios y todas las tablas con RLS: ninguno", async () => {
    expect(await motivosParaNoArrancar(sqlCon(seguro))).toEqual([]);
  });

  it("superusuario, BYPASSRLS, dueño y tablas sin RLS: cada uno cuenta", async () => {
    expect(
      await motivosParaNoArrancar(
        sqlCon({ rolsuper: true, rolbypassrls: true, dueno: true, sin_rls: ["contact", "message"] })
      )
    ).toEqual([
      "es superusuario",
      "tiene BYPASSRLS",
      "es dueño de las tablas",
      "tablas de negocio sin RLS: contact, message",
    ]);
  });

  it("solo BYPASSRLS ya basta", async () => {
    expect(await motivosParaNoArrancar(sqlCon({ ...seguro, rolbypassrls: true }))).toEqual(["tiene BYPASSRLS"]);
  });
});

describe("075 — decisión del arranque", () => {
  it("seguro: arranca en cualquier entorno", () => {
    expect(decisionDeArranque([], "production")).toBe("arrancar");
    expect(decisionDeArranque([], "development")).toBe("arrancar");
  });

  it("inseguro o sin revisar: en producción no arranca; fuera, avisa", () => {
    expect(decisionDeArranque(["tiene BYPASSRLS"], "production")).toBe("no_arrancar");
    expect(decisionDeArranque("sin_revisar", "production")).toBe("no_arrancar");
    expect(decisionDeArranque(["es superusuario"], "development")).toBe("avisar");
    expect(decisionDeArranque(["es superusuario"], undefined)).toBe("avisar");
  });
});

describe("075 — el usuario de la app que crea migrate.mjs", () => {
  const MIG = "postgresql://postgres:dueno-clave@db:5432/vocero";

  it("sin separar (mismo usuario, o falta una URL): nada", () => {
    expect(planUsuarioApp(MIG, MIG)).toBeNull();
    expect(planUsuarioApp(MIG, undefined)).toBeNull();
  });

  it("separado: el usuario y la clave de DATABASE_URL", () => {
    expect(planUsuarioApp("postgresql://vocero:clave-larga-123@db:5432/vocero", MIG)).toEqual({
      usuario: "vocero",
      clave: "clave-larga-123",
    });
  });

  it("nombres raros o claves cortas: error claro, sin la clave", () => {
    expect(() => planUsuarioApp('postgresql://"x";drop:clave-larga-123@db/v', MIG)).toThrow(/minúsculas/);
    expect(() => planUsuarioApp("postgresql://vocero:corta@db/v", MIG)).toThrow(/12 caracteres/);
  });

  it("no existe: CREATE ROLE sin privilegios y miembro de vocero_app", () => {
    const s = sentenciasUsuarioApp({ usuario: "vocero", clave: "c'lave-larga" }, null);
    expect(s[0]).toBe(
      `CREATE ROLE "vocero" LOGIN PASSWORD 'c''lave-larga' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
    );
    expect(s[1]).toBe('GRANT vocero_app TO "vocero"');
  });

  it("existe sin privilegios: se pone al día (le quita BYPASSRLS si lo tuviera)", () => {
    const s = sentenciasUsuarioApp({ usuario: "vocero", clave: "clave-larga-123" }, { privilegiado: false });
    expect(s[0]).toMatch(/^ALTER ROLE "vocero" LOGIN PASSWORD .* NOSUPERUSER NOBYPASSRLS/);
  });

  it("existe con privilegios (por ejemplo, postgres): no se toca", () => {
    expect(sentenciasUsuarioApp({ usuario: "postgres", clave: "x".repeat(12) }, { privilegiado: true })).toEqual([]);
  });

  it("literal escapa comillas", () => {
    expect(literal("a'b")).toBe("'a''b'");
  });
});
