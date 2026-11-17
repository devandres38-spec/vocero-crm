import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { RESPUESTAS_DEMO } from "@/server/quick-replies";

/**
 * Negocio de demostración "Ferretería El Martillo" (FR-075).
 * Idempotente: borra los datos demo previos de la organización (scoped por
 * los teléfonos demo Y su organization_id, 068) y reinserta. El KB queda lleno EXCEPTO garantías y
 * devoluciones — hueco INTENCIONAL para que el Laboratorio encuentre algo
 * real en la primera corrida.
 */

type Db = ReturnType<typeof getDb>;

const HOURS = 60 * 60 * 1000;

/**
 * 068 — Teléfonos sintéticos de la demo: `57` + `00000001NN`. Ningún número
 * colombiano empieza por 0 después del 57, así que jamás coinciden con una
 * persona real (y un envío por error no llegaría a nadie).
 */
const DEMO_CONTACTS: {
  phone: string;
  name: string;
  notes?: string;
  stage: string;
  thread: { dir: "in" | "out"; text: string; hoursAgo: number; ai?: boolean }[];
}[] = [
  {
    phone: "570000000101",
    name: "María Fernanda López",
    stage: "Interesado",
    notes: "Remodela su cocina; busca herramienta eléctrica.",
    thread: [
      { dir: "in", text: "Hola, ¿tienen taladros inalámbricos?", hoursAgo: 5 },
      { dir: "out", text: "¡Hola María! Sí: tenemos el Black+Decker 20V en $289.900 y el DeWalt 20V MAX en $649.900, los dos con batería incluida.", hoursAgo: 5, ai: true },
      { dir: "in", text: "¿El Black+Decker trae brocas?", hoursAgo: 4 },
      { dir: "out", text: "Trae un juego básico de 5 brocas para concreto y madera. Si necesitas más, el juego de 30 piezas está en $59.900.", hoursAgo: 4, ai: true },
      { dir: "in", text: "Listo, me interesa el Black+Decker. ¿Me lo separan?", hoursAgo: 3 },
    ],
  },
  {
    phone: "570000000102",
    name: "Carlos Ramírez",
    stage: "En conversación",
    thread: [
      { dir: "in", text: "Buenas, ¿cuánto vale el bulto de cemento gris?", hoursAgo: 8 },
      { dir: "out", text: "¡Hola Carlos! El bulto de 50 kg está en $32.500. Por 10 o más te queda en $31.000 cada uno.", hoursAgo: 8, ai: true },
      { dir: "in", text: "Necesito 15 bultos, ¿hacen entrega en Bello?", hoursAgo: 7 },
      { dir: "out", text: "Sí, entregamos en todo el área metropolitana. El flete es de $15.000 y llega el mismo día si confirmas antes de la 1 p. m. Total: 15 × $31.000 + $15.000 = $480.000.", hoursAgo: 7, ai: true },
    ],
  },
  {
    phone: "570000000103",
    name: "Luz Marina Hernández",
    stage: "Cliente",
    notes: "Compra recurrente para su taller de carpintería.",
    thread: [
      { dir: "in", text: "Hola otra vez, ya me quedé sin laca 😅", hoursAgo: 30 },
      { dir: "out", text: "¡Hola Luz Marina! Te separamos el galón de laca transparente que siempre llevas: $98.000. ¿Te lo mandamos con tu pedido de lijas?", hoursAgo: 30, ai: true },
      { dir: "in", text: "Sí porfa, todo en un solo envío", hoursAgo: 29 },
      { dir: "out", text: "Listo, sale hoy mismo. Total: $126.000 con las lijas. ¡Gracias por tu compra!", hoursAgo: 29, ai: true },
    ],
  },
  {
    phone: "570000000104",
    name: "Jorge Castillo",
    stage: "Nuevo",
    thread: [
      { dir: "in", text: "kiubo, tienen vinilo blanco tipo 1 en cuñete?", hoursAgo: 2 },
      { dir: "out", text: "¡Qué más, Jorge! Sí: el cuñete de vinilo tipo 1 blanco está en $289.000 (rinde ~100 m²). ¿Lo quieres mate o satinado?", hoursAgo: 2, ai: true },
    ],
  },
  {
    phone: "570000000105",
    name: "Ana Sofía Torres",
    stage: "Interesado",
    thread: [
      { dir: "in", text: "Hola, vi su anuncio. ¿Manejan material eléctrico?", hoursAgo: 12 },
      { dir: "out", text: "¡Hola Ana! Sí: cable, tomas, breakers y tableros. ¿Qué necesitas para tu proyecto?", hoursAgo: 12, ai: true },
      { dir: "in", text: "Necesito 100 m de cable #12 y 10 tomas dobles", hoursAgo: 11 },
      { dir: "out", text: "Te cotizo: rollo de 100 m de cable #12 THHN $245.000 + 10 tomas dobles a $9.500 c/u = $340.000. ¿Te lo preparo?", hoursAgo: 11, ai: true },
      { dir: "in", text: "Déjame confirmar con el electricista y te cuento", hoursAgo: 10 },
    ],
  },
  {
    phone: "570000000106",
    name: "Roberto Mendoza",
    stage: "Perdido",
    notes: "Buscaba precio por mayor que no podemos igualar.",
    thread: [
      { dir: "in", text: "¿A cómo la tonelada de varilla de 3/8?", hoursAgo: 96 },
      { dir: "out", text: "Hola Roberto: la tonelada de varilla de 3/8 está en $3.950.000. ¿Para cuándo la necesitas?", hoursAgo: 96, ai: true },
      { dir: "in", text: "Uy no, en otro lado me la dejan en 3 millones 600", hoursAgo: 95 },
      { dir: "out", text: "Entiendo. Ese precio no lo alcanzamos, pero si tu proveedor te queda mal aquí estamos con entrega el mismo día. ¡Éxitos con la obra!", hoursAgo: 95, ai: true },
    ],
  },
  {
    phone: "570000000107",
    name: "Paola Domínguez",
    stage: "En conversación",
    thread: [
      { dir: "in", text: "Hola, ¿tienen impermeabilizante? Se me está goteando la terraza 😩", hoursAgo: 26 },
      { dir: "out", text: "¡Hola Paola! Claro: el impermeabilizante acrílico 5 años (cuñete de 20 kg) está en $389.000 y cubre ~40 m². ¿De cuántos metros es tu terraza?", hoursAgo: 26, ai: true },
      { dir: "in", text: "Como de 60 metros, ¿me alcanza con dos?", hoursAgo: 25 },
    ],
  },
  {
    phone: "570000000108",
    name: "Don Jairo Aguilar",
    stage: "Cliente",
    thread: [
      { dir: "in", text: "Joven, mándeme la lista de lo de siempre pa' la cuadrilla", hoursAgo: 50 },
      { dir: "out", text: "¡Con gusto, Don Jairo! Su pedido de siempre: 5 bultos de cemento, 2 de pegante, 1 rollo de alambre negro y 3 kg de puntilla. Total: $236.000. ¿Se lo mandamos a la obra de la Carrera 70?", hoursAgo: 50, ai: true },
      { dir: "in", text: "Listo, ahí mismo. Se paga contraentrega como siempre", hoursAgo: 49 },
      { dir: "out", text: "Perfecto, sale en la camioneta de las 4. ¡Gracias, Don Jairo!", hoursAgo: 49, ai: true },
    ],
  },
];

/**
 * Teléfonos de la demo ANTERIOR a la 068 (la de México). La limpieza los sigue
 * borrando para que volver a sembrar en una organización que ya tenía la demo
 * vieja no la deje duplicada.
 */
const LEGACY_DEMO_PHONES = Array.from(
  { length: 8 },
  (_, i) => `52156123400${String(i + 1).padStart(2, "0")}`
);

/** Todos los teléfonos que la limpieza de la demo puede borrar. */
export const DEMO_PHONES: readonly string[] = [
  ...DEMO_CONTACTS.map((c) => c.phone),
  ...LEGACY_DEMO_PHONES,
];

/**
 * 068 — Qué contactos borra la limpieza de la demo: los de la demo, SOLO de
 * esta organización. Antes se filtraba únicamente por teléfono, y sembrar la
 * demo en un negocio borraba los contactos demo de todos los demás
 * (constitución I). Vive aparte para que una prueba pueda leer el SQL.
 */
export function filtroContactosDemo(organizationId: string): SQL {
  return and(
    eq(schema.contact.organizationId, organizationId),
    inArray(schema.contact.phone, [...DEMO_PHONES])
  )!;
}

const DEMO_KB: { kind: "qa" | "block"; question?: string; answer?: string; content?: string }[] = [
  {
    kind: "block",
    content:
      "Ferretería El Martillo — ferretería familiar con 20 años en el centro de la ciudad. Vendemos herramienta manual y eléctrica, materiales de construcción, pintura, plomería y material eléctrico. Atendemos a público general, maestros de obra y talleres.",
  },
  { kind: "qa", question: "¿Cuál es el horario?", answer: "Lunes a sábado de 8:00 a. m. a 7:00 p. m. y domingos y festivos de 9:00 a. m. a 2:00 p. m." },
  { kind: "qa", question: "¿Dónde están ubicados?", answer: "Calle 50 # 45-20, Centro. Hay parqueadero gratis para clientes al lado del local." },
  { kind: "qa", question: "¿Hacen domicilios?", answer: "Sí: entrega el mismo día en el área metropolitana si confirmas antes de la 1 p. m. Flete local $15.000; gratis en compras mayores a $300.000." },
  { kind: "qa", question: "¿Qué medios de pago aceptan?", answer: "Efectivo, tarjeta débito y crédito, transferencia (Nequi, Daviplata o Bancolombia) y contraentrega en pedidos locales." },
  { kind: "qa", question: "¿Dan factura electrónica?", answer: "Sí, la emitimos el mismo día. Envíanos tu RUT y el número de la compra." },
  { kind: "qa", question: "¿Tienen precios por mayor?", answer: "Sí: en cemento, pegante y varilla hay precio especial desde 10 unidades; en pintura, desde 5 cuñetes. Pide tu cotización por WhatsApp." },
  { kind: "qa", question: "¿Qué marcas de herramienta manejan?", answer: "Black+Decker, DeWalt, Bosch, Makita y Stanley en herramienta; Procables y Legrand en material eléctrico; Pintuco y Sika en pintura e impermeabilizantes." },
  // HUECO INTENCIONAL: nada sobre garantías ni devoluciones (lo encuentra el Laboratorio).
];

export async function seedDemo(
  db: Db,
  organizationId: string
): Promise<{ contacts: number; kbEntries: number }> {
  // --- Idempotencia: limpiar datos demo previos de ESTA organización (orden
  // inverso de FKs). Conversaciones, mensajes y leads se borran por los
  // contactos encontrados, que ya son solo de esta organización. ---
  const prevContacts = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(filtroContactosDemo(organizationId));
  const prevIds = prevContacts.map((c) => c.id);
  if (prevIds.length > 0) {
    const prevConvs = await db
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(inArray(schema.conversation.contactId, prevIds));
    const convIds = prevConvs.map((c) => c.id);
    if (convIds.length > 0) {
      await db
        .delete(schema.message)
        .where(inArray(schema.message.conversationId, convIds));
      await db
        .delete(schema.conversation)
        .where(inArray(schema.conversation.id, convIds));
    }
    await db.delete(schema.lead).where(inArray(schema.lead.contactId, prevIds));
    await db.delete(schema.contact).where(inArray(schema.contact.id, prevIds));
  }
  // KB y corridas demo previas
  await db
    .delete(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));
  await db
    .delete(schema.agentTestCase)
    .where(eq(schema.agentTestCase.organizationId, organizationId));
  await db
    .delete(schema.agentTestRun)
    .where(eq(schema.agentTestRun.organizationId, organizationId));

  // --- Etapas (por nombre) ---
  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId));
  const stageByName = new Map(stages.map((s) => [s.name, s.id]));
  const fallbackStage = stages[0]?.id;
  if (!fallbackStage) throw new Error("La organización no tiene etapas");

  // --- Contactos + conversaciones + mensajes + leads ---
  const now = Date.now();
  let position = 0;
  for (const demo of DEMO_CONTACTS) {
    const contactId = newId("contact");
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId,
      phone: demo.phone,
      waIdentity: demo.phone,
      name: demo.name,
      notes: demo.notes ?? null,
    });

    const lastInbound = demo.thread
      .filter((t) => t.dir === "in")
      .reduce((min, t) => Math.min(min, t.hoursAgo), Infinity);
    const lastMessage = demo.thread.reduce(
      (min, t) => Math.min(min, t.hoursAgo),
      Infinity
    );

    const conversationId = newId("conversation");
    await db.insert(schema.conversation).values({
      id: conversationId,
      organizationId,
      contactId,
      lastInboundAt: new Date(now - lastInbound * HOURS),
      lastMessageAt: new Date(now - lastMessage * HOURS),
      unreadCount: demo.thread[demo.thread.length - 1]?.dir === "in" ? 1 : 0,
    });

    for (const msg of demo.thread) {
      const at = new Date(now - msg.hoursAgo * HOURS);
      await db.insert(schema.message).values({
        id: newId("message"),
        organizationId,
        conversationId,
        waMessageId: `wamid.demo.${newId("message")}`,
        direction: msg.dir,
        type: "text",
        text: msg.text,
        status: msg.dir === "in" ? "delivered" : "read",
        aiGenerated: msg.ai ?? false,
        origin: msg.ai ? "ai" : "operator",
        waTimestamp: at,
        createdAt: at,
      });
    }

    await db.insert(schema.lead).values({
      id: newId("lead"),
      organizationId,
      contactId,
      stageId: stageByName.get(demo.stage) ?? fallbackStage,
      position: position++,
      lastActivityAt: new Date(now - lastMessage * HOURS),
    });
  }

  // --- Knowledge base (con el hueco intencional) ---
  for (const entry of DEMO_KB) {
    await db.insert(schema.kbEntry).values({
      id: newId("kbEntry"),
      organizationId,
      kind: entry.kind,
      question: entry.question ?? null,
      answer: entry.answer ?? null,
      content: entry.content ?? null,
    });
  }

  // --- Comportamiento del agente de la demo ---
  await db
    .update(schema.agentProfile)
    .set({
      name: "Martillito",
      tone: "Cercano y práctico, de ferretería de confianza. Tutea al cliente.",
      instructions:
        "Ayuda a cotizar y cerrar ventas. Da precios en pesos solo si están en el conocimiento. Si piden precio por mayor, menciona los mínimos. Nunca inventes existencias.",
      escalationRules:
        "Escala a un humano si piden factura con datos fiscales complejos, si hay una queja de producto dañado o si lo piden explícitamente.",
      greeting: "¡Hola! Soy Martillito, el asistente de Ferretería El Martillo 🔨",
      updatedAt: new Date(),
    })
    .where(eq(schema.agentProfile.organizationId, organizationId));

  // --- Corrida de Laboratorio de ejemplo (guardada, con el hueco encontrado) ---
  const runId = newId("testRun");
  await db.insert(schema.agentTestRun).values({
    id: runId,
    organizationId,
    status: "done",
    score: 83,
    startedAt: new Date(now - 24 * HOURS),
    finishedAt: new Date(now - 24 * HOURS + 3 * 60 * 1000),
  });
  const exampleCases: {
    persona: string;
    veredicto: "verde" | "amarillo" | "rojo";
    hallazgos: unknown[];
    transcript: { role: string; text: string }[];
  }[] = [
    {
      persona: "comprador_decidido",
      veredicto: "verde",
      hallazgos: [],
      transcript: [
        { role: "cliente", text: "¿Tienen taladros inalámbricos disponibles?" },
        { role: "agente", text: "¡Sí! Black+Decker 20V en $289.900 y DeWalt 20V MAX en $649.900." },
        { role: "cliente", text: "Me convence, lo compro. ¿Cómo pago?" },
        { role: "agente", text: "Recibimos efectivo, tarjeta, Nequi, Daviplata o contraentrega. Te lo separo de una vez." },
      ],
    },
    {
      persona: "pregunton_precios",
      veredicto: "verde",
      hallazgos: [],
      transcript: [
        { role: "cliente", text: "¿Qué precio tiene el martillo?" },
        { role: "agente", text: "Tenemos varios; el más pedido es el Stanley de uña. ¿Te confirmo precio y existencia con el equipo?" },
      ],
    },
    {
      persona: "cliente_enojado",
      veredicto: "amarillo",
      hallazgos: [
        {
          tipo: "tono",
          evidencia:
            "El agente respondió correcto pero algo frío ante 'qué cosa tan mala'; faltó empatizar antes de escalar.",
        },
      ],
      transcript: [
        { role: "cliente", text: "Compré una pulidora la semana pasada y ya no prende, qué cosa tan mala" },
        { role: "agente", text: "Lamento el problema. Paso tu caso a un compañero del equipo para resolverlo." },
      ],
    },
    {
      persona: "fuera_de_kb",
      veredicto: "rojo",
      hallazgos: [
        {
          tipo: "fuera_de_kb",
          evidencia:
            "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
          sugerencia: {
            pregunta: "¿Cuál es la política de garantías y devoluciones?",
            respuesta:
              "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
          },
        },
      ],
      transcript: [
        { role: "cliente", text: "¿Cuál es su política de garantías y devoluciones?" },
        { role: "agente", text: "Déjame confirmarlo con el equipo y te digo en un momento." },
      ],
    },
    {
      persona: "pide_humano",
      veredicto: "verde",
      hallazgos: [],
      transcript: [
        { role: "cliente", text: "Prefiero que me atienda una persona, quiero hablar con un humano" },
        { role: "agente", text: "(handoff: la conversación pasó a atención humana)" },
      ],
    },
    {
      persona: "errores_modismos",
      veredicto: "verde",
      hallazgos: [],
      transcript: [
        { role: "cliente", text: "kiubo, si benden pintura?" },
        { role: "agente", text: "¡Claro! Manejamos Pintuco. ¿Qué necesitas pintar?" },
      ],
    },
  ];
  for (const c of exampleCases) {
    await db.insert(schema.agentTestCase).values({
      id: newId("testCase"),
      organizationId,
      runId,
      persona: c.persona,
      status: "done",
      veredicto: c.veredicto,
      hallazgos: c.hallazgos,
      transcript: c.transcript,
    });
  }

  // 049 — Cuatro respuestas rápidas para probar el «/» del compositor. No
  // pisa ni duplica las que el negocio ya tenga con el mismo atajo.
  await db
    .insert(schema.quickReply)
    .values(RESPUESTAS_DEMO.map((r) => ({ id: newId("quickReply"), organizationId, ...r })))
    .onConflictDoNothing({ target: [schema.quickReply.organizationId, schema.quickReply.atajo] });

  return { contacts: DEMO_CONTACTS.length, kbEntries: DEMO_KB.length };
}

/** true si la organización aún no tiene datos de dominio (para el botón). */
export async function isDomainEmpty(
  db: Db,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(eq(schema.contact.organizationId, organizationId))
    .limit(1);
  return rows.length === 0;
}
