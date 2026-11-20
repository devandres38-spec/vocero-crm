import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { esPlataforma } from "@/lib/tenancy";
import { buildJudgePrompt } from "@/server/ai/prompts";
import { registrarUsoLlm, usoDesdeRespuesta } from "@/server/llm-usage";

/** Veredicto estructurado del juez (FR-032, contrato ai.md). */
export const Verdict = z.object({
  veredicto: z.enum(["verde", "amarillo", "rojo"]),
  hallazgos: z.array(
    z.object({
      tipo: z.enum(["alucinacion", "fuera_de_kb", "debio_escalar", "tono"]),
      evidencia: z.string(),
      sugerencia: z
        .object({ pregunta: z.string(), respuesta: z.string() })
        .optional(),
    })
  ),
});

export type VerdictType = z.infer<typeof Verdict>;

export type JudgeOutcome =
  | { status: "done"; verdict: VerdictType }
  | { status: "judge_failed"; detail: string };

/**
 * UNA llamada del juez por conversación. Los reintentos viven dentro de
 * chatJson; si aun así la salida es inválida, el caso queda judge_failed —
 * visible en el reporte y excluido del score. La corrida continúa.
 */
export async function judgeCase(input: {
  /** De quién es la configuración de IA con la que juzga. */
  organizationId: string;
  personaKey: string;
  transcript: { role: "cliente" | "agente" | "sistema"; text: string }[];
  kbText: string;
  behaviorText: string;
}): Promise<JudgeOutcome> {
  const { system, user } = buildJudgePrompt({
    persona: input.personaKey,
    transcript: input.transcript,
    kbText: input.kbText,
    behaviorText: input.behaviorText,
  });
  const result = await chatJson(
    Verdict,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // 070 — En modo plataforma el juez paga con la llave del NEGOCIO, nunca
    // con la del entorno.
    {
      judge: true,
      organizationId: input.organizationId,
      soloOrganizacion: esPlataforma(),
      // 074 (D9, FR-15) — Un juez que cambia de opinión entre corridas no
      // mide nada: determinista.
      temperature: 0,
      // 074 (D9) — Lo que cuesta el juez, en `llm_usage` como `lab`.
      onUso: (u) =>
        void registrarUsoLlm({
          organizationId: input.organizationId,
          source: "lab",
          statusCode: u.status,
          latencyMs: u.latencyMs,
          ...usoDesdeRespuesta(u.cuerpo, u.model),
        }),
    }
  );
  if (!result.ok) {
    // Diagnóstico operativo: el caso queda visible como judge_failed y aquí
    // queda el porqué (incluye el raw= truncado del proveedor).
    console.error(
      `[lab] juez falló para ${input.personaKey}: ${result.error} — ${result.detail}`
    );
    return { status: "judge_failed", detail: result.detail };
  }
  return { status: "done", verdict: result.data };
}

/**
 * Score 0-100: % ponderado de conversaciones verdes (FR-033).
 * verde = 1 · amarillo = 0.5 · rojo = 0. judge_failed fuera del denominador.
 *
 * 2.13.1 — `agent_failed` SÍ cuenta, como 0: el agente no contestó, y eso es
 * lo peor que puede hacer. Antes quedaba fuera y 4 fallidos + 2 verdes daban
 * 100. El juez que falla sigue fuera: no es culpa del agente.
 */
export function computeScore(
  cases: { status: string; veredicto: string | null }[]
): number | null {
  const judged = cases.filter(
    (c) =>
      c.status === "agent_failed" ||
      (c.status === "done" && c.veredicto !== null)
  );
  if (judged.length === 0) return null;
  const points = judged.reduce((acc, c) => {
    if (c.status === "agent_failed") return acc;
    if (c.veredicto === "verde") return acc + 1;
    if (c.veredicto === "amarillo") return acc + 0.5;
    return acc;
  }, 0);
  return Math.round((100 * points) / judged.length);
}
