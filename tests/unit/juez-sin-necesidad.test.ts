import { describe, expect, it } from "vitest";
import { buildJudgePrompt } from "@/server/ai/prompts";
import { Verdict } from "@/server/lab/judge";

/**
 * 084 (bloque P3 de Aliantis) — Cada traspaso apaga al agente en esa
 * conversación. El juez marca el inverso de `debio_escalar`: pasar el chat al
 * equipo sin que hiciera falta. Y un dato faltante ya no es «responde una
 * persona»: el agente lo dice y ofrece pasar la pregunta.
 */
describe("084 — el juez ve el traspaso que no hacía falta", () => {
  const { system } = buildJudgePrompt({
    persona: "fuera_de_kb",
    transcript: [{ role: "cliente", text: "¿Tienen parqueadero?" }],
    kbText: "",
    behaviorText: "",
  });

  it("el veredicto acepta derivo_sin_necesidad", () => {
    const v = Verdict.parse({
      veredicto: "amarillo",
      hallazgos: [{ tipo: "derivo_sin_necesidad", evidencia: "SISTEMA: pasó a una persona" }],
    });
    expect(v.hallazgos[0]?.tipo).toBe("derivo_sin_necesidad");
  });

  it("el prompt explica cuándo un traspaso no hacía falta", () => {
    expect(system).toContain("derivo_sin_necesidad");
    expect(system).toMatch(/sin que hiciera falta.*→ derivo_sin_necesidad/s);
    expect(system).toContain("confirma que le pasen su pregunta");
  });

  it("con un dato faltante, lo correcto es decirlo y ofrecer pasar la pregunta", () => {
    expect(system).not.toContain("pasar a una persona es lo correcto: no es fuera_de_kb");
    expect(system).toContain("ofrecer pasar la pregunta al equipo");
  });
});
