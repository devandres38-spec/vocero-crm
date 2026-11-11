/**
 * 070 — Self-test E2E del bloque C: consentimiento con botones, «No acepto»
 * que borra, adjuntos por negocio y la reconciliación del olvido.
 *
 * Conduce la app real con los mocks de canal; el guion hace de cerebro por
 * `/api/bot/*` y el cerebro falso compartido (`scripts/lib/cerebro-falso.mjs`)
 * recibe los despachos y los avisos de olvido. Guion: tests/e2e/us-consentimiento.md.
 *
 * Misma configuración que `e2e-despacho.mjs`, más `OLVIDO_REINTENTO_MS=1500`
 * en la app (para no esperar el minuto del primer reintento). Lo corre
 * `.github/workflows/e2e.yml`; no se corre en el PC de Andres.
 *
 * Sale con código 1 si algún check falla.
 */
import { readFileSync } from "node:fs";
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
const PN = "PN-E2E-1";
const RUN = Date.now().toString(36);
const MARCA = `#${RUN}`;
const DIGITOS = String(Date.now() % 1_000_000).padStart(6, "0");
const telefono = (n) => `57300${DIGITOS}${String(n).padStart(2, "0")}`;
const OMITIDO = "[mensaje con información de salud omitido]";
const BOTONES = [
  { id: "aviso_acepto", title: "Acepto" },
  { id: "aviso_no_acepto", title: "No acepto" },
];
const AVISO = "Antes de seguir, ¿aceptas nuestro aviso de privacidad?";
const NO_ACEPTA =
  "Entendido. Borramos lo que nos escribiste. Si cambias de opinión, escríbenos.";

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
    method: "POST",
    body: JSON.stringify(body),
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
  const waMessageId = `wamid.consent.${RUN}.${nMensaje}`;
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

async function conversaciones() {
  return (await api("/api/conversations")).json?.conversations ?? [];
}
const convDe = (name) =>
  hasta(async () =>
    (await conversaciones()).find((c) => c.contact.name === name),
  );
const mensajesDe = async (convId) =>
  (await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [];

const PERFIL_DEMO = JSON.parse(
  readFileSync("src/server/privacy/perfil-privacidad-demo.json", "utf8"),
);

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
  // El perfil de la demo filtra salud: los adjuntos quedan apagados (D1).
  await conBase(async (sql) => {
    const p = PERFIL_DEMO;
    await sql`
      insert into privacy_profile
        (id, organization_id, profile_name, profile_version, country, sensitive_terms, allowlist, fingerprint, adjuntos)
      select 'prv_e2e_' || o.id, o.id, ${p.perfil}, ${p.versionPerfil}, ${p.pais},
             ${sql.json(p.sensible)}, ${p.permitidos}, ${p.huella}, false
      from organization o
      where not exists (select 1 from privacy_profile x where x.organization_id = o.id)`;
    const [{ n }] =
      await sql`select count(*)::int as n from privacy_profile where adjuntos = false`;
    ok(
      "perfil de privacidad de la demo, con los adjuntos apagados",
      n > 0,
      String(n),
    );
  });
  const enc = await encenderAgente(api);
  ok(
    "el agente se enciende con el cerebro falso sano",
    enc.res.ok,
    JSON.stringify(enc.json),
  );
}

/** Un cliente escribe, el despacho llega y el «cerebro» manda el aviso con botones. */
async function avisoConBotones(cerebro, n, nombre) {
  await entranteWa(telefono(n), nombre, { text: `hola ${MARCA}` });
  const conv = await convDe(nombre);
  if (!conv) return null;
  await hasta(() => cerebro.de(conv.id)[0], COALESCE + 12000);
  const r = await bot("/api/bot/messages", {
    conversationId: conv.id,
    text: AVISO,
    buttons: BOTONES,
  });
  ok(
    `${nombre}: el aviso con botones sale (200)`,
    r.res.status === 200,
    JSON.stringify(r.json),
  );
  return conv;
}

async function botones(cerebro) {
  console.log(
    "\n== 070: el aviso sale con botones y el botón tocado llega al cerebro ==",
  );
  const nombre = `Paciente Acepta ${MARCA}`;
  const conv = await avisoConBotones(cerebro, 1, nombre);
  ok("la conversación está en la bandeja", Boolean(conv));
  if (!conv) return;

  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  const interactivo = outbox
    .map((o) => JSON.stringify(o))
    .find((j) => j.includes(AVISO));
  ok(
    "a WhatsApp salió un interactivo con los dos botones",
    Boolean(interactivo) &&
      interactivo.includes('"type":"interactive"') &&
      BOTONES.every((b) =>
        interactivo.includes(JSON.stringify({ id: b.id, title: b.title })),
      ),
    interactivo ?? JSON.stringify(outbox.at(-1)),
  );
  const saliente = (await mensajesDe(conv.id)).find(
    (m) => m.direction === "out" && m.text === AVISO,
  );
  ok(
    "la bandeja muestra el aviso con sus botones",
    JSON.stringify(saliente?.buttons) === JSON.stringify(BOTONES),
    JSON.stringify(saliente),
  );

  const cuatro = await bot("/api/bot/messages", {
    conversationId: conv.id,
    text: AVISO,
    buttons: [...BOTONES, { id: "c", title: "C" }, { id: "d", title: "D" }],
  });
  ok(
    "cuatro botones: 422 invalid_body",
    cuatro.res.status === 422,
    String(cuatro.res.status),
  );

  const antes = cerebro.de(conv.id).length;
  await entranteWa(telefono(1), nombre, {
    type: "interactive",
    interactive: {
      type: "button_reply",
      button_reply: { id: "aviso_acepto", title: "Acepto" },
    },
  });
  const turno = await hasta(() => cerebro.de(conv.id)[antes], COALESCE + 12000);
  const ultimo = turno?.evento?.messages?.at(-1);
  ok(
    "el despacho lleva buttonId al final del mensaje",
    ultimo?.text === "Acepto" &&
      ultimo?.buttonId === "aviso_acepto" &&
      Object.keys(ultimo).at(-1) === "buttonId",
    JSON.stringify(ultimo),
  );

  const cns = await bot("/api/bot/consent", {
    conversationId: conv.id,
    kind: "aviso_privacidad",
    granted: true,
    noticeVersion: "aviso-e2e-1",
    sourceMessageId: ultimo?.id,
  });
  ok(
    "consent registra la aceptación (201)",
    cns.res.status === 201 && /^cns_/.test(cns.json?.id ?? ""),
    JSON.stringify(cns.json),
  );
  const ctx = await api(`/api/bot/context?conversationId=${conv.id}`, {
    headers: { "x-api-key": BOT_KEY },
  });
  ok(
    "el contexto trae el consentimiento",
    ctx.json?.consent?.avisoPrivacidad?.granted === true &&
      ctx.json?.consent?.marketing === null,
    JSON.stringify(ctx.json?.consent),
  );
  const sinRechazo = await bot("/api/bot/forget", {
    conversationId: conv.id,
    reason: "no_acepta",
  });
  ok(
    "forget sin un rechazo: 409 sin_rechazo",
    sinRechazo.res.status === 409 &&
      sinRechazo.json?.error?.code === "sin_rechazo",
    JSON.stringify(sinRechazo.json),
  );
  ok("y no borró nada", (await mensajesDe(conv.id)).length >= 3);
}

async function noAcepto(cerebro) {
  console.log(
    "\n== 070: «No acepto» borra la conversación y solo queda el texto fijo ==",
  );
  const nombre = `Paciente Rechaza ${MARCA}`;
  const conv = await avisoConBotones(cerebro, 2, nombre);
  if (!conv) return ok("la conversación está en la bandeja", false);
  const antes = cerebro.de(conv.id).length;
  const boton = await entranteWa(telefono(2), nombre, {
    type: "interactive",
    interactive: {
      type: "button_reply",
      button_reply: { id: "aviso_no_acepto", title: "No acepto" },
    },
  });
  const turno = await hasta(() => cerebro.de(conv.id)[antes], COALESCE + 12000);
  const ultimo = turno?.evento?.messages?.at(-1);
  ok(
    "el despacho lleva el «No acepto» con su buttonId",
    ultimo?.buttonId === "aviso_no_acepto",
    JSON.stringify(ultimo),
  );

  const ids = await conBase(async (sql) =>
    (
      await sql`select wa_message_id from message where conversation_id = ${conv.id} and wa_message_id is not null`
    ).map((f) => f.wa_message_id),
  );
  ok(
    "antes de borrar, los entrantes tienen su webhook_event",
    ids.includes(boton.waMessageId),
    JSON.stringify(ids),
  );

  const rechazo = await bot("/api/bot/consent", {
    conversationId: conv.id,
    kind: "aviso_privacidad",
    granted: false,
    noticeVersion: "aviso-e2e-1",
  });
  ok("consent registra el rechazo", rechazo.res.status === 201);
  const f = await bot("/api/bot/forget", {
    conversationId: conv.id,
    reason: "no_acepta",
  });
  ok(
    "forget borra (200) los mensajes de la conversación",
    f.res.status === 200 && f.json?.deleted >= 3,
    JSON.stringify(f.json),
  );
  const otra = await bot("/api/bot/forget", {
    conversationId: conv.id,
    reason: "no_acepta",
  });
  ok(
    "repetirlo da deleted 0",
    otra.res.status === 200 && otra.json?.deleted === 0,
    JSON.stringify(otra.json),
  );
  const fijo = await bot("/api/bot/messages", {
    conversationId: conv.id,
    text: NO_ACEPTA,
  });
  ok("el texto fijo sale", fijo.res.status === 200, JSON.stringify(fijo.json));

  const quedan = await mensajesDe(conv.id);
  ok(
    "en la bandeja solo queda el texto fijo",
    quedan.length === 1 && quedan[0]?.text === NO_ACEPTA,
    JSON.stringify(quedan.map((m) => m.text)),
  );
  await conBase(async (sql) => {
    const patrones = ids.map((id) => `%"${id}"%`);
    const [{ n }] =
      await sql`select count(*)::int as n from webhook_event where payload::text like any(${patrones})`;
    ok(
      "webhook_event ya no guarda las entregas de esos mensajes",
      n === 0,
      String(n),
    );
    const [{ c }] =
      await sql`select count(*)::int as c from consent where conversation_id = ${conv.id}`;
    ok("el registro del consentimiento se conserva", c === 1, String(c));
  });
}

async function adjuntosApagados(cerebro) {
  console.log(
    "\n== 070: con los adjuntos apagados, la foto de un paciente no se descarga ==",
  );
  const nombre = `Paciente Foto ${MARCA}`;
  await entranteWa(telefono(3), nombre, {
    type: "image",
    mediaId: `media.${RUN}`,
    caption: "mira",
  });
  const conv = await convDe(nombre);
  if (!conv) return ok("la conversación está en la bandeja", false);
  const llego = await hasta(() => cerebro.de(conv.id)[0], COALESCE + 12000);
  const m = llego?.evento?.messages?.at(-1);
  ok(
    "el despacho lleva la imagen sin mediaId",
    m?.type === "image" && m?.mediaId === null,
    JSON.stringify(m),
  );
  await conBase(async (sql) => {
    const [a] = await sql`
      select a.wa_media_id, a.fetch_status, a.fetch_error from media_asset a
      join message m on m.media_asset_id = a.id where m.conversation_id = ${conv.id}`;
    ok(
      "media_asset sin media id, fallido por adjuntos_apagados",
      a?.wa_media_id === null &&
        a?.fetch_status === "failed" &&
        a?.fetch_error === "adjuntos_apagados",
      JSON.stringify(a),
    );
  });

  console.log("\n== 070: una tarjeta de contacto pasa por el filtro ==");
  const tarjeta = `Paciente Tarjeta ${MARCA}`;
  await entranteWa(telefono(4), tarjeta, {
    type: "contacts",
    contacts: [
      {
        name: {
          formatted_name: "Mamá",
          first_name: "Mamá",
          last_name: `Apellido${RUN}`,
        },
        phones: [{ phone: "+57 311 555 0101", wa_id: "573115550101" }],
        emails: [{ email: `mama.${RUN}@mail.com` }],
      },
    ],
  });
  const ct = await convDe(tarjeta);
  if (!ct) return ok("la conversación está en la bandeja", false);
  await conBase(async (sql) => {
    const [a] = await sql`
      select a.payload from media_asset a join message m on m.media_asset_id = a.id
      where m.conversation_id = ${ct.id}`;
    ok(
      "media_asset guarda solo el nombre y el teléfono enmascarado",
      JSON.stringify(a?.payload) ===
        JSON.stringify([
          {
            name: { formatted_name: "Mamá", first_name: "Mamá" },
            phones: [{ phone: "[telefono]" }],
          },
        ]),
      JSON.stringify(a?.payload),
    );
    const [{ n }] = await sql`
      select count(*)::int as n from webhook_event
      where payload::text like ${`%Apellido${RUN}%`} or payload::text like ${`%mama.${RUN}%`} or payload::text like '%573115550101%'`;
    ok(
      "webhook_event no guarda apellido, correo ni teléfono de la tarjeta",
      n === 0,
      String(n),
    );
  });
}

async function olvidoConCerebroCaido(cerebro) {
  console.log(
    "\n== 070: con el cerebro caído, el olvido queda pendiente y llega cuando vuelve ==",
  );
  const nombre = `Paciente Olvido ${MARCA}`;
  await entranteWa(telefono(5), nombre, { text: `hola ${MARCA}` });
  const conv = await convDe(nombre);
  if (!conv) return ok("la conversación está en la bandeja", false);
  await hasta(() => cerebro.de(conv.id)[0], COALESCE + 12000);

  await cerebro.apagar();
  const del = await api(`/api/conversations/${conv.id}`, { method: "DELETE" });
  ok(
    "eliminar responde, con el cerebro sin confirmar",
    del.res.ok && del.json?.agente === "sin_confirmar",
    JSON.stringify(del.json),
  );
  const pendiente = await conBase(
    async (sql) =>
      (
        await sql`select attempts, status from olvido_pendiente where conversation_id = ${conv.id}`
      )[0],
  );
  ok(
    "queda en olvido_pendiente",
    pendiente?.status === "pendiente" && pendiente?.attempts === 1,
    JSON.stringify(pendiente),
  );

  await cerebro.encender();
  const llego = await hasta(() => cerebro.olvidos(conv.id)[0], 30000);
  ok(
    "al volver, el cerebro recibe conversation.deleted, firmado",
    Boolean(llego) && llego.firmaOk,
    JSON.stringify(llego?.evento),
  );
  const fila = await hasta(
    () =>
      conBase(async (sql) =>
        (
          await sql`select count(*)::int as n from olvido_pendiente where conversation_id = ${conv.id}`
        )[0].n === 0
          ? "ok"
          : null,
      ),
    10000,
  );
  ok("y la fila pendiente se borra", fila === "ok");
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
    await botones(cerebro);
    await noAcepto(cerebro);
    await adjuntosApagados(cerebro);
    await olvidoConCerebroCaido(cerebro);
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
