import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * Auditoría 071 — regresiones del CRM.
 *
 * M-3: la UI del dueño y del formulario de la plataforma no nombra a «Nea»
 * (marca blanca Aliantis), ni en los ejemplos de URL.
 * B-4: el Blueprint guarda las herramientas como Ajustes → Agente
 * (`herramientasEfectivas`) y reaplicarlas en otro orden no cambia nada.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});

import { aplicarAgente } from "@/server/platform/blueprint/secciones/agente";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

/** El código sin comentarios: lo que puede terminar en pantalla. */
function visible(archivo: string): string {
  return readFileSync(path.join(RAIZ, archivo), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("M-3 — sin «Nea» visible en la UI del negocio", () => {
  for (const archivo of [
    "src/lib/brain-status.ts",
    "src/components/agent/brain-status-card.tsx",
    "src/components/agent/agent-client.tsx",
    "src/components/plataforma/formulario/pestana-agente.tsx",
    "src/app/(platform)/platform/organizaciones/[id]/page.tsx",
  ]) {
    it(archivo, () => {
      const texto = visible(archivo);
      expect(texto).not.toMatch(/\bNea\b/);
      expect(texto).not.toMatch(/nea:8000/);
    });
  }
});

describe("B-4 — herramientas del Blueprint normalizadas", () => {
  const fake = () => h.fake!;
  beforeEach(() => fake().reiniciar());

  const perfil = {
    id: "agp_1",
    name: "Sofía",
    tone: null,
    role: "calificador",
    tools: ["ficha", "agendar", "escalar"],
    instructions: null,
    escalationRules: null,
    greeting: null,
    treatment: "tu",
    stallEnabled: true,
  };

  it("se guardan con `escalar` y en el orden del catálogo", async () => {
    fake().responder(schema.agentProfile, [{ ...perfil, tools: null }]);
    const cambio = await aplicarAgente(fake().db as never, "org_A", { tools: ["agendar", "ficha"] });
    expect(cambio).toBe(true);
    expect(fake().de(schema.agentProfile, "update")[0]?.valores).toMatchObject({
      tools: ["ficha", "agendar", "escalar"],
    });
  });

  it("reaplicarlas en otro orden o sin `escalar` no cambia nada", async () => {
    fake().responder(schema.agentProfile, [perfil]);
    expect(await aplicarAgente(fake().db as never, "org_A", { tools: ["agendar", "ficha"] })).toBe(false);
    expect(fake().de(schema.agentProfile, "update")).toEqual([]);
  });
});
