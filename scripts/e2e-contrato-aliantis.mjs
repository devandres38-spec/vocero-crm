/**
 * 071 — Self-test E2E del bloque D (contrato con aliantis-brain): salud con el
 * Agente apagado, historial, omisión, envío idempotente, motivos de Aliantis,
 * notas sin salud y avisos de traspaso por Telegram.
 *
 * El guion hace de cerebro por `/api/bot/*`; el cerebro falso compartido
 * (`scripts/lib/cerebro-falso.mjs`) recibe los despachos. Telegram es el mock
 * de desarrollo (`TELEGRAM_API_BASE_URL` → `/api/dev/telegram-mock`).
 * Guion: tests/e2e/us-contrato-aliantis.md. Lo corre `.github/workflows/e2e.yml`
 * (con `AVISOS=on`); no se corre en el PC de Andres.
 *
 * Sale con código 1 si algún check falla.
 */
import postgres from "postgres";
import {
  apagarAgente,
  encenderAgente,
  levantarCerebroFalso,
  urlDelDespacho,
} from "./lib/cerebro-falso.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const COALESCE = Number(process.env.AGENT_COALESCE_MS ?? 6000);
const TRAS_LA_VENTANA = COALESCE + 4000;
const PN = "PN-E2E-1";
const RUN = Date.now().toString(36);
const MARCA = `#${RUN}`;
const DIGITOS = String(Date.now() % 1_000_000).padStart(6, "0");
const telefono = (n) => `57301${DIGITOS}${String(n).padStart(2, "0")}`;
const OMITIDO = "[mensaje con información de salud omitido]";
const GRUPO = "-100777";

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length)
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const bot = (path, body) =>
  api(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "x-api-key": BOT_KEY },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hasta(cond, ms = 15000, paso = 250) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > fin) return null;
    await sleep(paso);
  }
}

let nMensaje = 0;
async function entranteWa(from, name, extra) {
  nMensaje++;
  const waMessageId = `wamid.contrato.${RUN}.${nMensaje}`;
  const r = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from,
      name,
      waMessageId,
      ...extra,
    }),
  });
  return { ...r, waMessageId };
}

const conversaciones = async () =>
  (await api("/api/conversations")).json?.conversations ?? [];
const convDe = (name) =>
  hasta(async () =>
    (await conversaciones()).find((c) => c.contact.name === name),
  );
const mensajesDe = async (convId) =>
  (await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [];
const avisosTelegram = async () =>
  (await api("/api/dev/telegram-mock/_state")).json?.avisos ?? [];

async function conBase(fn) {
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

async function preparar() {
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({
      wabaId: "WABA-E2E",
      phoneNumberId: PN,
      token: "tok-e2e",
    }),
  });
  ok(
    "conexión de WhatsApp guardada (wa-mock)",
    conn.res.ok,
    JSON.stringify(conn.json),
  );
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  await api("/api/dev/telegram-mock/_state", { method: "DELETE" });
  await conBase(async (sql) => {
    // Lo que haría `pnpm avisos:grupo` en cada negocio de la base de prueba.
    await sql`
      insert into aviso_canal (organization_id, telegram_chat_id)
      select o.id, ${GRUPO} from organization o
      on conflict (organization_id) do update set telegram_chat_id = excluded.telegram_chat_id`;
    const [{ n }] = await sql`select count(*)::int as n from privacy_profile`;
    ok(
      "hay perfil de privacidad (lo registró un guion anterior o se registra aquí)",
      n > 0,
      String(n),
    );
  });
}

async function saludConElAgenteApagado(cerebro) {
  console.log(
    "\n== 3.8: con el Agente apagado, lo de salud se despacha y cabe un mensaje de seguridad ==",
  );
  await apagarAgente(api);
  const nombre = `Paciente Urgencia ${MARCA}`;
  await entranteWa(telefono(1), nombre, {
    text: "me duele mucho la muela desde ayer",
  });
  const conv = await convDe(nombre);
  if (!conv) return ok("la conversación está en la bandeja", false);
  const llego = await hasta(() => cerebro.de(conv.id)[0], COALESCE + 12000);
  const c = llego?.evento?.conversation;
  ok(
    "el despacho llega con conversation.agentEnabled: false, al final",
    c?.agentEnabled === false && Object.keys(c ?? {}).at(-1) === "agentEnabled",
    JSON.stringify(c),
  );
  const sinMotivo = await bot("/api/bot/messages", {
    conversationId: conv.id,
    text: "Hola",
  });
  ok(
    "sin motivo: 409 agente_apagado",
    sinMotivo.json?.error?.code === "agente_apagado",
    JSON.stringify(sinMotivo.json),
  );
  const seguridad = await bot("/api/bot/messages", {
    conversationId: conv.id,
    text: "Si es una urgencia, llama ya al 123.",
    motivo: "seguridad",
  });
  ok(
    "con motivo seguridad: se envía",
    seguridad.res.status === 200,
    JSON.stringify(seguridad.json),
  );
  const otra = await bot("/api/bot/messages", {
    conversationId: conv.id,
    text: "Otro mensaje",
    motivo: "seguridad",
  });
  ok(
    "un segundo mensaje de seguridad: 409",
    otra.json?.error?.code === "agente_apagado",
    JSON.stringify(otra.json),
  );

  const normal = `Paciente Normal ${MARCA}`;
  await entranteWa(telefono(2), normal, {
    text: `hola, ¿abren el sábado? ${MARCA}`,
  });
  const conv2 = await convDe(normal);
  await sleep(TRAS_LA_VENTANA);
  ok(
    "un mensaje sin salud, con el Agente apagado, no se despacha",
    Boolean(conv2) && cerebro.de(conv2.id).length === 0,
    String(conv2 ? cerebro.de(conv2.id).length : "sin conversación"),
  );
  const enc = await encenderAgente(api);
  ok("el Agente se vuelve a encender", enc.res.ok);
  return conv;
}

async function historialYNotas(conv) {
  console.log(
    "\n== history y 3.6: el historial está filtrado, en orden y sin notas ==",
  );
  const nota = await api(`/api/conversations/${conv.id}/notes`, {
    method: "POST",
    body: JSON.stringify({ texto: `tiene diabetes, cel 3001234567 ${MARCA}` }),
  });
  ok(
    "una nota interna con salud se guarda omitida",
    nota.json?.nota?.texto === OMITIDO,
    JSON.stringify(nota.json),
  );
  const h = await bot(`/api/bot/history?conversationId=${conv.id}&limit=50`);
  const msgs = h.json?.messages ?? [];
  ok(
    "el historial trae los mensajes del más viejo al más nuevo",
    msgs.length >= 2 &&
      msgs[0]?.direction === "in" &&
      msgs.at(-1)?.direction === "out",
    JSON.stringify(msgs.map((m) => m.direction)),
  );
  ok(
    "el entrante viene omitido, con sus marcas",
    msgs[0]?.text === OMITIDO && msgs[0]?.privacyFlags?.includes("salud"),
    JSON.stringify(msgs[0]),
  );
  ok("y ninguna nota interna", !JSON.stringify(msgs).includes(MARCA));
  const ajena = await bot("/api/bot/history?conversationId=cv_no_existe");
  ok("una conversación que no existe: 404", ajena.res.status === 404);

  const contacto = await api(`/api/contacts/${conv.contact.id}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: "prefiere que lo llamen al 3001234567" }),
  });
  const notas = await conBase(
    async (sql) =>
      (await sql`select notes from contact where id = ${conv.contact.id}`)[0]
        ?.notes,
  );
  ok(
    "las notas del contacto se guardan con el teléfono enmascarado",
    contacto.res.ok && notas === "prefiere que lo llamen al [telefono]",
    JSON.stringify(notas),
  );
}

async function omision(cerebro) {
  console.log("\n== omit: la segunda red de salud omite en Vocero ==");
  const nombre = `Paciente Omit ${MARCA}`;
  const texto = `tengo una pregunta especial ${MARCA}`;
  const entrada = await entranteWa(telefono(3), nombre, { text: texto });
  const conv = await convDe(nombre);
  if (!conv) return ok("la conversación está en la bandeja", false);
  await hasta(() => cerebro.de(conv.id)[0], COALESCE + 12000);
  const [m] = await mensajesDe(conv.id);
  ok(
    "antes, el texto se guardó tal cual",
    m?.text === texto,
    JSON.stringify(m?.text),
  );
  const r = await bot("/api/bot/omit", {
    conversationId: conv.id,
    messageIds: [m?.id, "msg_no_existe"],
    reason: "salud",
  });
  ok(
    "omit: 200 con omitted 1",
    r.res.status === 200 && r.json?.omitted === 1,
    JSON.stringify(r.json),
  );
  const [despues] = await mensajesDe(conv.id);
  ok(
    "la bandeja muestra el texto omitido",
    despues?.text === OMITIDO,
    JSON.stringify(despues?.text),
  );
  await conBase(async (sql) => {
    const [{ n }] = await sql`
      select count(*)::int as n from webhook_event where payload::text like ${`%"${entrada.waMessageId}"%`}`;
    ok("webhook_event ya no guarda esa entrega", n === 0, String(n));
  });
  const otra = await bot("/api/bot/omit", {
    conversationId: conv.id,
    messageIds: [m?.id],
    reason: "salud",
  });
  ok(
    "repetirlo da el mismo resultado",
    otra.json?.omitted === 1,
    JSON.stringify(otra.json),
  );
  return conv;
}

async function idempotente(conv) {
  console.log(
    "\n== clientMessageId: un reintento no le llega dos veces al paciente ==",
  );
  const texto = `Respuesta idempotente ${MARCA}`;
  const uno = await bot("/api/bot/messages", {
    conversationId: conv.id,
    text: texto,
    clientMessageId: `k-${RUN}`,
  });
  const dos = await bot("/api/bot/messages", {
    conversationId: conv.id,
    text: texto,
    clientMessageId: `k-${RUN}`,
  });
  ok(
    "el primero sale",
    uno.res.status === 200 && !uno.json?.repetido,
    JSON.stringify(uno.json),
  );
  ok(
    "el repetido devuelve el mismo mensaje con repetido: true",
    dos.res.status === 200 &&
      dos.json?.repetido === true &&
      dos.json?.messageId === uno.json?.messageId,
    JSON.stringify(dos.json),
  );
  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  const veces = outbox.filter((o) => JSON.stringify(o).includes(texto)).length;
  ok("a WhatsApp salió una sola vez", veces === 1, String(veces));
}

async function traspasoYAvisos() {
  console.log(
    "\n== 3.7 y 3.10: un traspaso por salud, con su rótulo y su aviso por Telegram sin datos ==",
  );
  const nombre = `Paciente Aviso ${MARCA}`;
  const tel = telefono(4);
  await entranteWa(tel, nombre, { text: `necesito ayuda ${MARCA}` });
  const conv = await convDe(nombre);
  if (!conv) return ok("la conversación está en la bandeja", false);
  const h = await bot("/api/bot/handoff", {
    conversationId: conv.id,
    reason: "salud",
  });
  ok("el traspaso responde 200", h.res.status === 200, JSON.stringify(h.json));
  const guardado = await conBase(
    async (sql) =>
      (
        await sql`select handoff_reason from conversation where id = ${conv.id}`
      )[0]?.handoff_reason,
  );
  ok(
    "el motivo queda como salud (no cae en modelo)",
    guardado === "salud",
    String(guardado),
  );

  const ref = conv.id.slice(0, 8);
  const aviso = await hasta(
    async () =>
      (await avisosTelegram()).find((a) => a.text.includes(`Ref. ${ref}`)),
    20000,
  );
  ok(
    "el aviso llegó al grupo del negocio",
    aviso?.chatId === GRUPO,
    JSON.stringify(aviso),
  );
  ok(
    "con el motivo en palabras",
    Boolean(aviso?.text.includes("salud o urgencia")),
    aviso?.text,
  );
  ok(
    "y sin nombre, teléfono ni texto del paciente",
    Boolean(aviso) &&
      !aviso.text.includes(nombre) &&
      !aviso.text.includes(tel) &&
      !aviso.text.includes(MARCA),
    aviso?.text,
  );

  await entranteWa(tel, nombre, { text: `¿hay alguien? ${MARCA}` });
  const seguimiento = await hasta(
    async () =>
      (await avisosTelegram()).find((a) =>
        a.text.includes(`ref. ${ref} escribió otra vez`),
      ),
    10000,
  );
  ok(
    "la persona escribe otra vez: llega un seguimiento",
    Boolean(seguimiento),
    JSON.stringify(await avisosTelegram()),
  );
  await entranteWa(tel, nombre, { text: `¿hola? ${MARCA}` });
  await sleep(3000);
  const seguimientos = (await avisosTelegram()).filter((a) =>
    a.text.includes(`ref. ${ref} escribió otra vez`),
  );
  ok(
    "un segundo mensaje enseguida no repite el seguimiento (freno de 30 min)",
    seguimientos.length === 1,
    String(seguimientos.length),
  );
}

async function main() {
  const url = urlDelDespacho();
  const cerebro = await levantarCerebroFalso({
    base: BASE,
    botKey: BOT_KEY,
    url,
    responder: "prueba",
  });
  try {
    console.log("== Setup ==");
    await preparar();
    const urgente = await saludConElAgenteApagado(cerebro);
    if (urgente) await historialYNotas(urgente);
    const omitida = await omision(cerebro);
    if (omitida) await idempotente(omitida);
    await traspasoYAvisos();
  } finally {
    if (cookie) await apagarAgente(api).catch(() => {});
    await cerebro.apagar().catch(() => {});
  }
  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
