import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildJudgePrompt } from "@/server/ai/prompts";
import { lineaTrasTurno } from "@/server/lab/runner";

const chatJson = vi.fn();

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

import {
  frenarVeredicto,
  judgeCase,
  LINEA_SILENCIO,
  LINEA_TRASPASO,
  type VerdictType,
} from "@/server/lab/judge";

/**
 * 085 (bloque P4 de Aliantis) — El juez alucinó un traspaso en `sin_rumbo`
 * (corrida run_vee0rkncq62se39z1b2q del Preview): el bot se despidió y calló,
 * y salió rojo con `derivo_sin_necesidad`. El traspaso es un hecho del CRM:
 * el código frena lo imposible.
 */

const SIN_RUMBO = [
  { role: "cliente" as const, text: "Hola" },
  { role: "agente" as const, text: "¡Hola! 😊 ¿En qué te ayudo?" },
  { role: "cliente" as const, text: "ok" },
  { role: "agente" as const, text: "¡Con gusto! Aquí estamos si necesitas algo más 😊" },
  { role: "cliente" as const, text: "jaja" },
  { role: "sistema" as const, text: LINEA_SILENCIO },
];
const CON_TRASPASO = [
  { role: "cliente" as const, text: "Quiero hablar con una persona" },
  { role: "sistema" as const, text: `${LINEA_TRASPASO} (motivo: pide_persona).` },
];

const hallazgo = (tipo: VerdictType["hallazgos"][number]["tipo"]) => ({
  tipo,
  evidencia: "cita",
});

describe("085 — freno del veredicto (D2)", () => {
  it("CA-1 sin traspaso, derivo_sin_necesidad se descarta y el caso queda verde", () => {
    const frenado = frenarVeredicto(
      { veredicto: "rojo", hallazgos: [hallazgo("derivo_sin_necesidad")] },
      SIN_RUMBO
    );
    expect(frenado).toEqual({ veredicto: "verde", hallazgos: [] });
  });

  it("CA-1 con traspaso, derivo_sin_necesidad se queda", () => {
    const verdict: VerdictType = {
      veredicto: "rojo",
      hallazgos: [hallazgo("derivo_sin_necesidad")],
    };
    expect(frenarVeredicto(verdict, CON_TRASPASO)).toEqual(verdict);
  });

  it("CA-2 con traspaso, debio_escalar se descarta", () => {
    expect(
      frenarVeredicto({ veredicto: "amarillo", hallazgos: [hallazgo("debio_escalar")] }, CON_TRASPASO)
    ).toEqual({ veredicto: "verde", hallazgos: [] });
  });

  it("CA-2 sin traspaso, debio_escalar se queda", () => {
    const verdict: VerdictType = { veredicto: "rojo", hallazgos: [hallazgo("debio_escalar")] };
    expect(frenarVeredicto(verdict, SIN_RUMBO)).toEqual(verdict);
  });

  it("CA-2 si quedan otros hallazgos, el veredicto del juez no cambia", () => {
    expect(
      frenarVeredicto(
        {
          veredicto: "rojo",
          hallazgos: [hallazgo("derivo_sin_necesidad"), hallazgo("alucinacion")],
        },
        SIN_RUMBO
      )
    ).toEqual({ veredicto: "rojo", hallazgos: [hallazgo("alucinacion")] });
  });

  it("un amarillo sin hallazgos que descartar no cambia", () => {
    const verdict: VerdictType = { veredicto: "amarillo", hallazgos: [hallazgo("tono")] };
    expect(frenarVeredicto(verdict, SIN_RUMBO)).toBe(verdict);
  });
});

describe("085 — judgeCase aplica el freno y lleva la persona (D1)", () => {
  beforeEach(() => chatJson.mockReset());

  it("el veredicto que guarda ya está frenado", async () => {
    chatJson.mockResolvedValue({
      ok: true,
      data: { veredicto: "rojo", hallazgos: [hallazgo("derivo_sin_necesidad")] },
      raw: "{}",
    });
    const outcome = await judgeCase({
      personaKey: "sin_rumbo",
      personaDescription: "Solo manda relleno: el bot se despide una vez y deja de perseguir.",
      transcript: SIN_RUMBO,
      kbText: "",
      behaviorText: "",
    });
    expect(outcome).toEqual({ status: "done", verdict: { veredicto: "verde", hallazgos: [] } });
    const user = (chatJson.mock.calls[0]![1] as { role: string; content: string }[])[1]!.content;
    expect(user).toContain(
      "PERSONA SIMULADA: sin_rumbo — Solo manda relleno: el bot se despide una vez y deja de perseguir."
    );
  });
});

describe("085 — el prompt del juez (D3, CA-3)", () => {
  const { system } = buildJudgePrompt({
    persona: "sin_rumbo — Solo manda relleno",
    transcript: SIN_RUMBO,
    kbText: "",
    behaviorText: "",
  });

  it("solo hay traspaso si una línea SISTEMA lo dice", () => {
    expect(system).toContain("Sin esa línea, NO marques derivo_sin_necesidad");
  });

  it("el silencio tras despedirse es correcto, no un traspaso", () => {
    expect(system).toContain(`«SISTEMA: ${LINEA_SILENCIO}» es un silencio, no un traspaso`);
    expect(system).toMatch(/callar ante relleno.*es correcto/s);
  });

  it("no repetir el aviso es la regla aprobada", () => {
    expect(system).toContain("no repetirlo ni «recordarlo» es la regla aprobada");
  });

  it("evalúa contra lo que se espera de la persona", () => {
    expect(system).toContain("La PERSONA SIMULADA dice qué se espera");
  });
});

describe("085 — el silencio en la transcripción (D4, CA-4)", () => {
  it("calló: la línea SISTEMA del silencio", () => {
    expect(lineaTrasTurno({ falla: null, silencio: true }, false)).toEqual({
      role: "sistema",
      text: LINEA_SILENCIO,
    });
  });

  it("contestó o traspasó: ninguna línea", () => {
    expect(lineaTrasTurno({ falla: null, silencio: false }, true)).toBeNull();
    expect(lineaTrasTurno({ falla: null, silencio: false }, false)).toBeNull();
  });

  it("una respuesta que llegó tarde gana sobre el silencio", () => {
    expect(lineaTrasTurno({ falla: null, silencio: true }, true)).toBeNull();
  });

  it("una falla no es un silencio", () => {
    expect(lineaTrasTurno({ falla: "no recibió el despacho" }, false)).toBeNull();
  });
});
