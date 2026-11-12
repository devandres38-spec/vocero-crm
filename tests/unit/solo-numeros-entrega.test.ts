import { describe, expect, it } from "vitest";
import { motivoDeDescarte } from "@/server/dispatch/worker";
import { MOTIVO_FUERA_DE_LISTA } from "@/server/dispatch/solo-numeros";

/**
 * 079 (T5) — La puerta de entrega vuelve a mirar la lista: un número sacado
 * durante la ventana de agrupado ya no llega al cerebro.
 */
type Evento = Parameters<typeof motivoDeDescarte>[0];

const evento = (o: {
  identidad?: string;
  salud?: boolean;
  test?: boolean;
  agentEnabled?: false;
  sinMensajes?: boolean;
}): Evento => ({
  conversation: {
    id: "cv_1",
    channel: "whatsapp",
    aiEnabled: true,
    windowOpen: true,
    windowExpiresAt: null,
    ...(o.test ? { test: true as const } : {}),
    ...(o.agentEnabled === false ? { agentEnabled: false as const } : {}),
  },
  contact: { id: "ct_1", displayName: "Ana", identity: o.identidad ?? "573001112233" },
  messages: o.sinMensajes
    ? []
    : [
        {
          id: "msg_1",
          type: "text",
          text: "hola",
          createdAt: "2026-11-12T00:00:00.000Z",
          ...(o.salud ? { privacyFlags: ["salud"] } : {}),
        } as Evento["messages"][number],
      ],
});

const lista = (numeros: string[]) => ({ activo: true, numeros });

describe("079 — motivoDeDescarte con la lista", () => {
  it("en la lista: se entrega", () => {
    expect(motivoDeDescarte(evento({}), lista(["573001112233"]))).toBeNull();
  });

  it("sacado de la lista durante la ventana: se descarta con el motivo", () => {
    expect(motivoDeDescarte(evento({}), lista(["573009998877"]))).toBe(MOTIVO_FUERA_DE_LISTA);
    expect(MOTIVO_FUERA_DE_LISTA).toBe("fuera de la lista de números");
  });

  it("fuera de la lista con salud: se entrega (D9)", () => {
    expect(motivoDeDescarte(evento({ salud: true }), lista([]))).toBeNull();
  });

  it("Instagram con la lista encendida: se descarta", () => {
    expect(motivoDeDescarte(evento({ identidad: "ig:1" }), lista(["573001112233"]))).toBe(
      MOTIVO_FUERA_DE_LISTA
    );
  });

  it("el Laboratorio no se filtra", () => {
    expect(motivoDeDescarte(evento({ test: true, identidad: "lab" }), lista([]))).toBeNull();
    expect(motivoDeDescarte(evento({ test: true }), null)).toBeNull();
  });

  it("apagada: se entrega", () => {
    expect(motivoDeDescarte(evento({ identidad: "ig:1" }), { activo: false, numeros: [] })).toBeNull();
  });

  it("lo de antes sigue igual: sin mensajes y Agente apagado sin salud", () => {
    expect(motivoDeDescarte(evento({ sinMensajes: true }), null)).toBe("sin mensajes por despachar");
    expect(motivoDeDescarte(evento({ agentEnabled: false }), null)).toBe("el agente está apagado");
    expect(motivoDeDescarte(evento({ agentEnabled: false, salud: true }), null)).toBeNull();
  });
});
