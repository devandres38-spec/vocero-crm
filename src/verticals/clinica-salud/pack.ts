import type { PackParcial } from "../tipos";

/**
 * 072 — Clínicas y consultorios (odontología, estética, fisioterapia,
 * medicina general). Se siente como un software de clínica: pacientes,
 * valoraciones y un inicio con las valoraciones de hoy.
 *
 * El agente agenda valoraciones; nunca diagnostica ni da precios que el
 * conocimiento no tenga.
 */
export const PACK_CLINICA_SALUD: PackParcial = {
  id: "clinica-salud",
  label: "Clínica / Salud",
  description:
    "Consultorios y clínicas: pacientes, valoraciones, tratamientos de interés y sedes. El agente agenda valoraciones sin dar diagnósticos.",
  vocabulario: {
    contacto: { uno: "Paciente", varios: "Pacientes" },
    lead: { uno: "Paciente potencial", varios: "Pacientes potenciales" },
    pipeline: { uno: "Pacientes en proceso", varios: "Pacientes en proceso" },
    cita: { uno: "Valoración", varios: "Valoraciones" },
    ficha: { uno: "Historia de contacto", varios: "Historias de contacto" },
  },
  nav: {
    orden: ["/inicio", "/inbox", "/bookings", "/pipeline", "/contacts"],
    iconos: { "/contacts": "salud" },
  },
  inicio: {
    widgets: [
      { tipo: "citas_de_hoy" },
      { tipo: "sin_responder" },
      { tipo: "leads_por_etapa" },
      { tipo: "accesos_rapidos" },
    ],
  },
  fichaFields: [
    {
      key: "tratamiento_interes",
      label: "Tratamiento de interés",
      type: "select",
      options: ["Valoración general", "Limpieza", "Ortodoncia", "Estética", "Urgencia", "Otro"],
      required: true,
      description: "Qué tratamiento o servicio busca el paciente",
    },
    {
      key: "primera_vez",
      label: "Primera vez",
      type: "boolean",
      required: true,
      description: "Si es la primera vez que viene a la clínica",
    },
    {
      key: "eps_o_particular",
      label: "EPS o particular",
      type: "select",
      options: ["Particular", "EPS", "Prepagada"],
      description: "Cómo pagaría; pregúntalo solo si el paciente habla de costos",
    },
    {
      key: "sede_preferida",
      label: "Sede preferida",
      type: "text",
      description: "La sede o el barrio donde le queda mejor",
    },
    {
      key: "dolor_o_urgencia",
      label: "Dolor o urgencia",
      type: "boolean",
      description: "Si menciona dolor o una urgencia (entonces ofrece la cita más cercana)",
    },
  ],
  semilla: {
    brand: { accent: "#3f6b66" },
    appearance: { tema: "papel", letra: "urbanist", tamano: "normal", densidad: "espaciosa" },
    pipeline: { stages: ["Nuevo", "Valoración agendada", "Valoración realizada", "Tratamiento propuesto"] },
    agent: {
      name: "Sofía",
      role: "calificador",
      tone: "Cálida, tranquila y profesional. Transmite confianza sin prometer resultados.",
      treatment: "usted",
      stallEnabled: true,
      greeting: "¡Hola! Le saluda Sofía, de la clínica. ¿En qué le podemos ayudar?",
      instructions: [
        "Atiendes a pacientes y posibles pacientes de la clínica.",
        "1. Entiende qué tratamiento o servicio busca, una pregunta a la vez.",
        "2. Responde solo con lo que dice el conocimiento de la clínica: precios, sedes, horarios y formas de pago.",
        "3. Nunca des diagnósticos, ni opiniones médicas, ni recetes nada. Si preguntan algo clínico, explica que eso lo define el profesional en la valoración.",
        "4. El objetivo es agendar una valoración. Si el paciente menciona dolor o una urgencia, ofrécele la cita más cercana.",
      ].join("\n"),
      escalationRules:
        "Pasa a una persona si el paciente reporta una urgencia grave, si es una queja por un tratamiento o una cita, si pide hablar con el profesional, o si pregunta algo médico que el conocimiento no cubre.",
      tools: null,
    },
    knowledge: {
      mode: "merge",
      entries: [
        { kind: "qa", question: "¿La valoración tiene costo?", answer: "Edita esta respuesta con el valor de la valoración de tu clínica." },
        { kind: "qa", question: "¿Dónde quedan?", answer: "Edita esta respuesta con la dirección de cada sede." },
        { kind: "qa", question: "¿Qué formas de pago reciben?", answer: "Edita esta respuesta: efectivo, tarjeta, Nequi, convenios o EPS." },
        { kind: "block", content: "Horario de atención: edita este bloque con los días y las horas de cada sede." },
      ],
    },
    quickReplies: {
      mode: "merge",
      entries: [
        { shortcut: "sedes", text: "Le comparto nuestras sedes, {nombre}: (edite este texto con las direcciones)." },
        { shortcut: "preparacion", text: "Para su valoración, {nombre}, le pedimos llegar 10 minutos antes y traer su documento." },
        { shortcut: "confirmar", text: "Hola {nombre}, le escribimos para confirmar su valoración. ¿Nos confirma su asistencia?" },
      ],
    },
  },
  personas: [
    {
      key: "paciente_valoracion",
      label: "Paciente que pide valoración",
      description: "Quiere agendar una valoración de ortodoncia y es su primera vez.",
      phone: "570000000101",
      contactName: "[Prueba] Paciente valoración",
      script: [
        "Buenas tardes",
        "Quería saber si hacen valoraciones de ortodoncia",
        "Es la primera vez que voy, ¿cuánto vale la valoración?",
        "Listo, ¿qué día tienen disponible esta semana?",
      ],
    },
    {
      key: "pregunta_precios_sedes",
      label: "Pregunta precios y sedes",
      description: "Compara precios de limpieza y pregunta por la sede más cercana.",
      phone: "570000000102",
      contactName: "[Prueba] Precios y sedes",
      script: [
        "Hola, ¿cuánto cuesta una limpieza?",
        "¿Y tienen sede por el norte?",
        "¿Reciben EPS o solo particular?",
        "Bueno, lo voy a pensar y les escribo",
      ],
    },
    {
      key: "paciente_molesto_cita",
      label: "Paciente molesto por una cita",
      description: "Llega molesto porque lo hicieron esperar; debe escalar sin discutir.",
      phone: "570000000103",
      contactName: "[Prueba] Paciente molesto",
      script: [
        "Buenas, quiero poner una queja",
        "Ayer tenía cita a las 3 y me atendieron a las 4:30, nadie me avisó nada",
        "Me parece una falta de respeto, perdí la tarde de trabajo",
        "¿Quién me responde por eso?",
      ],
    },
  ],
  modulosRecomendados: [],
};
