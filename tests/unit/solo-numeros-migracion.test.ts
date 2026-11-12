import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 079 (T3) — «Solo estos números» en la base: apagada y vacía por defecto
 * (nadie cambia de comportamiento al actualizar) y máximo 50 números. La
 * prueba de verdad es contra Postgres real (`e2e-rls`).
 */
const SQL = readFileSync(path.resolve(__dirname, "../../drizzle/0036_solo_numeros.sql"), "utf8");

describe("079 — la migración de la lista", () => {
  it("apagada por defecto y NOT NULL", () => {
    expect(SQL).toContain(
      `ALTER TABLE "agent_profile" ADD COLUMN "solo_numeros_activo" boolean DEFAULT false NOT NULL;`
    );
  });

  it("la lista vacía por defecto y NOT NULL", () => {
    expect(SQL).toContain(
      `ALTER TABLE "agent_profile" ADD COLUMN "solo_numeros" text[] DEFAULT '{}'::text[] NOT NULL;`
    );
  });

  it("máximo 50 números (CHECK en la base, no solo en la ruta)", () => {
    expect(SQL).toMatch(/CHECK \(cardinality\("agent_profile"\."solo_numeros"\) <= 50\)/);
  });

  it("solo toca agent_profile: no crea tabla nueva (la RLS ya la cubre)", () => {
    expect(SQL).not.toMatch(/CREATE TABLE/);
    const tablas = [...SQL.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(tablas)).toEqual(new Set(["agent_profile"]));
  });
});
