/**
 * 072 — Self-test E2E del bloque E: retención por negocio con borrado diario,
 * contra Postgres REAL (el SQL que las pruebas unitarias solo leen).
 *
 * Siembra directo en la base dos negocios propios: A con `retencion_dias = 7`
 * y B sin perfil de privacidad (90 por defecto), cada uno con filas de 1, 10 y
 * 100 días en todas las tablas que toca la retención. Corre una pasada por
 * `POST /api/dev/retencion` (solo con mocks) y comprueba fila a fila qué se
 * vació, qué se quedó y que las cifras que cuenta Resultados no cambian. Una
 * segunda pasada no cambia nada. Guion: tests/e2e/us-retencion.md.
 *
 * Lo corre `.github/workflows/e2e.yml`; no se corre en el PC de Andres.
 * Sale con código 1 si algún check falla.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const BORRADO = "[mensaje borrado por antigüedad]";
const DIA = 24 * 3_600_000;
const AHORA = new Date();
const hace = (dias) => new Date(AHORA.getTime() - dias * DIA).toISOString();

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

/** Los ids de un negocio: `<cosa>_<negocio>` (el negocio ya lleva la corrida). */
const idDe = (org) => (cosa) => `${cosa}_${org}`;

async function sembrar(org, dias) {
  const id = idDe(org);
  await sql`insert into organization (id, name, slug) values (${org}, ${`E2E retención ${org}`}, ${org})`;
  if (dias !== null) {
    await sql`
      insert into privacy_profile
        (id, organization_id, profile_name, profile_version, country, sensitive_terms, allowlist, fingerprint, retencion_dias)
      values (${id("prv")}, ${org}, 'e2e', 1, 'CO', null, '{}', ${"0".repeat(64)}, ${dias})`;
  }

  // Un contacto inactivo (100 días) y uno activo (escribió ayer).
  await sql`
    insert into contact (id, organization_id, wa_identity, name, phone, notes, ficha, created_at, updated_at) values
      (${id("ct_inactivo")}, ${org}, ${id("57300")}, 'Ana Inactiva', '573000000001', 'nota del contacto',
        ${sql.json({ motivo: "limpieza" })}, ${hace(100)}::timestamp, ${hace(100)}::timestamp),
      (${id("ct_activo")}, ${org}, ${id("57301")}, 'Beto Activo', '573000000002', 'nota del activo',
        ${sql.json({ motivo: "ortodoncia" })}, ${hace(100)}::timestamp, ${hace(100)}::timestamp)`;
  await sql`
    insert into conversation (id, organization_id, contact_id, last_message_at, created_at) values
      (${id("cv_inactiva")}, ${org}, ${id("ct_inactivo")}, ${hace(100)}::timestamp, ${hace(100)}::timestamp),
      (${id("cv_activa")}, ${org}, ${id("ct_activo")}, ${hace(1)}::timestamp, ${hace(100)}::timestamp)`;

  // Adjuntos: uno viejo solo, uno compartido con un mensaje reciente, el de
  // un anuncio, y dos huérfanos (viejo y nuevo).
  await sql`
    insert into media_asset (id, organization_id, kind, caption, fetch_status, created_at) values
      (${id("ma_viejo")}, ${org}, 'image', 'pie viejo', 'failed', ${hace(100)}::timestamp),
      (${id("ma_compartido")}, ${org}, 'image', null, 'failed', ${hace(10)}::timestamp),
      (${id("ma_anuncio")}, ${org}, 'image', null, 'failed', ${hace(100)}::timestamp),
      (${id("ma_huerfano")}, ${org}, 'document', null, 'failed', ${hace(100)}::timestamp),
      (${id("ma_huerfano_nuevo")}, ${org}, 'document', null, 'failed', ${hace(1)}::timestamp)`;

  const cv = id("cv_inactiva");
  const cva = id("cv_activa");
  await sql`
    insert into message (id, organization_id, conversation_id, direction, type, text, buttons, media_asset_id, origin, ai_generated, status, created_at) values
      (${id("m_viejo")}, ${org}, ${cv}, 'in', 'text', 'hola, quiero una cita', null, null, 'operator', false, 'delivered', ${hace(10)}::timestamp),
      (${id("m_out_viejo")}, ${org}, ${cv}, 'out', 'text', '¿Aceptas el aviso?',
        ${sql.json([{ id: "aviso_acepto", title: "Acepto" }])}, null, 'ai', true, 'read', ${hace(10)}::timestamp),
      (${id("m_muy_viejo")}, ${org}, ${cv}, 'in', 'image', null, null, ${id("ma_viejo")}, 'operator', false, 'delivered', ${hace(100)}::timestamp),
      (${id("m_comp_viejo")}, ${org}, ${cv}, 'out', 'image', null, null, ${id("ma_compartido")}, 'operator', false, 'failed', ${hace(10)}::timestamp),
      (${id("m_anuncio")}, ${org}, ${cv}, 'in', 'image', null, null, ${id("ma_anuncio")}, 'operator', false, 'delivered', ${hace(100)}::timestamp),
      (${id("m_reciente")}, ${org}, ${cva}, 'in', 'text', 'sigo interesado', null, null, 'operator', false, 'delivered', ${hace(1)}::timestamp),
      (${id("m_comp_nuevo")}, ${org}, ${cva}, 'out', 'image', null, null, ${id("ma_compartido")}, 'operator', false, 'sent', ${hace(1)}::timestamp),
      (${id("m_justo")}, ${org}, ${cva}, 'in', 'text', 'justo en el corte', null, null, 'operator', false, 'delivered', ${(dias ?? 90) === 7 ? hace(7) : hace(90)}::timestamp)`;
  await sql`
    insert into ad_attribution (id, organization_id, contact_id, conversation_id, headline, image_asset_id, raw, created_at)
    values (${id("ad")}, ${org}, ${id("ct_inactivo")}, ${cv}, 'Blanqueamiento', ${id("ma_anuncio")}, ${sql.json({})}, ${hace(100)}::timestamp)`;
  await sql`
    insert into consent (id, organization_id, contact_id, conversation_id, kind, granted, notice_version, created_at)
    values (${id("cs")}, ${org}, ${id("ct_inactivo")}, ${cv}, 'aviso_privacidad', true, 'v1', ${hace(100)}::timestamp)`;

  await sql`
    insert into conversation_note (id, organization_id, conversation_id, texto, created_at) values
      (${id("n_viejo")}, ${org}, ${cv}, 'llamar el lunes', ${hace(10)}::timestamp),
      (${id("n_nuevo")}, ${org}, ${cva}, 'llamar mañana', ${hace(1)}::timestamp)`;
  await sql`
    insert into booking (id, organization_id, contact_id, conversation_id, scheduled_at, duration_minutes, notes, created_at) values
      (${id("b_pasada")}, ${org}, ${id("ct_inactivo")}, ${cv}, ${hace(9)}::timestamp, 30, 'trae radiografía', ${hace(10)}::timestamp),
      (${id("b_futura")}, ${org}, ${id("ct_activo")}, ${cva}, ${hace(-5)}::timestamp, 30, 'primera vez', ${hace(10)}::timestamp)`;
  await sql`insert into pipeline_stage (id, organization_id, name, position) values (${id("st")}, ${org}, 'Perdido', 0)`;
  await sql`insert into lead (id, organization_id, contact_id, stage_id) values (${id("ld")}, ${org}, ${id("ct_inactivo")}, ${id("st")})`;
  await sql`
    insert into lead_stage_event (id, organization_id, lead_id, contact_id, to_stage_name, to_stage_kind, loss_reason, loss_note, occurred_at) values
      (${id("e_viejo")}, ${org}, ${id("ld")}, ${id("ct_inactivo")}, 'Perdido', 'lost', 'precio', 'le pareció caro', ${hace(10)}::timestamp),
      (${id("e_nuevo")}, ${org}, ${id("ld")}, ${id("ct_inactivo")}, 'Perdido', 'lost', 'precio', 'lo piensa', ${hace(1)}::timestamp)`;
  await sql`insert into agent_test_run (id, organization_id) values (${id("run")}, ${org})`;
  await sql`
    insert into agent_test_case (id, organization_id, run_id, persona, transcript, hallazgos, created_at) values
      (${id("c_viejo")}, ${org}, ${id("run")}, 'curioso', ${sql.json([{ de: "persona", texto: "hola" }])}, ${sql.json(["ok"])}, ${hace(10)}::timestamp),
      (${id("c_nuevo")}, ${org}, ${id("run")}, 'curioso', ${sql.json([{ de: "persona", texto: "hola" }])}, ${sql.json(["ok"])}, ${hace(1)}::timestamp)`;
  await sql`
    insert into webhook_event (id, organization_id, fuente, payload, huella, status, created_at, updated_at) values
      (${id("w_viejo")}, ${org}, 'whatsapp', ${sql.json({ texto: "filtrado" })}, ${id("h1")}, 'agotado', ${hace(10)}::timestamp, ${hace(10)}::timestamp),
      (${id("w_nuevo")}, ${org}, 'whatsapp', ${sql.json({ texto: "filtrado" })}, ${id("h2")}, 'procesado', ${hace(1)}::timestamp, ${hace(1)}::timestamp)`;
}

/** Lo que Resultados cuenta de los mensajes: filas por dirección, origen y estado. */
async function cifras(org) {
  return sql`
    select direction, origin, status, count(*)::int as n
      from message where organization_id = ${org}
     group by 1, 2, 3 order by 1, 2, 3`;
}

async function pasada() {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${BASE}/api/dev/retencion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ahora: AHORA.toISOString() }),
    });
    if (res.status === 409) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`/api/dev/retencion respondió ${res.status}: ${JSON.stringify(json)}`);
    return json.negocios;
  }
  throw new Error("la pasada del worker no terminó en 30 s");
}

const uno = async (q) => (await q)[0];

async function comprobar(org, dias) {
  const id = idDe(org);
  const viejo10 = dias === 7; // lo de 10 días solo pasa del corte en A
  const msg = async (m) =>
    uno(sql`select text, buttons, media_asset_id from message where id = ${id(m)}`);
  const existe = async (tabla, x) =>
    (await sql`select 1 from ${sql(tabla)} where id = ${id(x)}`).length === 1;

  console.log(`== Negocio ${org} (${dias} días) ==`);
  const mViejo = await msg("m_viejo");
  ok("mensaje de 10 días", mViejo.text === (viejo10 ? BORRADO : "hola, quiero una cita"), mViejo.text);
  const mOut = await msg("m_out_viejo");
  ok(
    "saliente de 10 días con botones",
    viejo10 ? mOut.text === BORRADO && mOut.buttons === null : mOut.buttons !== null,
    JSON.stringify(mOut),
  );
  const mMuy = await msg("m_muy_viejo");
  ok("adjunto de 100 días: el mensaje queda como texto fijo", mMuy.text === BORRADO && mMuy.media_asset_id === null, JSON.stringify(mMuy));
  ok("su adjunto se borró", !(await existe("media_asset", "ma_viejo")));
  ok("el mensaje reciente no se toca", (await msg("m_reciente")).text === "sigo interesado");
  ok("el mensaje justo en el corte no se toca", (await msg("m_justo")).text === "justo en el corte");
  ok("el adjunto compartido con un mensaje reciente se queda", await existe("media_asset", "ma_compartido"));
  ok("el mensaje reciente conserva su adjunto", (await msg("m_comp_nuevo")).media_asset_id === id("ma_compartido"));
  const mAd = await msg("m_anuncio");
  ok("el mensaje viejo del anuncio pierde el adjunto", mAd.media_asset_id === null);
  ok("la imagen de la tarjeta del anuncio se queda", await existe("media_asset", "ma_anuncio"));
  ok("el huérfano viejo se borra", !(await existe("media_asset", "ma_huerfano")));
  ok("el huérfano nuevo se queda", await existe("media_asset", "ma_huerfano_nuevo"));

  ok("nota interna de 10 días", (await existe("conversation_note", "n_viejo")) === !viejo10);
  ok("nota interna reciente se queda", await existe("conversation_note", "n_nuevo"));
  const bPasada = await uno(sql`select notes from booking where id = ${id("b_pasada")}`);
  ok("nota de la cita pasada", viejo10 ? bPasada.notes === null : bPasada.notes === "trae radiografía", bPasada.notes);
  const bFutura = await uno(sql`select notes from booking where id = ${id("b_futura")}`);
  ok("la cita futura conserva su nota", bFutura.notes === "primera vez");
  const eViejo = await uno(sql`select loss_reason, loss_note from lead_stage_event where id = ${id("e_viejo")}`);
  ok(
    "nota de pérdida de 10 días (el motivo se queda)",
    eViejo.loss_reason === "precio" && (viejo10 ? eViejo.loss_note === null : eViejo.loss_note !== null),
    JSON.stringify(eViejo),
  );
  const ctIn = await uno(sql`select name, phone, wa_identity, notes, ficha from contact where id = ${id("ct_inactivo")}`);
  ok(
    "contacto inactivo: sin notas ni ficha; nombre, teléfono e identidad se quedan",
    ctIn.notes === null && ctIn.ficha === null && ctIn.name === "Ana Inactiva" && ctIn.phone === "573000000001" && ctIn.wa_identity === id("57300"),
    JSON.stringify(ctIn),
  );
  const ctAc = await uno(sql`select notes, ficha from contact where id = ${id("ct_activo")}`);
  ok("contacto activo conserva notas y ficha", ctAc.notes !== null && ctAc.ficha !== null, JSON.stringify(ctAc));
  const cViejo = await uno(sql`select transcript, hallazgos from agent_test_case where id = ${id("c_viejo")}`);
  ok("caso del Laboratorio de 10 días", viejo10 ? cViejo.transcript === null && cViejo.hallazgos === null : cViejo.transcript !== null);
  ok("caso del Laboratorio reciente se queda", (await uno(sql`select transcript from agent_test_case where id = ${id("c_nuevo")}`)).transcript !== null);
  ok("webhook agotado de 10 días", (await existe("webhook_event", "w_viejo")) === !viejo10);
  ok("webhook reciente se queda", await existe("webhook_event", "w_nuevo"));
  ok("el consentimiento se queda", await existe("consent", "cs"));
  ok("la tarjeta del anuncio se queda", await existe("ad_attribution", "ad"));
  ok("el lead y la conversación se quedan", (await existe("lead", "ld")) && (await existe("conversation", "cv_inactiva")));
}

async function main() {
  const A = `org_ret_a${RUN}`;
  const B = `org_ret_b${RUN}`;
  try {
    console.log("== Siembra ==");
    await sembrar(A, 7);
    await sembrar(B, null);
    const antes = { A: await cifras(A), B: await cifras(B) };
    ok("dos negocios sembrados", antes.A.length > 0 && antes.B.length > 0);

    console.log("== Primera pasada ==");
    const negocios = await pasada();
    const rA = negocios.find((n) => n.organizationId === A);
    const rB = negocios.find((n) => n.organizationId === B);
    ok("A con sus 7 días", rA?.dias === 7 && rA.saltado === false, JSON.stringify(rA));
    ok("B sin perfil: 90 días", rB?.dias === 90 && rB.saltado === false, JSON.stringify(rB));
    ok("A vació más que B", (rA?.mensajes ?? 0) > (rB?.mensajes ?? 0), `${rA?.mensajes} vs ${rB?.mensajes}`);

    await comprobar(A, 7);
    await comprobar(B, 90);

    console.log("== Resultados y segunda pasada ==");
    const despues = { A: await cifras(A), B: await cifras(B) };
    ok("Resultados cuenta lo mismo en A (filas por dirección, origen y estado)", JSON.stringify(despues.A) === JSON.stringify(antes.A));
    ok("Resultados cuenta lo mismo en B", JSON.stringify(despues.B) === JSON.stringify(antes.B));
    const otra = await pasada();
    for (const org of [A, B]) {
      const r = otra.find((n) => n.organizationId === org);
      const total = r
        ? r.mensajes + r.adjuntos + r.notas + r.citas + r.etapas + r.contactos + r.laboratorio + r.webhooks
        : -1;
      ok(`la segunda pasada no cambia nada en ${org}`, total === 0, JSON.stringify(r));
    }
  } finally {
    await sql`delete from organization where id in (${A}, ${B})`.catch(() => {});
    await sql.end();
  }
  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
