/**
 * 075 (D15 de Aliantis) — RLS contra Postgres REAL, con el usuario de la app.
 *
 * Lo corre el job «RLS contra Postgres» de `.github/workflows/ci.yml` (cada
 * push de un PR), después de `migrate.mjs` (que crea ese usuario). Sale con
 * código 1 si algún check falla. Guion: tests/e2e/us-rls.md.
 *
 * - OWNER_URL: el dueño de las tablas (siembra y oráculo).
 * - APP_URL: el usuario de la app (sin privilegios, miembro de vocero_app).
 *
 * 1. Catálogo: las 38 tablas con RLS y su política exacta (USING y WITH
 *    CHECK); el usuario de la app sin privilegios; las funciones SECURITY
 *    DEFINER con search_path fijo, sin PUBLIC y solo con ids o conteos.
 * 2. Dos negocios sembrados (A y B) en todas las tablas que se puedan llenar.
 * 3. Por cada tabla, como usuario de la app: SELECT, INSERT, UPDATE y DELETE
 *    cruzados, mover una fila de A a B, sin negocio y con negocio vacío.
 * 4. Sin fuga por el pool (set_config local).
 * 5. El envoltorio real (`conNegocio`, `ConsultaSinNegocio`, `NegocioCruzado`).
 * 6. Las funciones de solo ids.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

const OWNER_URL = process.env.OWNER_URL;
const APP_URL = process.env.APP_URL;
if (!OWNER_URL || !APP_URL) {
  console.error("Faltan OWNER_URL o APP_URL");
  process.exit(1);
}

const A = "org_rls_a";
const B = "org_rls_b";
const CONDICION = "NULLIF(current_setting('app.organization_id',true),'')";

let checks = 0;
let fallas = 0;
function ok(nombre, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${nombre}`);
  else {
    fallas++;
    console.log(`  FAIL ${nombre}${extra ? ` — ${extra}` : ""}`);
  }
}

const opciones = { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } };
const dueno = postgres(OWNER_URL, opciones);
const app = postgres(APP_URL, opciones);

/** Corre `fn` como usuario de la app en una transacción que siempre se deshace. */
async function comoApp(negocio, fn) {
  let resultado;
  try {
    await app.begin(async (tx) => {
      if (negocio !== null) await tx`select set_config('app.organization_id', ${negocio}, true)`;
      resultado = await fn(tx);
      throw new Error("__deshacer__");
    });
  } catch (err) {
    if (err?.message !== "__deshacer__") throw err;
  }
  return resultado;
}

/** El código de error de Postgres de `fn`, o null si no falló. */
async function codigoDe(negocio, fn) {
  try {
    await comoApp(negocio, fn);
    return null;
  } catch (err) {
    return err?.code ?? String(err?.message ?? err);
  }
}

const normal = (s) => String(s ?? "").replace(/::text/g, "").replace(/\s+/g, "").replace(/^\((.*)\)$/, "$1");

async function catalogo() {
  console.log("== Catálogo ==");
  const tablas = await dueno`
    select c.relname as tabla, c.relrowsecurity as rls, c.relforcerowsecurity as forzada,
      exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped) as con_org
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`;
  const conRls = tablas.filter((t) => t.tabla === "organization" || (t.con_org && t.tabla !== "session"));
  ok("38 tablas de negocio (37 con organization_id + organization)", conRls.length === 38, String(conRls.length));
  const politicas = await dueno`select tablename, cmd, qual, with_check, roles from pg_policies where schemaname = 'public'`;
  const mal = [];
  for (const t of conRls) {
    const col = t.tabla === "organization" ? "id" : "organization_id";
    const esperado = `${col}=${CONDICION}`;
    const ps = politicas.filter((p) => p.tablename === t.tabla);
    const bien =
      t.rls &&
      !t.forzada &&
      ps.length === 1 &&
      ps[0].cmd === "ALL" &&
      normal(ps[0].qual) === esperado &&
      normal(ps[0].with_check) === esperado;
    if (!bien) mal.push(`${t.tabla} ${JSON.stringify({ rls: t.rls, forzada: t.forzada, ps: ps.map((p) => [p.cmd, p.qual, p.with_check]) })}`);
  }
  ok("cada una con RLS (sin FORCE) y una política ALL con USING y WITH CHECK exactos", mal.length === 0, mal.join(" | "));
  const sinRls = tablas.filter((t) => !conRls.includes(t)).map((t) => t.tabla).sort();
  ok(
    "sin RLS solo las de Better Auth y las del panel (076)",
    JSON.stringify(sinRls) ===
      JSON.stringify([
        "account",
        "registro_panel",
        "session",
        "superadministrador",
        "two_factor",
        "user",
        "verification",
      ]),
    sinRls.join(", ")
  );

  const [rol] = await app`
    select r.rolsuper, r.rolbypassrls, pg_has_role(current_user, 'vocero_app', 'member') as miembro,
      exists (select 1 from pg_tables t where t.schemaname = 'public' and t.tableowner = current_user) as dueno
    from pg_roles r where r.rolname = current_user`;
  ok(
    "el usuario de la app: sin superusuario, sin BYPASSRLS, no es dueño, miembro de vocero_app",
    rol && !rol.rolsuper && !rol.rolbypassrls && !rol.dueno && rol.miembro,
    JSON.stringify(rol)
  );

  const funciones = await dueno`
    select p.proname as nombre, p.proconfig as config, pg_get_function_result(p.oid) as resultado,
      exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as publica
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef`;
  const RESULTADOS = {
    vocero_membresia: "TABLE(organization_id text, role text, pausado boolean)",
    vocero_organizacion_existe: "boolean",
    vocero_hasta_dos_organizaciones: "text[]",
    vocero_organizaciones: "SETOF text",
    vocero_negocio_por_canal: "text",
    vocero_despachos_vencidos: "TABLE(id text, organization_id text)",
    vocero_eventos_pendientes: "TABLE(id text, organization_id text)",
    vocero_negocios_con_eventos_viejos: "SETOF text",
    vocero_conteo_webhooks: "TABLE(pendientes bigint, agotados bigint)",
    vocero_negocios_con_olvidos: "SETOF text",
    vocero_negocios_con_avisos: "SETOF text",
    vocero_slugs_ocupados: "text[]",
    // 076 — El panel de Andres: solo agregados (y el personal del negocio).
    vocero_superadmin_marcar_totp: "timestamp without time zone",
    vocero_member_sin_superadmin: "trigger",
    vocero_panel_quien: "text",
    vocero_panel_negocios: tabla(
      "id text, nombre text, slug text, creado_en timestamp, pausado_en timestamp, " +
        "agente_encendido boolean, whatsapp boolean, instagram boolean, messenger boolean, " +
        "tiktok boolean, usuarios bigint, conversaciones bigint, conversaciones_7d bigint, " +
        "entrantes_24h bigint, ultimo_entrante_en timestamp, despachos_pendientes bigint, " +
        "a_humano_24h bigint, webhooks_pendientes bigint, webhooks_agotados bigint, retencion_dias integer"
    ),
    vocero_panel_salud: tabla(
      "negocios bigint, pausados bigint, webhooks_pendientes bigint, webhooks_agotados bigint, " +
        "despachos_pendientes bigint, despachos_en_vuelo bigint, despachos_vencidos bigint, " +
        "olvidos_pendientes bigint, avisos_pendientes bigint, ultimo_entrante_en timestamp"
    ),
    vocero_panel_usuarios: tabla(
      "user_id text, nombre text, correo text, rol text, creado_en timestamp, " +
        "ultima_sesion_en timestamp, debe_cambiar_contrasena boolean"
    ),
    vocero_panel_pausar: "timestamp without time zone",
    vocero_panel_restablecer: "void",
    vocero_panel_quitar_usuario: "void",
    vocero_panel_anotar: "void",
    vocero_panel_registro: tabla(
      "cuando timestamp, accion text, negocio_id text, nombre text, detalle jsonb"
    ),
  };
  ok("las 23 funciones SECURITY DEFINER esperadas", funciones.length === 23, funciones.map((f) => f.nombre).join(", "));
  const raras = funciones.filter(
    (f) =>
      !(f.config ?? []).includes("search_path=public, pg_temp") ||
      f.publica ||
      RESULTADOS[f.nombre] !== f.resultado
  );
  ok(
    "cada una: search_path fijo, sin PUBLIC y solo ids o conteos",
    raras.length === 0,
    raras.map((f) => `${f.nombre}: ${f.resultado} ${f.config} publica=${f.publica}`).join(" | ")
  );
  return conRls.map((t) => t.tabla);
}

/** Como lo escribe `pg_get_function_result` (076). */
function tabla(columnas) {
  return `TABLE(${columnas.replace(/timestamp/g, "timestamp without time zone")})`;
}

/** Valores para una columna obligatoria, según su tipo. */
function valorPara(tabla, col, org, ids) {
  const fijos = {
    "meta_app.canal": "whatsapp",
    "consent.kind": "aviso_privacidad",
    "consent.notice_version": "v1",
    "privacy_profile.country": "CO",
    "privacy_profile.retencion_dias": 90,
    "olvido_pendiente.status": "pendiente",
    "aviso_traspaso.status": "pendiente",
    "aviso_canal.telegram_chat_id": org === A ? "-100111" : "-100222",
  };
  const clave = `${tabla}.${col.nombre}`;
  if (clave in fijos) return fijos[clave];
  if (col.nombre === "organization_id") return org;
  if (col.ref) return col.ref === "organization" ? org : ids[`${col.ref}:${org}`];
  switch (col.udt) {
    case "int2":
    case "int4":
    case "int8":
    case "numeric":
    case "float4":
    case "float8":
      return 1;
    case "bool":
      return false;
    case "timestamp":
    case "timestamptz":
      return new Date();
    case "date":
      return "2026-01-01";
    case "jsonb":
    case "json":
      return {};
    case "_text":
      return [];
    default:
      return `${col.nombre}-${tabla}-${org}`;
  }
}

async function sembrar(tablas) {
  console.log("== Siembra (como dueño): A y B en cada tabla que se pueda ==");
  await dueno`delete from organization where id in (${A}, ${B})`;
  await dueno`delete from "user" where id in ('usr_rls_a', 'usr_rls_b')`;
  const ids = {};
  for (const org of [A, B]) {
    await dueno`insert into organization (id, name, slug) values (${org}, ${org}, ${org})`;
    const u = org === A ? "usr_rls_a" : "usr_rls_b";
    await dueno`insert into "user" (id, name, email) values (${u}, ${u}, ${`${u}@rls.test`})`;
    ids[`user:${org}`] = u;
  }
  const columnas = await dueno`
    select c.table_name as tabla, c.column_name as nombre, c.udt_name as udt,
      c.is_nullable = 'NO' as obligatoria, c.column_default is not null as con_defecto,
      (select ccu.table_name from information_schema.key_column_usage k
         join information_schema.referential_constraints rc on rc.constraint_name = k.constraint_name
         join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.unique_constraint_name
       where k.table_name = c.table_name and k.column_name = c.column_name limit 1) as ref
    from information_schema.columns c where c.table_schema = 'public'`;
  const pendientes = tablas.filter((t) => t !== "organization");
  const sembradas = new Set(["organization"]);
  const fallidas = {};
  for (let vuelta = 0; vuelta < 6 && pendientes.length > 0; vuelta++) {
    for (const tabla of [...pendientes]) {
      const cols = columnas.filter((c) => c.tabla === tabla);
      const refs = cols.filter((c) => c.ref && c.ref !== "user" && c.ref !== "organization" && c.ref !== tabla);
      if (refs.some((c) => c.obligatoria && !sembradas.has(c.ref))) continue;
      try {
        for (const org of [A, B]) {
          const fila = {};
          for (const c of cols) {
            const necesaria = (c.obligatoria && !c.con_defecto) || c.nombre === "organization_id" || (c.ref && !c.con_defecto && sembradas.has(c.ref));
            if (!necesaria) continue;
            if (c.ref && c.ref !== "organization" && c.ref !== "user" && !sembradas.has(c.ref)) continue;
            fila[c.nombre] = valorPara(tabla, c, org, ids);
          }
          if (cols.some((c) => c.nombre === "id")) fila.id = fila.id ?? `${tabla}-${org}`;
          const [r] = await dueno`insert into ${dueno(tabla)} ${dueno(fila)} returning *`;
          if (r?.id) ids[`${tabla}:${org}`] = r.id;
        }
        sembradas.add(tabla);
        pendientes.splice(pendientes.indexOf(tabla), 1);
      } catch (err) {
        fallidas[tabla] = err.message;
      }
    }
  }
  const lista = [...sembradas];
  console.log(`  sembradas ${lista.length} de ${tablas.length}; sin sembrar: ${pendientes.join(", ") || "ninguna"}`);
  for (const t of pendientes) console.log(`    ${t}: ${fallidas[t] ?? "dependía de otra"}`);
  const IMPRESCINDIBLES = ["organization", "member", "contact", "conversation", "message", "webhook_event", "dispatch", "meta_app", "privacy_profile", "consent", "aviso_canal"];
  const faltan = IMPRESCINDIBLES.filter((t) => !sembradas.has(t));
  ok("las tablas imprescindibles quedaron sembradas en A y B", faltan.length === 0, faltan.join(", "));
  ok("al menos 30 de las 38 sembradas", lista.length >= 30, String(lista.length));
  return lista;
}

async function cruzados(tablas, sembradas) {
  console.log("== Como usuario de la app, tabla por tabla ==");
  const mal = {};
  const anotar = (t, m) => (mal[t] = [...(mal[t] ?? []), m]);
  for (const t of tablas) {
    const col = t === "organization" ? "id" : "organization_id";
    // INSERT de B con A fijado, e INSERT sin negocio: el WITH CHECK lo para.
    const filaB = t === "organization" ? { id: "org_rls_otra", name: "x" } : { [col]: B };
    const insCruzado = await codigoDe(A, (tx) => tx`insert into ${tx(t)} ${tx(filaB)}`);
    if (insCruzado !== "42501") anotar(t, `INSERT de B con A: ${insCruzado}`);
    const filaA = t === "organization" ? { id: "org_rls_otra2", name: "x" } : { [col]: A };
    const insSin = await codigoDe(null, (tx) => tx`insert into ${tx(t)} ${tx(filaA)}`);
    if (insSin !== "42501") anotar(t, `INSERT sin negocio: ${insSin}`);
    if (!sembradas.includes(t)) continue;

    const [{ n: deA }] = await dueno`select count(*)::int as n from ${dueno(t)} where ${dueno(col)} = ${A}`;
    const visto = await comoApp(A, async (tx) => {
      const [{ total }] = await tx`select count(*)::int as total from ${tx(t)}`;
      const [{ ajenas }] = await tx`select count(*)::int as ajenas from ${tx(t)} where ${tx(col)} <> ${A}`;
      return { total, ajenas };
    });
    if (visto.ajenas !== 0 || visto.total !== deA) anotar(t, `SELECT con A: ${JSON.stringify(visto)} (de A: ${deA})`);

    const upd = await comoApp(A, async (tx) => (await tx`update ${tx(t)} set ${tx(col)} = ${tx(col)} where ${tx(col)} = ${B}`).count);
    if (upd !== 0) anotar(t, `UPDATE de filas de B con A: ${upd}`);
    const del = await comoApp(A, async (tx) => (await tx`delete from ${tx(t)} where ${tx(col)} = ${B}`).count);
    if (del !== 0) anotar(t, `DELETE de filas de B con A: ${del}`);
    if (t !== "organization") {
      const mover = await codigoDe(A, (tx) => tx`update ${tx(t)} set ${tx(col)} = ${B} where ${tx(col)} = ${A}`);
      // Una llave foránea o única puede saltar antes que la política: igual no se mueve nada.
      if (mover !== "42501" && mover !== "23503" && mover !== "23505") anotar(t, `mover de A a B: ${mover}`);
    }
    const sin = await comoApp(null, async (tx) => (await tx`select count(*)::int as n from ${tx(t)}`)[0].n);
    if (sin !== 0) anotar(t, `SELECT sin negocio: ${sin}`);
    const vacio = await comoApp("", async (tx) => (await tx`select count(*)::int as n from ${tx(t)}`)[0].n);
    if (vacio !== 0) anotar(t, `SELECT con negocio vacío: ${vacio}`);
  }
  const lista = Object.entries(mal).map(([t, ms]) => `${t}: ${ms.join("; ")}`);
  ok(
    `cruces bloqueados en las ${tablas.length} tablas (INSERT; y SELECT, UPDATE, DELETE y mover en las sembradas)`,
    lista.length === 0,
    lista.join(" | ")
  );
  const [{ n: bSigue }] = await dueno`select count(*)::int as n from contact where organization_id = ${B}`;
  ok("las filas de B siguen ahí (nada se borró de verdad)", bSigue > 0);
}

async function pool() {
  console.log("== Sin fuga por el pool ==");
  // Misma conexión (max: 1): una transacción con A y, después, una consulta suelta.
  await app.begin(async (tx) => {
    await tx`select set_config('app.organization_id', ${A}, true)`;
    await tx`select 1 from contact limit 1`;
  });
  const [{ n }] = await app`select count(*)::int as n from contact`;
  ok("después de una transacción con A, una consulta sin negocio no ve nada", n === 0, String(n));
  const [{ v }] = await app`select current_setting('app.organization_id', true) as v`;
  ok("y el valor quedó vacío (local a la transacción)", v === null || v === "", String(v));
}

async function envoltorio() {
  console.log("== El envoltorio real de src/lib/db ==");
  const ruta = pathToFileURL(path.resolve(".tmp-rls-envoltorio.mjs")).href;
  const { clienteConRls, conNegocio, ConsultaSinNegocio, NegocioCruzado, trabajoDeFondo, schema } = await import(ruta);
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { count } = await import("drizzle-orm");
  const cruda = postgres(APP_URL, { max: 3, onnotice: () => {}, connection: { TimeZone: "UTC" } });
  const db = drizzle(clienteConRls(cruda), { schema });
  try {
    const filas = await conNegocio(A, () => db.select({ org: schema.contact.organizationId }).from(schema.contact));
    ok("conNegocio(A) ve solo contactos de A", filas.length > 0 && filas.every((f) => f.org === A), JSON.stringify(filas));
    const enTx = await conNegocio(B, () =>
      db.transaction(async (tx) => tx.select({ n: count() }).from(schema.contact))
    );
    ok("db.transaction dentro de conNegocio(B) ve los de B", Number(enTx[0]?.n) > 0);
    let error = null;
    try {
      await db.select().from(schema.contact);
    } catch (err) {
      error = err;
    }
    // Drizzle envuelve el error del cliente: el nuestro viaja en `cause`.
    ok(
      "sin contexto: ConsultaSinNegocio",
      error instanceof ConsultaSinNegocio || error?.cause instanceof ConsultaSinNegocio,
      String(error)
    );
    let cruzado = null;
    try {
      await conNegocio(A, () => conNegocio(B, () => db.select().from(schema.contact)));
    } catch (err) {
      cruzado = err;
    }
    ok("conNegocio(B) dentro de conNegocio(A): NegocioCruzado", cruzado instanceof NegocioCruzado, String(cruzado));
    const sistema = await trabajoDeFondo("e2e", () => db.select({ n: count() }).from(schema.contact));
    ok("en modo sistema no ve ninguna fila de negocio", Number(sistema[0]?.n) === 0);
    // Muchas a la vez, alternando negocios, por el mismo pool: ninguna ve la del otro.
    const vueltas = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const org = i % 2 ? A : B;
        return conNegocio(org, async () => ({
          org,
          filas: await db.select({ org: schema.contact.organizationId }).from(schema.contact),
        }));
      })
    );
    ok(
      "20 consultas a la vez, alternando A y B en el mismo pool: cada una solo ve lo suyo",
      vueltas.every((v) => v.filas.length > 0 && v.filas.every((f) => f.org === v.org))
    );
  } finally {
    await cruda.end();
  }
}

async function funcionesDeSoloIds() {
  console.log("== Funciones de solo ids (como usuario de la app, sin negocio) ==");
  const [m0] = await app`select * from vocero_membresia('usr_no_existe')`;
  ok("vocero_membresia: un usuario sin negocio, nada", m0 === undefined);
  await dueno`insert into member (id, organization_id, user_id, role) values ('mem_rls_a', ${A}, 'usr_rls_a', 'owner') on conflict do nothing`;
  const [m2] = await app`select * from vocero_membresia('usr_rls_a')`;
  ok("vocero_membresia: su negocio y su rol", m2?.organization_id === A && typeof m2?.role === "string", JSON.stringify(m2));
  const [{ e }] = await app`select vocero_organizacion_existe(${A}) as e`;
  const [{ e: no }] = await app`select vocero_organizacion_existe('org_no_existe') as e`;
  ok("vocero_organizacion_existe", e === true && no === false);
  const orgs = (await app`select vocero_organizaciones() as id`).map((f) => f.id);
  ok("vocero_organizaciones ve los dos", orgs.includes(A) && orgs.includes(B));
  const [{ s }] = await app`select vocero_slugs_ocupados(${A}) as s`;
  ok("vocero_slugs_ocupados", Array.isArray(s) && s.includes(A), JSON.stringify(s));
  const [{ c }] = await app`select count(*)::int as c from vocero_conteo_webhooks()`;
  ok("vocero_conteo_webhooks devuelve una fila de números", c === 1);
}

async function main() {
  const tablas = await catalogo();
  const sembradas = await sembrar(tablas);
  await cruzados(tablas, sembradas);
  await pool();
  await envoltorio();
  await funcionesDeSoloIds();
}

main()
  .catch((err) => {
    console.error(err);
    fallas++;
  })
  .finally(async () => {
    await dueno`delete from organization where id in (${A}, ${B})`.catch(() => {});
    await dueno`delete from "user" where id in ('usr_rls_a', 'usr_rls_b')`.catch(() => {});
    await dueno.end();
    await app.end();
    console.log(`\n${checks - fallas}/${checks} checks en verde`);
    process.exit(fallas > 0 ? 1 : 0);
  });
