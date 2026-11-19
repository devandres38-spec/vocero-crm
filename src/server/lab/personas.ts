/**
 * Las personas GUIONADAS del Laboratorio (FR-030). El cliente simulado no
 * usa LLM: son secuencias fijas — determinismo total del lado del cliente.
 * El agente que responde es el REAL (mismo pipeline de US3).
 *
 * 068 — Hablan como clientes colombianos y sus teléfonos son `57000000000N`:
 * ningún número de Colombia empieza por 0 tras el 57, así que nunca son reales.
 */

import { PACK_IDS, packDe, PACKS } from "@/verticals/registro";
import type { PersonaDePack } from "@/verticals/tipos";

/** La misma forma que declara un Vertical Pack (072). */
export type Persona = PersonaDePack;

export const PERSONAS: Persona[] = [
  {
    key: "comprador_decidido",
    label: "Comprador decidido",
    description: "Sabe lo que quiere y va directo a comprar.",
    phone: "570000000001",
    contactName: "[Prueba] Comprador decidido",
    script: [
      "Hola, buenas tardes",
      "¿Tienen taladros inalámbricos disponibles?",
      "Listo, ¿cuánto vale el más vendido?",
      "Me convence, lo compro. ¿Cómo pago?",
    ],
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios",
    description: "Pregunta precio tras precio sin decidirse.",
    phone: "570000000002",
    contactName: "[Prueba] Preguntón de precios",
    script: [
      "Hola, ¿qué precio tiene el martillo?",
      "¿Y el destornillador de estrella?",
      "¿Cuánto vale la caja de puntillas de 2 pulgadas?",
      "¿Me hacen descuento si llevo varias cosas?",
      "Bueno, lo voy a pensar",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Cliente enojado",
    description: "Llega molesto por un problema con su compra.",
    phone: "570000000003",
    contactName: "[Prueba] Cliente enojado",
    script: [
      "Oigan, esto sí es el colmo",
      "Compré una pulidora la semana pasada y ya no prende, qué cosa tan mala",
      "¿Me van a responder o qué? Necesito una solución YA",
      "Pues espero que sí porque no pienso perder mi plata",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description: "Pregunta algo que el knowledge base no cubre (fuera_de_kb).",
    phone: "570000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "Hola, una pregunta",
      "¿Cuál es su política de garantías y devoluciones?",
      "¿Y si el producto falla a los dos meses me lo cambian?",
      "¿Dónde reclamo la garantía?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un humano",
    description: "Quiere ser atendido por una persona (debe escalar).",
    phone: "570000000005",
    contactName: "[Prueba] Pide humano",
    script: [
      "Hola",
      "Tengo un asunto delicado con un pedido",
      "Prefiero que me atienda una persona, quiero hablar con un humano",
      "Gracias",
    ],
  },
  {
    key: "errores_modismos",
    label: "Errores y modismos",
    description: "Escribe con faltas de ortografía y modismos colombianos.",
    phone: "570000000006",
    contactName: "[Prueba] Errores y modismos",
    script: [
      "kiubo, si benden pintura?",
      "oiga y me regala el precio del tiner",
      "cuanto bale el galon d vinilo blanco pa interiores",
      "de una parce, ahorita paso x alla",
    ],
  },
  // 033 — Las dos que faltaban para probar los frenos del agente: la
  // hostilidad sostenida (debe cerrar con dignidad y escalar) y la
  // conversación que no va a ningún lado (debe despedirse y dejar de seguir).
  {
    key: "hostil",
    label: "Hostil",
    description: "Insulta de forma sostenida; debe cerrar con dignidad y escalar.",
    phone: "570000000007",
    contactName: "[Prueba] Hostil",
    script: [
      "Oiga, esto es una estafa o qué",
      "Puro cuento, bots de pacotilla que no sirven pa nada",
      "Ya dejen la bobada, son unos estafadores, no les creo nada",
      "¿Qué me mira? Conteste algo que sirva",
    ],
  },
  {
    key: "sin_rumbo",
    label: "Sin rumbo",
    description: "Solo manda relleno; debe despedirse y dejar de perseguir.",
    phone: "570000000008",
    contactName: "[Prueba] Sin rumbo",
    script: ["Hola", "ok", "jaja", "👍", "ok gracias", "bueno"],
  },
];

/**
 * 072 (D19) — Las que sirven a cualquier nicho: prueban los frenos del agente
 * (hostilidad, pedir una persona, lo que el conocimiento no cubre, la
 * conversación sin rumbo), no el negocio.
 */
export const UNIVERSALES = ["hostil", "pide_humano", "fuera_de_kb", "sin_rumbo"] as const;

/** Todas: las de siempre + las de cada pack (buscar por clave y etiquetas). */
export const TODAS_LAS_PERSONAS: Persona[] = [
  ...PERSONAS,
  ...PACK_IDS.flatMap((id) => PACKS[id].personas),
];

export function personaPorClave(key: string): Persona | undefined {
  return TODAS_LAS_PERSONAS.find((p) => p.key === key);
}

/**
 * Las personas de una corrida: las del nicho + las universales. Un pack sin
 * personas propias (`default`) usa las del rol: las 8 de siempre.
 */
export function personasDelPack(packId: unknown, delRol: Persona[]): Persona[] {
  const propias = packDe(packId).personas;
  if (propias.length === 0) return delRol;
  const universales = UNIVERSALES.map((k) => PERSONAS.find((p) => p.key === k)).filter((p): p is Persona => Boolean(p));
  return [...propias, ...universales];
}

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  TODAS_LAS_PERSONAS.map((p) => [p.key, p.label])
);
