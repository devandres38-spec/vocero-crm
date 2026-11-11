import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { huellaDePerfil, type PerfilPrivacidad } from "@/server/privacy/perfil";
import { sembrarPerfil } from "@/server/privacy/sembrar";
import { baseFalsa } from "./fixtures/base-privacidad-falsa";

/**
 * 068 — Registrar el perfil de privacidad de un negocio (historias 2 y 4):
 * solo un archivo válido, con su huella, y la salud apagada solo con la
 * bandera. Un rechazo no toca la base.
 */
const vectores = JSON.parse(
  readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8")
) as { perfiles: Record<string, PerfilPrivacidad> };
const dental = vectores.perfiles["dental-co"]!;
const barberia = vectores.perfiles["sin-salud-us"]!;
const dentalMx = vectores.perfiles["dental-mx"]!;

type Db = Parameters<typeof sembrarPerfil>[0];
const json = (v: unknown) => JSON.stringify(v, null, 2);

function sembrar(
  base: ReturnType<typeof baseFalsa>,
  contenido: string,
  extra: { organizationId?: string; sinFiltroSalud?: boolean } = {}
) {
  return sembrarPerfil(base.db as unknown as Db, {
    organizationId: extra.organizationId ?? "org_a",
    contenido,
    sinFiltroSalud: extra.sinFiltroSalud ?? false,
  });
}

describe("068 — sembrarPerfil", () => {
  it("registra el perfil exportado por el cerebro con su huella", async () => {
    const base = baseFalsa({ organizaciones: ["org_a"] });
    const r = await sembrar(base, json(dental));
    expect(r).toEqual({
      ok: true,
      perfil: "odontologia",
      versionPerfil: 1,
      pais: "CO",
      conSalud: true,
      huella: dental.huella,
      huellaAnterior: null,
      // 070 (D1): un perfil con salud no guarda adjuntos por defecto.
      adjuntos: false,
    });
    expect(base.perfiles).toHaveLength(1);
    expect(base.perfiles[0]).toMatchObject({
      organizationId: "org_a",
      fingerprint: dental.huella,
      allowlist: dental.permitidos,
      sensitiveTerms: dental.sensible,
    });
  });

  it("reemplaza el perfil anterior y muestra las dos huellas", async () => {
    const base = baseFalsa({ organizaciones: ["org_a"] });
    await sembrar(base, json(dental));
    const r = await sembrar(base, json(dentalMx));
    expect(r).toMatchObject({
      ok: true,
      huella: dentalMx.huella,
      huellaAnterior: dental.huella,
    });
    expect(base.perfiles).toHaveLength(1);
    expect(base.perfiles[0]?.country).toBe("MX");
  });

  it("rechaza un archivo editado a mano (la huella no cuadra) sin tocar la base", async () => {
    const base = baseFalsa({ organizaciones: ["org_a"] });
    const editado = {
      ...dental,
      sensible: { ...dental.sensible!, sintoma: ["duele"] },
    };
    const r = await sembrar(base, json(editado));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/huella/i);
    expect(base.escritos).toHaveLength(0);
  });

  it("rechaza la salud apagada sin --sin-filtro-salud, y la registra con ella", async () => {
    const base = baseFalsa({ organizaciones: ["org_b"] });
    const sin = await sembrar(base, json(barberia), { organizationId: "org_b" });
    expect(sin.ok).toBe(false);
    if (!sin.ok) expect(sin.error).toMatch(/--sin-filtro-salud/);
    expect(base.escritos).toHaveLength(0);

    const con = await sembrar(base, json(barberia), {
      organizationId: "org_b",
      sinFiltroSalud: true,
    });
    expect(con).toMatchObject({ ok: true, conSalud: false });
    expect(base.perfiles[0]?.sensitiveTerms).toBeNull();
  });

  it("rechaza una organización que no existe", async () => {
    const base = baseFalsa({ organizaciones: ["org_a"] });
    const r = await sembrar(base, json(dental), { organizationId: "org_x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/org_x/);
    expect(base.escritos).toHaveLength(0);
  });

  it("rechaza un archivo que no es JSON o no cumple el contrato", async () => {
    const base = baseFalsa({ organizaciones: ["org_a"] });
    expect((await sembrar(base, "{no es json")).ok).toBe(false);
    expect((await sembrar(base, json({ ...dental, extra: 1 }))).ok).toBe(false);
    const sinHuella = { ...dental, pais: "XX" };
    expect(
      (await sembrar(
        base,
        json({ ...sinHuella, huella: huellaDePerfil(sinHuella as PerfilPrivacidad) })
      )).ok
    ).toBe(false);
    expect(base.escritos).toHaveLength(0);
  });

  it("nunca devuelve los términos en el resultado ni en el error", async () => {
    const base = baseFalsa({ organizaciones: ["org_a"] });
    const bien = await sembrar(base, json(dental));
    const mal = await sembrar(
      base,
      json({ ...dental, sensible: { ...dental.sensible!, sintoma: ["muela-x"] } })
    );
    expect(JSON.stringify([bien, mal])).not.toMatch(/muela/);
  });
});

describe("068 — sembrarPerfilDemo", () => {
  it("registra el perfil dental de la demo, el mismo que exporta el cerebro", async () => {
    const { sembrarPerfilDemo } = await import("@/server/privacy/demo");
    const base = baseFalsa({ organizaciones: ["org_a"] });
    const r = await sembrarPerfilDemo(base.db as unknown as Db, "org_a");
    expect(r).toMatchObject({ ok: true, perfil: "odontologia", huella: dental.huella });
  });

  it("no pisa un perfil que ya existe (--force recarga la demo, no la privacidad)", async () => {
    const { sembrarPerfilDemo } = await import("@/server/privacy/demo");
    const base = baseFalsa({ organizaciones: ["org_a"] });
    await sembrar(base, json(dentalMx));
    const r = await sembrarPerfilDemo(base.db as unknown as Db, "org_a");
    expect(r).toEqual({ ok: true, yaTenia: true });
    expect(base.escritos).toHaveLength(1);
    expect(base.perfiles[0]?.country).toBe("MX");
  });
});
