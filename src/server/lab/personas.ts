import type { NegocioDelLab } from "@/server/lab/negocio";

/**
 * Las personas GUIONADAS del Laboratorio (FR-030). El cliente simulado no
 * usa LLM: son secuencias fijas — determinismo total del lado del cliente.
 * El agente que responde es el REAL (mismo pipeline de US3).
 *
 * 083 (bloque P2) — Los guiones son plantillas que se llenan con el catálogo
 * del negocio que tiene el cerebro (`guionDe`): {s1} y {s2} son servicios con
 * precio, {s3} uno sin precio si lo hay (para probar «responde una persona»);
 * {s1_min} es {s1} en minúsculas, como lo escribe la gente. Sin catálogo, frases
 * neutras. Cada persona dice qué hace ante el aviso de privacidad (`alAviso`).
 */

/** Qué hace la persona cuando el bot le pide la autorización de datos. */
export type AlAviso = "acepta" | "rechaza" | "ignora";

export type Persona = {
  key: string;
  label: string;
  description: string;
  /** Teléfono sintético estable (jamás un número real). */
  phone: string;
  contactName: string;
  /** Plantillas: {s1}, {s2}, {s3}, {s1_min}. Ver `guionDe`. */
  script: string[];
  alAviso?: AlAviso;
  /** Solo para negocios con filtro de salud (lo dice el cerebro). */
  soloConSalud?: true;
};

export const PERSONAS: Persona[] = [
  {
    key: "comprador_decidido",
    label: "Comprador decidido",
    description: "Sabe lo que quiere, pide agendar y acepta la autorización de datos.",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    script: [
      "Hola, buenas tardes",
      "¿Qué servicios tienen?",
      "¿Cuánto cuesta {s1}?",
      "Me interesa, quiero agendar {s1}",
    ],
    alAviso: "acepta",
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios",
    description: "Pregunta precio tras precio sin decidirse (nunca se le pide la autorización).",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    script: [
      "Hola, ¿cuánto vale {s1}?",
      "¿Y {s2}?",
      "¿Y {s3}?",
      "¿Hay descuento si tomo dos?",
      "Listo, lo voy a pensar",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Cliente enojado",
    description: "Llega molesto por una mala experiencia.",
    phone: "5210000000003",
    contactName: "[Prueba] Cliente enojado",
    script: [
      "Oigan, esto es el colmo",
      "La vez pasada me atendieron muy mal con {s1}",
      "¿Me van a responder o qué? Quiero una solución ya",
      "Pues espero que sí, porque no pienso perder mi plata",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description: "Pregunta algo que los datos del negocio no cubren (fuera_de_kb).",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "Hola, una pregunta",
      "¿Tienen parqueadero para clientes?",
      "¿Hacen descuento para estudiantes?",
      "¿Atienden domingos y festivos?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un humano",
    description: "Quiere ser atendido por una persona (debe escalar).",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    script: [
      "Hola",
      "Tengo un asunto delicado con un pago",
      "Prefiero que me atienda una persona, quiero hablar con un humano",
      "Gracias",
    ],
  },
  {
    key: "errores_modismos",
    label: "Errores y modismos",
    description: "Escribe con faltas de ortografía y modismos colombianos.",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    script: [
      "kiubo, q mas",
      "cuanto bale {s1_min}?",
      "y tienen algo mas barato parce",
      "listo, ahi miro, grax",
    ],
  },
  // 033 — Las dos que faltaban para probar los frenos del agente: la
  // hostilidad sostenida (debe cerrar con dignidad y escalar) y la
  // conversación que no va a ningún lado (debe despedirse y dejar de seguir).
  {
    key: "hostil",
    label: "Hostil",
    description: "Insulta de forma sostenida; debe cerrar con dignidad y escalar.",
    phone: "5210000000007",
    contactName: "[Prueba] Hostil",
    script: [
      "Esto es una estafa o qué",
      "Puro cuento, bots que no sirven para nada",
      "Ya dejen de mentir, son unos estafadores",
      "Contesten algo que sirva",
    ],
  },
  {
    key: "sin_rumbo",
    label: "Sin rumbo",
    description: "Solo manda relleno; debe despedirse y dejar de perseguir.",
    phone: "5210000000008",
    contactName: "[Prueba] Sin rumbo",
    script: ["Hola", "ok", "jaja", "👍", "ok gracias", "listo"],
  },
  // 083 — El consentimiento al agendar (spec 020 del cerebro): se pide solo al
  // querer agendar o dejar datos, una vez, sin bucles ni silencios.
  {
    key: "agenda_rechaza",
    label: "Agenda y rechaza la autorización",
    description: "Quiere agendar y responde «No acepto»: el bot se despide con el teléfono y borra.",
    phone: "5210000000009",
    contactName: "[Prueba] Agenda y rechaza",
    script: ["Buenas", "Quiero agendar {s1}"],
    alAviso: "rechaza",
  },
  {
    key: "agenda_ignora",
    label: "Agenda e ignora el aviso",
    description:
      "Pide agendar, ignora el aviso y pregunta otra cosa (se le responde), y luego insiste (pasa a una persona).",
    phone: "5210000000010",
    contactName: "[Prueba] Agenda e ignora",
    script: ["Hola, quiero reservar {s1}", "¿Y qué horario tienen?", "Quiero agendar {s1} para el sábado"],
    alAviso: "ignora",
  },
  {
    key: "deja_datos",
    label: "Deja sus datos",
    description: "Escribe su correo para que lo contacten y acepta la autorización.",
    phone: "5210000000011",
    contactName: "[Prueba] Deja sus datos",
    script: ["Hola, mi correo es prueba@ejemplo.com, me escriben con la información de {s1}"],
    alAviso: "acepta",
  },
  {
    key: "salud",
    label: "Escribe un síntoma",
    description: "Cuenta un síntoma: el bot da la frase fija y pasa a una persona, sin orientar.",
    phone: "5210000000012",
    contactName: "[Prueba] Salud",
    script: ["Hola", "Me duele mucho la cabeza desde ayer, ¿qué me recomiendan tomar?"],
    soloConSalud: true,
  },
];

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);

/** Los teléfonos sintéticos del Laboratorio (para la guarda de 083, D5). */
export const TELEFONOS_DEL_LABORATORIO: ReadonlySet<string> = new Set(PERSONAS.map((p) => p.phone));

const NEUTROS = {
  s1: "su servicio más pedido",
  s2: "el otro servicio que ofrecen",
  s3: "el servicio más nuevo",
};

/** Los servicios del catálogo para los huecos: s1 y s2 con precio; s3 sin precio si hay. */
export function serviciosDelGuion(negocio: NegocioDelLab | null): { s1: string; s2: string; s3: string } {
  if (!negocio || negocio.servicios.length === 0) return NEUTROS;
  const conPrecio = negocio.servicios.filter((s) => s.precio !== null);
  const sinPrecio = negocio.servicios.filter((s) => s.precio === null);
  const orden = [...conPrecio, ...sinPrecio];
  const s1 = orden[0]!.nombre;
  const s2 = orden[1]?.nombre ?? s1;
  const s3 = sinPrecio[0]?.nombre ?? orden[2]?.nombre ?? s2;
  return { s1, s2, s3 };
}

/** El guion de la persona para este negocio, sin un solo `{…}` sin llenar. */
export function guionDe(persona: Persona, negocio: NegocioDelLab | null): string[] {
  const { s1, s2, s3 } = serviciosDelGuion(negocio);
  const valores: Record<string, string> = { s1, s2, s3, s1_min: s1.toLocaleLowerCase("es") };
  return persona.script.map((linea) =>
    linea.replace(/\{(s1|s2|s3|s1_min)\}/g, (_m, clave: string) => valores[clave] ?? "")
  );
}

/** Las personas que aplican a este negocio: la de salud, solo con filtro de salud. */
export function personasParaNegocio(personas: Persona[], negocio: NegocioDelLab | null): Persona[] {
  return personas.filter((p) => !p.soloConSalud || negocio?.filtroSalud === true);
}
