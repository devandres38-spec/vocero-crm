import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PerfilPrivacidad } from "@/server/privacy/perfil";
import {
  filaDesdePerfil,
  perfilDePrivacidad,
} from "@/server/privacy/repositorio";
import { baseFalsa, type FilaPerfil } from "./fixtures/base-privacidad-falsa";

/**
 * 068 — Leer el perfil de privacidad de un negocio (D3, historias 3 y 5):
 * el perfil o nada, nunca un perfil vacío, y nunca el de otro negocio.
 */
const vectores = JSON.parse(
  readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8")
) as { perfiles: Record<string, PerfilPrivacidad> };
const dental = vectores.perfiles["dental-co"]!;
const barberia = vectores.perfiles["sin-salud-us"]!;

function fila(organizationId: string, perfil: PerfilPrivacidad): FilaPerfil {
  return {
    id: `prv_${organizationId}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...filaDesdePerfil(organizationId, perfil),
    adjuntos: perfil.sensible === null,
    retencionDias: 90,
  };
}

type Db = Parameters<typeof perfilDePrivacidad>[1];
const comoDb = (db: unknown) => db as Db;

afterEach(() => vi.restoreAllMocks());

describe("068 — perfilDePrivacidad", () => {
  it("devuelve la política del negocio", async () => {
    const { db } = baseFalsa({
      organizaciones: ["org_a"],
      perfiles: [fila("org_a", dental)],
    });
    expect(await perfilDePrivacidad("org_a", comoDb(db))).toEqual({
      terms: dental.sensible,
      allowlist: dental.permitidos,
      country: "CO",
    });
  });

  it("sin perfil registrado devuelve null, nunca un perfil vacío", async () => {
    const { db } = baseFalsa({ organizaciones: ["org_a"] });
    expect(await perfilDePrivacidad("org_a", comoDb(db))).toBeNull();
  });

  it("con la salud apagada devuelve terms: null (y no se confunde con «no hay»)", async () => {
    const { db } = baseFalsa({
      organizaciones: ["org_b"],
      perfiles: [fila("org_b", barberia)],
    });
    expect(await perfilDePrivacidad("org_b", comoDb(db))).toMatchObject({
      terms: null,
      country: "US",
    });
  });

  it("una fila alterada en la base (huella que no cuadra) devuelve null y deja un log sin contenido", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const alterada = fila("org_a", dental);
    // Un término bien escrito: la fila pasa el esquema y solo la huella la delata.
    alterada.sensitiveTerms = {
      ...alterada.sensitiveTerms!,
      sintoma: ["terminosecretodeprueba"],
    };
    const { db } = baseFalsa({ organizaciones: ["org_a"], perfiles: [alterada] });
    expect(await perfilDePrivacidad("org_a", comoDb(db))).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    const registrado = JSON.stringify(error.mock.calls);
    expect(registrado).toContain("org_a");
    expect(registrado).toContain("huella");
    expect(registrado).not.toContain("terminosecretodeprueba");
    expect(registrado).not.toContain("muela");
  });

  it("una fila con un país inválido devuelve null", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mala = fila("org_a", dental);
    mala.country = "XX";
    const { db } = baseFalsa({ organizaciones: ["org_a"], perfiles: [mala] });
    expect(await perfilDePrivacidad("org_a", comoDb(db))).toBeNull();
  });

  it("dos negocios: cada uno recibe el suyo (la consulta lleva la organización)", async () => {
    const { db, consultas } = baseFalsa({
      organizaciones: ["org_a", "org_b"],
      perfiles: [fila("org_b", barberia), fila("org_a", dental)],
    });
    expect((await perfilDePrivacidad("org_a", comoDb(db)))?.country).toBe("CO");
    expect((await perfilDePrivacidad("org_b", comoDb(db)))?.country).toBe("US");
    expect(consultas).toHaveLength(2);
    for (const q of consultas) expect(q.sql).toContain("organization_id");
  });

  it("un negocio sin perfil no recibe el de otro", async () => {
    const { db } = baseFalsa({
      organizaciones: ["org_a", "org_b"],
      perfiles: [fila("org_b", barberia)],
    });
    expect(await perfilDePrivacidad("org_a", comoDb(db))).toBeNull();
  });
});
