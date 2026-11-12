import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENTOS_ETAPA } from "@/lib/eventos-etapa";
import { ETAPAS_INICIALES } from "@/server/auth/alta";

/**
 * 078 (T2, D18 de Aliantis) — El mapeo evento → etapa en la base: solo en
 * etapas abiertas, uno por evento en cada negocio, del catálogo, y el mapeo
 * por defecto. La prueba de verdad es contra Postgres real (`e2e-rls`).
 */
const SQL = readFileSync(
  path.resolve(__dirname, "../../drizzle/0035_etapa_por_eventos.sql"),
  "utf8"
);

describe("078 — la migración del mapeo", () => {
  it("solo etapas abiertas (CHECK en la base, no solo en la interfaz)", () => {
    expect(SQL).toMatch(/CHECK \("pipeline_stage"\."evento_bot" is null or "pipeline_stage"\."kind" = 'open'\)/);
  });

  it("un evento por negocio (índice único parcial)", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX "stage_org_evento_uq" ON "pipeline_stage" USING btree \("organization_id","evento_bot"\) WHERE "pipeline_stage"\."evento_bot" is not null/
    );
  });

  it("el CHECK del catálogo tiene los mismos eventos que el código", () => {
    const lista = SQL.match(/"evento_bot" in \(([^)]*)\)/)?.[1] ?? "";
    expect(lista.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...EVENTOS_ETAPA]);
  });

  it("el mapeo por defecto de los negocios que ya existen: solo abiertas y sin pisar uno que ya exista", () => {
    const relleno = SQL.slice(SQL.indexOf("UPDATE"));
    expect(relleno).toContain(`('En conversación', 'primera_respuesta'), ('Interesado', 'servicio_consultado')`);
    expect(relleno).toContain(`st."kind" = 'open'`);
    expect(relleno).toContain("NOT EXISTS");
    expect(relleno).toContain(`s."evento_bot" IS NULL`);
    expect(relleno).not.toContain("pidio_cita");
  });
});

describe("078 — el alta siembra el mapeo", () => {
  it("«En conversación» y «Interesado»; pidio_cita sin etapa; nunca en ganada ni perdida", () => {
    const mapeo = Object.fromEntries(
      ETAPAS_INICIALES.filter((e) => e.eventoBot).map((e) => [e.eventoBot, e.name])
    );
    expect(mapeo).toEqual({ primera_respuesta: "En conversación", servicio_consultado: "Interesado" });
    expect(ETAPAS_INICIALES.filter((e) => e.eventoBot).every((e) => e.kind === "open")).toBe(true);
  });
});
