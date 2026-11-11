/**
 * 073 — Self-test E2E del bloque F: autenticación por negocio.
 *
 * 1. `/api/bot/*` con dos negocios: cada cerebro con la credencial derivada
 *    de SU negocio; el cruce da 401 y la llave cruda sin cabecera, 409.
 * 2. El webhook de WhatsApp firmado con el App Secret del negocio, registrado
 *    con el comando real (`pnpm meta:secreto`, por la entrada estándar): con
 *    la firma correcta el mensaje entra; con la de otro, o sin firma, 401 y
 *    nada en `webhook_event` ni en `message`.
 *
 * Corre DESPUÉS de los demás arneses (usa el negocio del operador que ellos
 * dejan conectado a PN-E2E-1) y deshace lo suyo: borra el segundo negocio y el
 * secreto. Guion: tests/e2e/us-multinegocio.md. Lo corre `.github/workflows/e2e.yml`.
 * Sale con código 1 si algún check falla.
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import postgres from "postgres";
import { cabecerasDelCerebro } from "./lib/credencial.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const VT = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
const PN = "PN-E2E-1";
const RUN = Date.now().toString(36);
const SECRETO_A = createHmac("sha256", RUN).update("a").digest("hex").slice(0, 32);
const SECRETO_OTRO = createHmac("sha256", RUN).update("b").digest("hex").slice(0, 32);

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

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

async function bot(ruta, cabeceras) {
  const r = await fetch(`${BASE}${ruta}`, { headers: cabeceras });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, json };
}

function cuerpoWa(wamid, texto) {
  const from = `5730077${String(Date.now()).slice(-5)}`;
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-E2E",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "573000000000", phone_number_id: PN },
              contacts: [{ profile: { name: `Multi ${RUN}` }, wa_id: from }],
              messages: [
                {
                  from,
                  id: wamid,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: texto },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}
const firmar = (cuerpo, secreto) =>
  `sha256=${createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex")}`;
async function postWa(cuerpo, firma) {
  const r = await fetch(`${BASE}/api/webhooks/wa/${VT}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(firma ? { "x-hub-signature-256": firma } : {}) },
    body: cuerpo,
  });
  return r.status;
}
async function rastro(wamid) {
  const [{ ev }] = await sql`select count(*)::int as ev from webhook_event where payload::text like ${`%${wamid}%`}`;
  const [{ msg }] = await sql`select count(*)::int as msg from message where wa_message_id = ${wamid}`;
  return { ev, msg };
}
async function hasta(cond, ms = 15000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const [a] = await sql`
    select organization_id as id from meta_credentials where phone_number_id = ${PN} limit 1`;
  const A = a?.id;
  const B = `org_multi_${RUN}`;
  ok("el negocio A (el del operador, con PN-E2E-1)", Boolean(A), String(A));
  if (!A) return;
  try {
    console.log("== /api/bot/* por negocio ==");
    await sql`insert into organization (id, name, slug) values (${B}, ${`E2E multinegocio ${RUN}`}, ${B})`;
    const [conv] = await sql`select id from conversation where organization_id = ${A} limit 1`;
    const ctx = (cab) => bot(`/api/bot/context?conversationId=${conv?.id ?? "cv_x"}`, cab);

    const deA = await ctx(cabecerasDelCerebro(BOT_KEY, A));
    ok("A con su credencial ve su conversación", deA.status === 200, String(deA.status));
    const deB = await ctx(cabecerasDelCerebro(BOT_KEY, B));
    ok("B con su credencial NO ve la conversación de A (404)", deB.status === 404, String(deB.status));
    const cruce = await ctx({
      "x-vocero-organization": B,
      "x-api-key": cabecerasDelCerebro(BOT_KEY, A)["x-api-key"],
    });
    ok("la credencial de A con la cabecera de B → 401", cruce.status === 401, String(cruce.status));
    const cruda = await ctx({ "x-vocero-organization": A, "x-api-key": BOT_KEY });
    ok("la llave cruda con cabecera → 401", cruda.status === 401, String(cruda.status));
    const sinCabecera = await ctx({ "x-api-key": BOT_KEY });
    ok(
      "con dos negocios, la llave cruda sin cabecera → 409 organizacion_requerida",
      sinCabecera.status === 409 && sinCabecera.json?.error?.code === "organizacion_requerida",
      JSON.stringify(sinCabecera.json),
    );
    const inexistente = await ctx(cabecerasDelCerebro(BOT_KEY, `org_no_${RUN}`));
    ok("un negocio que no existe → 401", inexistente.status === 401, String(inexistente.status));

    console.log("== Webhook firmado con el App Secret del negocio ==");
    const reg = spawnSync(
      "pnpm",
      ["meta:secreto", "--", "--organizacion", A, "--canal", "whatsapp"],
      { input: `${SECRETO_A}\n`, encoding: "utf8", env: process.env, shell: process.platform === "win32" },
    );
    const salida = `${reg.stdout ?? ""}${reg.stderr ?? ""}`;
    ok("pnpm meta:secreto registra el secreto (entrada estándar)", reg.status === 0, salida.slice(-300));
    ok(
      "y solo muestra los últimos 4",
      salida.includes(SECRETO_A.slice(-4)) && !salida.includes(SECRETO_A),
    );
    const [fila] = await sql`select secret_cipher from meta_app where organization_id = ${A} and canal = 'whatsapp'`;
    ok("en la base va cifrado", Boolean(fila) && !String(fila.secret_cipher).includes(SECRETO_A));

    const malo = `wamid.multi.malo.${RUN}`;
    const cuerpoMalo = cuerpoWa(malo, "firmado con otro secreto");
    ok("firmado con otro secreto → 401", (await postWa(cuerpoMalo, firmar(cuerpoMalo, SECRETO_OTRO))) === 401);
    const sin = `wamid.multi.sin.${RUN}`;
    ok("sin firma → 401", (await postWa(cuerpoWa(sin, "sin firma"))) === 401);
    await new Promise((r) => setTimeout(r, 1500));
    const rMalo = await rastro(malo);
    const rSin = await rastro(sin);
    ok(
      "y de esos dos, nada en webhook_event ni en message",
      rMalo.ev + rMalo.msg + rSin.ev + rSin.msg === 0,
      JSON.stringify({ rMalo, rSin }),
    );

    const bueno = `wamid.multi.bueno.${RUN}`;
    const cuerpoBueno = cuerpoWa(bueno, "firmado con el secreto de A");
    ok("firmado con el secreto de A → 200", (await postWa(cuerpoBueno, firmar(cuerpoBueno, SECRETO_A))) === 200);
    ok(
      "el mensaje entra en la bandeja de A",
      await hasta(async () => {
        const [m] = await sql`select organization_id from message where wa_message_id = ${bueno}`;
        return m?.organization_id === A;
      }),
    );
  } finally {
    await sql`delete from meta_app where organization_id = ${A}`.catch(() => {});
    await sql`delete from organization where id = ${B}`.catch(() => {});
    await sql.end();
  }
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(() => {
    console.log(`\n${checks - failures}/${checks} checks en verde`);
    process.exit(failures > 0 ? 1 : 0);
  });
