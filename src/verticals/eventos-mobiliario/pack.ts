import type { PackParcial } from "../tipos";

/**
 * 072 — Alquiler de mobiliario y producción de eventos (bodas, corporativos,
 * cumpleaños). Se siente como un software de eventos: solicitudes, eventos
 * próximos por fecha y una ficha que pide fecha, tipo e invitados.
 *
 * El inventario y el cotizador con PDF son el módulo `mobiliario` (073): este
 * pack solo lo recomienda.
 */
export const PACK_EVENTOS_MOBILIARIO: PackParcial = {
  id: "eventos-mobiliario",
  label: "Eventos y mobiliario",
  description:
    "Alquiler de mobiliario y producción de eventos: solicitudes, fecha del evento, invitados y cotizaciones. El agente reúne los datos para cotizar.",
  vocabulario: {
    contacto: { uno: "Cliente", varios: "Clientes" },
    lead: { uno: "Solicitud", varios: "Solicitudes" },
    pipeline: { uno: "Solicitudes", varios: "Solicitudes" },
    cita: { uno: "Visita", varios: "Visitas" },
    ficha: { uno: "Datos del evento", varios: "Datos de eventos" },
  },
  nav: {
    orden: ["/inicio", "/inbox", "/pipeline", "/contacts", "/bookings"],
    iconos: { "/pipeline": "evento" },
  },
  inicio: {
    widgets: [
      { tipo: "proximos_por_fecha", params: { campo: "fecha_evento", titulo: "Eventos próximos" } },
      { tipo: "sin_responder" },
      { tipo: "leads_por_etapa" },
      { tipo: "accesos_rapidos" },
    ],
  },
  fichaFields: [
    {
      key: "fecha_evento",
      label: "Fecha del evento",
      type: "date",
      required: true,
      description: "El día del evento, aunque sea aproximado",
    },
    {
      key: "tipo_evento",
      label: "Tipo de evento",
      type: "select",
      options: ["Boda", "Corporativo", "Cumpleaños", "Quince años", "Grado", "Otro"],
      required: true,
    },
    {
      key: "num_invitados",
      label: "Número de invitados",
      type: "number",
      required: true,
      description: "Cuántas personas asistirán, aunque sea un aproximado",
    },
    {
      key: "ciudad_evento",
      label: "Ciudad o lugar",
      type: "text",
      description: "Ciudad o salón donde será el evento (define el transporte)",
    },
    {
      key: "presupuesto_aprox",
      label: "Presupuesto aproximado",
      type: "number",
      description: "Solo si el cliente lo menciona; no lo exijas",
    },
  ],
  semilla: {
    brand: { accent: "#3f5972" },
    appearance: { tema: "vocero", letra: "archivo", tamano: "normal", densidad: "normal" },
    pipeline: { stages: ["Nuevo", "Cotización enviada", "Separación pendiente", "Confirmado"] },
    agent: {
      name: "Valentina",
      role: "calificador",
      tone: "Alegre, cercana y resolutiva. Habla de celebrar, no de vender.",
      treatment: "tu",
      // Las ventas de eventos se piensan por días: no se cierran por falta de rumbo.
      stallEnabled: false,
      greeting: "¡Hola! Soy Valentina 🎉 ¿Qué evento estás preparando?",
      instructions: [
        "Atiendes a personas que preparan un evento y necesitan mobiliario o producción.",
        "1. Reúne, una pregunta a la vez, la fecha del evento, el tipo de evento y el número de invitados.",
        "2. Con eso, ofrece una cotización o una visita con el equipo. Si el cliente la pide antes, no se la condiciones a los datos.",
        "3. Responde con lo que dice el conocimiento: catálogo, transporte, montaje, separación y formas de pago. No inventes precios ni disponibilidad.",
      ].join("\n"),
      escalationRules:
        "Pasa a una persona si piden un descuento o condiciones especiales, si es una queja por un evento ya realizado, o si preguntan disponibilidad de una fecha que el conocimiento no cubre.",
      tools: null,
    },
    knowledge: {
      mode: "merge",
      entries: [
        { kind: "qa", question: "¿Cómo separo la fecha?", answer: "Edita esta respuesta con tu política de separación (anticipo y plazos)." },
        { kind: "qa", question: "¿Incluyen transporte y montaje?", answer: "Edita esta respuesta con lo que incluye y lo que cuesta aparte." },
        { kind: "block", content: "Catálogo base: edita este bloque con tus sillas, mesas, mantelería, carpas y decoración, con sus precios por unidad." },
      ],
    },
    quickReplies: {
      mode: "merge",
      entries: [
        { shortcut: "separacion", text: "Para separar tu fecha, {nombre}, (edita este texto con el anticipo y los plazos)." },
        { shortcut: "catalogo", text: "Te comparto nuestro catálogo, {nombre}: (edita este texto con el enlace)." },
        { shortcut: "datos", text: "Para cotizarte, {nombre}, cuéntame la fecha, el tipo de evento y cuántos invitados esperas." },
      ],
    },
  },
  personas: [
    {
      key: "novios_boda",
      label: "Novios preparando su boda",
      description: "Pareja que cotiza mobiliario para una boda de 120 personas.",
      phone: "570000000201",
      contactName: "[Prueba] Novios boda",
      script: [
        "Hola! nos vamos a casar y estamos cotizando",
        "Es el 14 de marzo del otro año, en una finca en La Calera",
        "Somos más o menos 120 invitados",
        "¿Qué incluye el alquiler de mesas y sillas? ¿y la mantelería?",
      ],
    },
    {
      key: "evento_corporativo",
      label: "Evento corporativo",
      description: "Empresa que necesita mobiliario para un lanzamiento; da los datos de a poco.",
      phone: "570000000202",
      contactName: "[Prueba] Evento corporativo",
      script: [
        "Buenas, les escribo de una empresa",
        "Necesitamos mobiliario para un lanzamiento de producto",
        "Sería para unas 60 personas, en Bogotá",
        "La fecha es el 5 del próximo mes",
        "¿Me pueden enviar una cotización?",
      ],
    },
    {
      key: "cumpleanos_ultimo_minuto",
      label: "Cumpleaños de último minuto",
      description: "Necesita sillas para el fin de semana y tiene prisa.",
      phone: "570000000203",
      contactName: "[Prueba] Cumpleaños urgente",
      script: [
        "Hola necesito 30 sillas para este sábado",
        "Es un cumpleaños en la casa",
        "¿Alcanzan a llevarlas? ¿cuánto sale?",
      ],
    },
  ],
  modulosRecomendados: ["mobiliario"],
};
