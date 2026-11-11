import { describe, expect, it } from "vitest";
import {
  crearSuperadmin,
  reiniciarSegundoFactor,
  SuperadminError,
  urlDelDueno,
  type SqlDelDueno,
} from "../../scripts/lib/superadmin";

/**
 * 076 (respuesta 8 de Andres) — El superadmin solo se da con la URL del dueño
 * de la base, en una transacción, y la contraseña nunca llega a la base (solo
 * su hash). La base es simulada: registra cada sentencia y sus valores.
 */
type Sentencia = { sql: string; valores: unknown[] };

function sqlFalso(respuestas: (s: string) => unknown[] = () => []) {
  const log: Sentencia[] = [];
  const eventos: string[] = [];
  const tag = (async (partes: TemplateStringsArray, ...valores: unknown[]) => {
    const texto = partes.join("?").replace(/\s+/g, " ").trim();
    log.push({ sql: texto, valores });
    return respuestas(texto);
  }) as unknown as SqlDelDueno;
  (tag as unknown as { begin: SqlDelDueno["begin"] }).begin = async (fn) => {
    eventos.push("begin");
    try {
      const r = await fn(tag);
      eventos.push("commit");
      return r;
    } catch (err) {
      eventos.push("rollback");
      throw err;
    }
  };
  return { sql: tag, log, eventos };
}

const deps = {
  id: () => "usr_super",
  idCuenta: () => "acc_super",
  contrasena: () => "contrasena-generada-24car",
  hash: async (p: string) => `hash(${p.length})`,
};

describe("076 — el comando del superadmin", () => {
  it("sin DATABASE_MIGRATIONS_URL no hace nada (nunca con la URL de la app)", () => {
    expect(() => urlDelDueno({ DATABASE_URL: "postgres://app@x/db" })).toThrow(SuperadminError);
    expect(urlDelDueno({ DATABASE_MIGRATIONS_URL: "postgres://dueno@x/db" })).toBe("postgres://dueno@x/db");
  });

  it("crea usuario, cuenta y superadministrador en UNA transacción", async () => {
    const { sql, log, eventos } = sqlFalso();
    const s = await crearSuperadmin(sql, { correo: " Andres@Aliantis.co ", nombre: "Andres" }, deps);
    expect(s).toEqual({ userId: "usr_super", correo: "andres@aliantis.co", contrasena: "contrasena-generada-24car" });
    expect(eventos).toEqual(["begin", "commit"]);
    expect(log.map((l) => l.sql.split(" (")[0])).toEqual([
      'select id from "user" where email = ? limit 1',
      'insert into "user"',
      "insert into account",
      "insert into superadministrador",
    ]);
    // Nunca miembro de un negocio.
    expect(log.some((l) => /member/.test(l.sql))).toBe(false);
  });

  it("la contraseña en claro no llega a la base: solo su hash", async () => {
    const { sql, log } = sqlFalso();
    await crearSuperadmin(sql, { correo: "a@b.co", nombre: "A" }, deps);
    const todo = JSON.stringify(log);
    expect(todo).not.toContain("contrasena-generada-24car");
    expect(todo).toContain("hash(25)");
  });

  it("un correo que ya existe (de un negocio o no): error y nada escrito", async () => {
    const { sql, log, eventos } = sqlFalso((s) => (s.startsWith("select id from") ? [{ id: "usr_x" }] : []));
    await expect(crearSuperadmin(sql, { correo: "dueno@negocio.co", nombre: "X" }, deps)).rejects.toMatchObject({
      codigo: "correo_existente",
    });
    expect(eventos).toEqual(["begin", "rollback"]);
    expect(log.some((l) => l.sql.startsWith("insert"))).toBe(false);
  });

  it("datos inválidos: error antes de abrir la transacción", async () => {
    const { sql, eventos } = sqlFalso();
    await expect(crearSuperadmin(sql, { correo: "no-es-correo", nombre: "" }, deps)).rejects.toMatchObject({
      codigo: "datos_invalidos",
    });
    expect(eventos).toEqual([]);
  });

  it("reiniciar el segundo factor: borra el TOTP, lo apaga, quita la marca y cierra sesiones", async () => {
    const { sql, log, eventos } = sqlFalso((s) => (s.includes("join superadministrador") ? [{ id: "usr_super" }] : []));
    await reiniciarSegundoFactor(sql, "Andres@Aliantis.co");
    expect(eventos).toEqual(["begin", "commit"]);
    expect(log.map((l) => l.sql.split(" where")[0])).toEqual([
      'select u.id from "user" u join superadministrador s on s.user_id = u.id',
      "delete from two_factor",
      'update "user" set two_factor_enabled = false',
      "update superadministrador set totp_activado_en = null",
      "delete from session",
    ]);
    expect(log[0]!.valores).toEqual(["andres@aliantis.co"]);
  });

  it("reiniciar a alguien que no es superadmin: error y nada tocado", async () => {
    const { sql, log, eventos } = sqlFalso();
    await expect(reiniciarSegundoFactor(sql, "dueno@negocio.co")).rejects.toMatchObject({
      codigo: "no_es_superadmin",
    });
    expect(eventos).toEqual(["begin", "rollback"]);
    expect(log).toHaveLength(1);
  });
});
